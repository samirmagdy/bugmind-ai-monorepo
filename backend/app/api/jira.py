from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from ..db.session import get_db
from ..models import database as models
from ..schemas import schemas
from .bugs import get_current_user
from ..core.crypto import encrypt_token, decrypt_token
from ..services.jira import JiraService
import time

# Simple in-memory search cache: (url, project, query) -> (timestamp, results)
USER_SEARCH_CACHE = {}
CACHE_TTL = 300  # 5 minutes
CACHE_MAX_SIZE = 500  # Prevent unbounded memory growth

router = APIRouter(prefix="/api/jira", tags=["jira"])

@router.post("/connect")
async def connect_jira(
    data: schemas.JiraConnect,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Platform Discovery & Verification
    jira = JiraService(
        base_url=data.base_url,
        auth_type=data.auth_type,
        token=data.token,
        username=data.username,
        verify_ssl=data.verify_ssl
    )
    verified_type = await jira.get_deployment_type()

    # Upsert based on User and Base URL
    conn = db.query(models.JiraConnection).filter(
        models.JiraConnection.user_id == current_user.id,
        models.JiraConnection.base_url == data.base_url
    ).first()

    if conn:
        conn.auth_type = verified_type
        conn.username = data.username
        conn.verify_ssl = data.verify_ssl
        if data.token:
            conn.token_encrypted = encrypt_token(data.token)
    else:
        conn = models.JiraConnection(
            user_id=current_user.id,
            base_url=data.base_url,
            auth_type=verified_type,
            token_encrypted=encrypt_token(data.token),
            username=data.username,
            verify_ssl=data.verify_ssl
        )
        db.add(conn)
    
    db.commit()
    return {"status": "success", "message": f"Jira connected successfully to {data.base_url}"}

@router.get("/status")
def get_jira_status(
    base_url: Optional[str] = Query(None),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if base_url:
        base_url = base_url.rstrip("/")
        conn = db.query(models.JiraConnection).filter(
            models.JiraConnection.user_id == current_user.id,
            models.JiraConnection.base_url == base_url
        ).first()
        if not conn:
            return {"connected": False, "base_url": base_url}
        return {
            "connected": True,
            "base_url": conn.base_url,
            "auth_type": conn.auth_type.value if hasattr(conn.auth_type, 'value') else conn.auth_type,
            "username": conn.username,
            "verify_ssl": conn.verify_ssl,
            "has_token": True
        }
    
    # Return all connections if no URL specified
    conns = db.query(models.JiraConnection).filter(models.JiraConnection.user_id == current_user.id).all()
    return {
        "connections": [
            {"base_url": c.base_url, "auth_type": c.auth_type.value if hasattr(c.auth_type, 'value') else c.auth_type, "username": c.username} 
            for c in conns
        ]
    }

def get_connection_or_404(db: Session, user_id: int, base_url: str):
    if not base_url:
        raise HTTPException(status_code=400, detail="base_url parameter is required for multi-instance support")
    
    base_url = base_url.rstrip("/")
    conn = db.query(models.JiraConnection).filter(
        models.JiraConnection.user_id == user_id,
        models.JiraConnection.base_url == base_url
    ).first()
    
    if not conn:
        raise HTTPException(status_code=404, detail=f"No connection found for {base_url}")
    return conn

@router.get("/issue-types", response_model=List[schemas.IssueType])
async def get_project_issue_types(
    project_key: str,
    project_id: Optional[str] = Query(None),
    base_url: str = Query(...),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    conn = get_connection_or_404(db, current_user.id, base_url)
    jira = JiraService(
        base_url=conn.base_url,
        auth_type=conn.auth_type.value if hasattr(conn.auth_type, 'value') else conn.auth_type,
        token=decrypt_token(conn.token_encrypted),
        username=conn.username,
        verify_ssl=conn.verify_ssl
    )
    return await jira.get_project_issue_types(project_key, project_id=project_id)

@router.get("/users/search")
async def get_jira_user_search(
    project_key: str,
    query: str,
    project_id: Optional[str] = Query(None),
    base_url: str = Query(...),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    cache_key = (base_url, project_key or project_id, query)
    if cache_key in USER_SEARCH_CACHE:
        ts, results = USER_SEARCH_CACHE[cache_key]
        if time.time() - ts < CACHE_TTL:
            print(f"[CACHE-HIT] Serving users for {query} from memory")
            return results

    conn = get_connection_or_404(db, current_user.id, base_url)
    jira = JiraService(
        base_url=conn.base_url,
        auth_type=conn.auth_type.value if hasattr(conn.auth_type, 'value') else conn.auth_type,
        token=decrypt_token(conn.token_encrypted),
        username=conn.username,
        verify_ssl=conn.verify_ssl
    )
    results = await jira.search_assignable_users(project_key, query, project_id=project_id)
    # Evict oldest entries if cache exceeds max size
    if len(USER_SEARCH_CACHE) >= CACHE_MAX_SIZE:
        oldest_key = min(USER_SEARCH_CACHE, key=lambda k: USER_SEARCH_CACHE[k][0])
        del USER_SEARCH_CACHE[oldest_key]
    USER_SEARCH_CACHE[cache_key] = (time.time(), results)
    return results

@router.get("/metadata", response_model=schemas.JiraMetadataResponse)
async def get_bug_metadata(
    project_key: str,
    project_id: Optional[str] = Query(None),
    base_url: str = Query(...),
    issue_type_id: Optional[str] = None,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    base_url = base_url.rstrip("/")
    # 1. OPTIMIZATION: Check if we have visible fields already in the DB
    existing_mapping = db.query(models.JiraFieldMapping).filter(
        models.JiraFieldMapping.user_id == current_user.id,
        models.JiraFieldMapping.base_url == base_url,
        (models.JiraFieldMapping.project_id == project_id) if project_id else (models.JiraFieldMapping.project_key == project_key),
        models.JiraFieldMapping.issue_type_id == issue_type_id
    ).first()

    conn = get_connection_or_404(db, current_user.id, base_url)
    jira = JiraService(
        base_url=conn.base_url,
        auth_type=conn.auth_type.value if hasattr(conn.auth_type, 'value') else conn.auth_type,
        token=decrypt_token(conn.token_encrypted),
        username=conn.username,
        verify_ssl=conn.verify_ssl
    )
    
    # 2. Get data from Jira
    raw_fields = await jira.get_createmeta(project_key, issue_type_id=issue_type_id, project_id=project_id)
    processed_fields = []
    
    field_list = []
    if isinstance(raw_fields, dict):
        for k, v in raw_fields.items():
            if isinstance(v, dict):
                v['key'] = k
                field_list.append(v)
    elif isinstance(raw_fields, list):
        field_list = raw_fields
        
    for info in field_list:
        key = info.get("key") or info.get("fieldId") or info.get("id")
        name = info.get("name", key)
        if not key or key in ["project", "issuetype", "summary", "description"]:
            continue
            
        field_type_info = info.get("schema", {})
        field_type = field_type_info.get("custom", field_type_info.get("type", "string"))
        
        field_data = {
            "key": key,
            "name": name,
            "type": field_type,
            "required": info.get("required", False),
            "allowed_values": info.get("allowedValues", None)
        }
        
        # Enrichment logic
        if key == "components":
            field_data["allowed_values"] = await jira.get_project_components(project_key, project_id=project_id)
        elif key == "fixVersions" or key == "versions":
            field_data["allowed_values"] = await jira.get_project_versions(project_key, project_id=project_id)
        elif (key == "priority" or field_type == "priority") and not field_data["allowed_values"]:
            field_data["allowed_values"] = await jira.get_priorities()
        elif key == "assignee" or field_type == "user":
            field_data["allowed_values"] = await jira.get_assignable_users(project_key, project_id=project_id)
        elif "sprint" in name.lower() or "sprint" in key.lower() or field_type == "com.pyxis.greenhopper.jira:gh-sprint":
            field_data["allowed_values"] = await jira.get_project_sprints(project_key, project_id=project_id)
        elif key == "labels":
            field_data["type"] = "labels"
            field_data["allowed_values"] = []
            
        processed_fields.append(field_data)
    
    # 3. Ensure Priority is ALWAYS available even if not in createmeta
    if not any(f["key"] == "priority" for f in processed_fields):
        processed_fields.append({
            "key": "priority",
            "name": "Priority",
            "type": "priority",
            "required": False,
            "allowed_values": await jira.get_priorities()
        })
    
    return {
        "project_key": project_key, 
        "project_id": project_id,
        "issue_type_id": issue_type_id,
        "fields": processed_fields,
        "is_configured": existing_mapping is not None
    }

@router.get("/field-settings", response_model=schemas.FieldSettingsResponse)
async def get_field_settings(
    project_key: str,
    project_id: Optional[str] = Query(None),
    base_url: str = Query(...),
    issue_type_id: Optional[str] = None,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    base_url = base_url.rstrip("/")
    # 1. Primary lookup by Project ID (the new standard)
    mapping = None
    if project_id:
        mapping = db.query(models.JiraFieldMapping).filter(
            models.JiraFieldMapping.user_id == current_user.id,
            models.JiraFieldMapping.base_url == base_url,
            models.JiraFieldMapping.project_id == project_id,
            models.JiraFieldMapping.issue_type_id == issue_type_id
        ).first()

    # 2. Self-Healing Migration Fallback: Lookup by Key
    if not mapping:
        mapping = db.query(models.JiraFieldMapping).filter(
            models.JiraFieldMapping.user_id == current_user.id,
            models.JiraFieldMapping.base_url == base_url,
            models.JiraFieldMapping.project_key == project_key,
            models.JiraFieldMapping.issue_type_id == issue_type_id
        ).first()
        
        # If we found it by Key but it was missing an ID, update it now!
        if mapping and project_id and not mapping.project_id:
            mapping.project_id = project_id
            db.commit()

    # Helper to safely resolve verify_ssl
    def _get_verify_ssl():
        conn = db.query(models.JiraConnection).filter(
            models.JiraConnection.user_id == current_user.id,
            models.JiraConnection.base_url == base_url
        ).first()
        return conn.verify_ssl if conn else True

    if not mapping:
        return {
            "project_id": project_id, 
            "project_key": project_key, 
            "issue_type_id": issue_type_id, 
            "visible_fields": [], 
            "ai_mapping": {},
            "verify_ssl": _get_verify_ssl()
        }
        
    return {
        "project_id": mapping.project_id,
        "project_key": mapping.project_key,
        "issue_type_id": mapping.issue_type_id,
        "issue_type_name": mapping.issue_type_name,
        "visible_fields": mapping.visible_fields,
        "ai_mapping": mapping.ai_mapping,
        "verify_ssl": _get_verify_ssl()
    }

@router.post("/field-settings", response_model=schemas.FieldSettingsResponse)
async def save_field_settings(
    request: schemas.FieldSettingsUpdate,
    base_url: str = Query(...),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    base_url = base_url.rstrip("/")
    mapping = None
    if request.project_id:
        mapping = db.query(models.JiraFieldMapping).filter(
            models.JiraFieldMapping.user_id == current_user.id,
            models.JiraFieldMapping.base_url == base_url,
            models.JiraFieldMapping.project_id == request.project_id,
            models.JiraFieldMapping.issue_type_id == request.issue_type_id
        ).first()
    
    # Fallback to project_key for migration/legacy
    if not mapping:
        mapping = db.query(models.JiraFieldMapping).filter(
            models.JiraFieldMapping.user_id == current_user.id,
            models.JiraFieldMapping.base_url == base_url,
            models.JiraFieldMapping.project_key == request.project_key,
            models.JiraFieldMapping.issue_type_id == request.issue_type_id
        ).first()
    
    if mapping:
        mapping.project_id = request.project_id # Migration
        mapping.project_key = request.project_key
        mapping.visible_fields = request.visible_fields
        mapping.ai_mapping = request.ai_mapping
        mapping.issue_type_name = request.issue_type_name
    else:
        mapping = models.JiraFieldMapping(
            user_id=current_user.id,
            base_url=base_url,
            project_id=request.project_id,
            project_key=request.project_key,
            issue_type_id=request.issue_type_id,
            issue_type_name=request.issue_type_name,
            visible_fields=request.visible_fields,
            ai_mapping=request.ai_mapping
        )
        db.add(mapping)
    
    db.commit()
    db.refresh(mapping)
    conn = db.query(models.JiraConnection).filter(
        models.JiraConnection.user_id == current_user.id,
        models.JiraConnection.base_url == base_url
    ).first()
    return {
        "project_id": mapping.project_id,
        "project_key": mapping.project_key,
        "issue_type_id": mapping.issue_type_id,
        "issue_type_name": mapping.issue_type_name,
        "visible_fields": mapping.visible_fields,
        "ai_mapping": mapping.ai_mapping,
        "verify_ssl": conn.verify_ssl if conn else True
    }
