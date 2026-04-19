from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import Optional
from app.api import deps
from app.models.user import User
from app.models.jira import JiraConnection, JiraAuthType, JiraFieldMapping
from app.schemas.jira import (
    JiraBootstrapContextRequest,
    JiraBootstrapContextResponse,
    JiraConnectionCreate,
    JiraConnectionResponse,
    JiraConnectionUpdate,
    JiraFieldResponse,
    JiraIssueTypeResponse,
    JiraMetadataResponse,
    JiraProjectResponse,
    JiraUserSearchRequest,
    XrayDefaultsResponse,
)
from app.schemas.bug import XrayTestSuitePublishRequest, XrayTestSuitePublishResponse, XrayPublishedTest
from app.core import security
from app.services.jira.adapters.cloud import JiraCloudAdapter
from app.services.jira.adapters.server import JiraServerAdapter
from app.services.jira.metadata_engine import JiraMetadataEngine
from urllib.parse import urlparse

router = APIRouter()

from cryptography.fernet import InvalidToken

def get_adapter(connection: JiraConnection):
    try:
        token = security.decrypt_credential(connection.encrypted_token)
    except InvalidToken:
        raise HTTPException(
            status_code=401, 
            detail="Jira Connection Stale: Encryption keys have changed. Please delete and re-add this connection."
        )
    if connection.auth_type == JiraAuthType.CLOUD:
        return JiraCloudAdapter(connection.host_url, connection.username, token, verify_ssl=connection.verify_ssl)
    return JiraServerAdapter(connection.host_url, connection.username, token, verify_ssl=connection.verify_ssl)


def _normalize_instance_url(url: Optional[str]) -> str:
    trimmed = (url or "").strip().rstrip("/")
    if not trimmed:
        return ""

    try:
        parsed = urlparse(trimmed)
        path = parsed.path.rstrip("/")
        for marker in ("/browse/", "/issues/", "/projects/"):
            if marker in path:
                path = path.split(marker, 1)[0]
                break
        normalized = f"{parsed.scheme}://{parsed.netloc}{path}"
        return normalized.rstrip("/")
    except Exception:
        return trimmed


def _serialize_issue_type(issue_type: dict) -> JiraIssueTypeResponse:
    return JiraIssueTypeResponse(
        id=str(issue_type.get("id", "")),
        name=str(issue_type.get("name", "")),
        icon_url=issue_type.get("iconUrl") or issue_type.get("icon_url"),
        subtask=bool(issue_type.get("subtask", False)),
    )


def _select_issue_type(issue_types: list[dict], issue_type_id: Optional[str]) -> Optional[dict]:
    if issue_type_id:
        exact = next((item for item in issue_types if str(item.get("id")) == str(issue_type_id)), None)
        if exact:
            return exact

    bug_type = next((item for item in issue_types if "bug" in str(item.get("name", "")).strip().lower()), None)
    if bug_type:
        return bug_type
    return issue_types[0] if issue_types else None


def _normalize_folder_path(folder_path: Optional[str], story_issue_key: str) -> str:
    raw_value = (folder_path or story_issue_key or "").strip()
    normalized = raw_value.replace("\\", "/")
    normalized = "/".join(part.strip() for part in normalized.split("/") if part.strip())
    if not normalized:
        raise HTTPException(status_code=400, detail="A valid Xray folder path is required")
    return normalized


def _resolve_test_issue_type_id(issue_types: list[dict], test_issue_type_id: Optional[str], test_issue_type_name: Optional[str]) -> str:
    if test_issue_type_id:
        return str(test_issue_type_id)

    desired_name = (test_issue_type_name or "Test").strip().lower()
    exact_match = next((item for item in issue_types if str(item.get("name", "")).strip().lower() == desired_name), None)
    if exact_match:
        return str(exact_match["id"])

    partial_match = next((item for item in issue_types if desired_name in str(item.get("name", "")).strip().lower()), None)
    if partial_match:
        return str(partial_match["id"])

    fallback = next((item for item in issue_types if "test" in str(item.get("name", "")).strip().lower()), None)
    if fallback:
        return str(fallback["id"])

    raise HTTPException(status_code=400, detail="Could not find an Xray Test issue type in the selected project")


def _detect_repository_path_field_id(fields: list[dict], repository_path_field_id: Optional[str]) -> Optional[str]:
    if repository_path_field_id:
        return repository_path_field_id

    preferred_names = (
        "test repository path",
        "repository path",
        "test repository",
        "test repo path",
    )
    for field in fields:
        name = str(field.get("name", "")).strip().lower()
        if any(candidate in name for candidate in preferred_names):
            return field.get("id")
    return None


def _resolve_link_type_candidates(link_type: Optional[str], available_types: list[str]) -> list[str]:
    candidates: list[str] = []
    for candidate in [link_type, "Tests", "Test", "Relates"]:
        if candidate and candidate not in candidates:
            candidates.append(candidate)

    if available_types:
        available_lookup = {name.lower(): name for name in available_types}
        resolved: list[str] = []
        for candidate in candidates:
            match = available_lookup.get(candidate.lower())
            if match and match not in resolved:
                resolved.append(match)
        if resolved:
            return resolved
    return candidates


def _format_test_issue_description(story_issue_key: str, test_case: dict) -> str:
    steps = test_case.get("steps", []) or []
    lines = [f"Source Story: {story_issue_key}", "", "Steps:"]
    for idx, step in enumerate(steps, start=1):
        lines.append(f"{idx}. {step}")
    lines.extend(["", "Expected Result:", str(test_case.get("expected_result", "")).strip()])
    lines.extend(["", f"Priority: {str(test_case.get('priority', '')).strip()}"])
    return "\n".join(lines).strip()


def resolve_jira_bootstrap_context(
    req: JiraBootstrapContextRequest,
    db: Session,
    current_user: User
) -> JiraBootstrapContextResponse:
    connections = db.query(JiraConnection).filter(
        JiraConnection.user_id == current_user.id
    ).order_by(JiraConnection.is_active.desc(), JiraConnection.id.asc()).all()
    if not connections:
        raise HTTPException(status_code=404, detail="No Jira connections found")

    target_url = _normalize_instance_url(req.instance_url)
    if not target_url:
        raise HTTPException(status_code=400, detail="A valid Jira instance URL is required")

    ranked_matches = []
    for connection in connections:
        normalized_host = _normalize_instance_url(connection.host_url)
        if normalized_host and (
            target_url == normalized_host or
            target_url.startswith(f"{normalized_host}/") or
            target_url.startswith(normalized_host)
        ):
            ranked_matches.append((len(normalized_host), connection))

    ranked_matches.sort(key=lambda item: item[0], reverse=True)
    conn = ranked_matches[0][1] if ranked_matches else (next((item for item in connections if item.is_active), None) or connections[0])

    adapter = get_adapter(conn)
    engine = JiraMetadataEngine(adapter)

    resolved_project_id = req.project_id or req.project_key
    issue_types_raw: list[dict] = []
    selected_issue_type_raw: Optional[dict] = None
    visible_fields: list[str] = []
    ai_mapping: dict = {}
    metadata_response: Optional[JiraMetadataResponse] = None

    if resolved_project_id:
        issue_types_raw = engine.get_project_metadata(resolved_project_id)
        selected_issue_type_raw = _select_issue_type(issue_types_raw, req.issue_type_id)

        if selected_issue_type_raw:
            selected_issue_type_id = str(selected_issue_type_raw.get("id", ""))
            mapping = db.query(JiraFieldMapping).filter(
                JiraFieldMapping.user_id == current_user.id,
                or_(
                    JiraFieldMapping.project_key == (req.project_key or resolved_project_id),
                    JiraFieldMapping.project_id == req.project_id
                ),
                JiraFieldMapping.issue_type_id == selected_issue_type_id
            ).first()
            visible_fields = mapping.visible_fields if mapping else []
            ai_mapping = mapping.field_mappings if mapping else {}

            metadata_fields = engine.get_field_schema(resolved_project_id, selected_issue_type_id)
            metadata_response = JiraMetadataResponse(
                project_key=req.project_key or str(resolved_project_id),
                project_id=req.project_id or str(resolved_project_id),
                issue_type_id=selected_issue_type_id,
                fields=[JiraFieldResponse(**field) for field in metadata_fields]
            )

    return JiraBootstrapContextResponse(
        connection_id=conn.id,
        instance_url=_normalize_instance_url(conn.host_url),
        platform=conn.auth_type,
        verify_ssl=conn.verify_ssl,
        issue_types=[_serialize_issue_type(issue_type) for issue_type in issue_types_raw],
        selected_issue_type=_serialize_issue_type(selected_issue_type_raw) if selected_issue_type_raw else None,
        visible_fields=visible_fields,
        ai_mapping=ai_mapping,
        jira_metadata=metadata_response
    )

@router.get("/connections", response_model=list[JiraConnectionResponse])
def list_connections(
    db: Session = Depends(deps.get_db), 
    current_user: User = Depends(deps.get_current_user)
):
    return db.query(JiraConnection).filter(JiraConnection.user_id == current_user.id).order_by(JiraConnection.is_active.desc(), JiraConnection.id.asc()).all()


@router.post("/bootstrap-context", response_model=JiraBootstrapContextResponse)
def bootstrap_jira_context(
    req: JiraBootstrapContextRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    return resolve_jira_bootstrap_context(req, db, current_user)

@router.post("/connections", response_model=JiraConnectionResponse)
def create_connection(
    conn_in: JiraConnectionCreate, 
    db: Session = Depends(deps.get_db), 
    current_user: User = Depends(deps.get_current_user)
):
    if not conn_in.token or not conn_in.token.strip():
        raise HTTPException(status_code=400, detail="API Token cannot be empty")

    encrypted = security.encrypt_credential(conn_in.token)
    db.query(JiraConnection).filter(JiraConnection.user_id == current_user.id).update(
        {JiraConnection.is_active: False},
        synchronize_session=False
    )

    conn = JiraConnection(
        user_id=current_user.id,
        auth_type=conn_in.auth_type,
        host_url=conn_in.host_url,
        username=conn_in.username,
        encrypted_token=encrypted,
        verify_ssl=conn_in.verify_ssl,
        is_active=True,
    )
    db.add(conn)
    db.commit()
    db.refresh(conn)
    return conn

@router.patch("/connections/{conn_id}", response_model=JiraConnectionResponse)
def update_connection(
    conn_id: int,
    conn_in: JiraConnectionUpdate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    conn = db.query(JiraConnection).filter(JiraConnection.id == conn_id, JiraConnection.user_id == current_user.id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    
    update_data = conn_in.model_dump(exclude_unset=True)
    if "token" in update_data:
        token_val = update_data.pop("token")
        if token_val and token_val.strip():
            update_data["encrypted_token"] = security.encrypt_credential(token_val)
    
    if update_data.get("is_active") is True:
        db.query(JiraConnection).filter(
            JiraConnection.user_id == current_user.id,
            JiraConnection.id != conn_id
        ).update({JiraConnection.is_active: False}, synchronize_session=False)

    for field, value in update_data.items():
        setattr(conn, field, value)
    
    db.add(conn)
    db.commit()
    db.refresh(conn)
    return conn

@router.delete("/connections/{conn_id}", status_code=204)
def delete_connection(
    conn_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    conn = db.query(JiraConnection).filter(JiraConnection.id == conn_id, JiraConnection.user_id == current_user.id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    
    db.delete(conn)
    db.commit()

    if conn.is_active:
        replacement = db.query(JiraConnection).filter(JiraConnection.user_id == current_user.id).order_by(JiraConnection.id.asc()).first()
        if replacement:
            replacement.is_active = True
            db.add(replacement)
            db.commit()
    return None

@router.get("/connections/{conn_id}/projects")
def get_projects(
    conn_id: int, 
    db: Session = Depends(deps.get_db), 
    current_user: User = Depends(deps.get_current_user)
):
    conn = db.query(JiraConnection).filter(JiraConnection.id == conn_id, JiraConnection.user_id == current_user.id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
        
    adapter = get_adapter(conn)
    return adapter.get_projects()


@router.get("/connections/{conn_id}/xray/defaults", response_model=XrayDefaultsResponse)
def get_xray_defaults(
    conn_id: int,
    story_issue_key: Optional[str] = None,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    conn = db.query(JiraConnection).filter(
        JiraConnection.id == conn_id,
        JiraConnection.user_id == current_user.id
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    adapter = get_adapter(conn)
    projects = adapter.get_projects()
    story_project_key = (story_issue_key or "").split("-", 1)[0] if story_issue_key else None
    default_project = next((project for project in projects if project.get("key") == story_project_key), None)
    if not default_project and projects:
        default_project = projects[0]

    projects_response = [
        JiraProjectResponse(
            id=str(project.get("id", "")),
            key=str(project.get("key", "")),
            name=str(project.get("name", "")),
        )
        for project in projects
    ]

    return XrayDefaultsResponse(
        projects=projects_response,
        target_project_id=str(default_project.get("id")) if default_project else None,
        target_project_key=str(default_project.get("key")) if default_project else None,
        test_issue_type_name="Test",
        repository_path_field_id=None,
        folder_path=(story_issue_key or "").strip(),
        link_type="Tests",
    )

@router.get("/connections/{conn_id}/projects/{project_id}/metadata")
def get_metadata(
    conn_id: int, 
    project_id: str,
    db: Session = Depends(deps.get_db), 
    current_user: User = Depends(deps.get_current_user)
):
    conn = db.query(JiraConnection).filter(JiraConnection.id == conn_id, JiraConnection.user_id == current_user.id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
        
    adapter = get_adapter(conn)
    engine = JiraMetadataEngine(adapter)
    return engine.get_project_metadata(project_id)

@router.get("/connections/{conn_id}/projects/{project_id}/issue-types/{issue_type_id}/fields")
def get_field_metadata(
    conn_id: int, 
    project_id: str,
    issue_type_id: str,
    db: Session = Depends(deps.get_db), 
    current_user: User = Depends(deps.get_current_user)
):
    conn = db.query(JiraConnection).filter(JiraConnection.id == conn_id, JiraConnection.user_id == current_user.id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
        
    adapter = get_adapter(conn)
    engine = JiraMetadataEngine(adapter)
    return engine.get_field_schema(project_id, issue_type_id)

@router.get("/connections/{conn_id}/projects/{project_id}/field-settings")
def get_field_settings(
    conn_id: int,
    project_id: str,
    issue_type_id: Optional[str] = None,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    conn = db.query(JiraConnection).filter(
        JiraConnection.id == conn_id,
        JiraConnection.user_id == current_user.id
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    mapping = None
    if issue_type_id:
        mapping = db.query(JiraFieldMapping).filter(
            JiraFieldMapping.user_id == current_user.id,
            or_(
                JiraFieldMapping.project_key == project_id,
                JiraFieldMapping.project_id == project_id
            ),
            JiraFieldMapping.issue_type_id == issue_type_id
        ).first()

    return {
        "visible_fields": mapping.visible_fields if mapping else [],
        "ai_mapping": mapping.field_mappings if mapping else {}
    }

@router.post("/users/search")
def search_jira_users(
    request: JiraUserSearchRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    query = request.query.strip()
    if len(query) < 2:
        return []

    conn = db.query(JiraConnection).filter(
        JiraConnection.id == request.jira_connection_id,
        JiraConnection.user_id == current_user.id
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    adapter = get_adapter(conn)
    return adapter.search_users(query)

@router.post("/connections/{conn_id}/projects/{project_id}/validate-issue")
def validate_jira_issue(
    conn_id: int,
    project_id: str,
    issue_data: dict,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    conn = db.query(JiraConnection).filter(JiraConnection.id == conn_id, JiraConnection.user_id == current_user.id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
        
    adapter = get_adapter(conn)
    engine = JiraMetadataEngine(adapter)
    
    # 1. Get the issue type selection from the payload
    issue_type_id = issue_data.get("fields", {}).get("issuetype", {}).get("id")
    if not issue_type_id:
        raise HTTPException(status_code=400, detail="Missing issuetype id in payload")
        
    # 2. Fetch the schema for this type
    schema = engine.get_field_schema(project_id, issue_type_id)
    
    # 3. Validate
    missing_fields = []
    payload_fields = issue_data.get("fields", {})
    
    for field in schema:
        # Standard fields like project and issuetype are usually in the payload
        # but check for others
        if field.get("required") and field["key"] not in payload_fields:
            # Check for special cases or if the field value is empty
            missing_fields.append({
                "key": field["key"],
                "name": field["name"]
            })
        elif field.get("required") and field["key"] in payload_fields:
            val = payload_fields[field["key"]]
            if val is None or val == "" or (isinstance(val, list) and not val):
                missing_fields.append({
                    "key": field["key"],
                    "name": field["name"]
                })

    return {
        "valid": len(missing_fields) == 0,
        "missing_fields": missing_fields
    }

@router.post("/connections/{conn_id}/projects/{project_id}/resolve-issue")
def resolve_jira_issue_payload(
    conn_id: int,
    project_id: str,
    issue_data: dict,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    conn = db.query(JiraConnection).filter(JiraConnection.id == conn_id, JiraConnection.user_id == current_user.id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
        
    # 1. Get Mapping
    issue_type_id = issue_data.get("fields", {}).get("issuetype", {}).get("id")
    mapping_record = db.query(JiraFieldMapping).filter(
        or_(
            JiraFieldMapping.project_key == project_id,
            JiraFieldMapping.project_id == project_id
        ),
        JiraFieldMapping.issue_type_id == issue_type_id,
        JiraFieldMapping.user_id == current_user.id
    ).first()
    mapping_config = mapping_record.field_mappings if mapping_record else {}
    
    # 2. Get Schema
    adapter = get_adapter(conn)
    engine = JiraMetadataEngine(adapter)
    schema = engine.get_field_schema(project_id, issue_type_id)
    
    # 3. Resolve
    resolver = JiraFieldResolver(mapping_config, schema)
    # We need to transform the frontend 'bug' structure (with summaries/descriptions separate) 
    # into the 'ai_raw' format the resolver expects
    ai_raw = {
        "summary": issue_data["fields"].get("summary"),
        "description": issue_data["fields"].get("description"),
        "steps": issue_data["fields"].get("steps_to_reproduce", "").split("\n"),
        "expected": issue_data["fields"].get("expected_result"),
        "actual": issue_data["fields"].get("actual_result"),
        **issue_data["fields"] # includes custom fields
    }
    
    # Strip numbering from steps if they were already formatted
    clean_steps = []
    for s in ai_raw["steps"]:
        clean_s = re.sub(r"^\d+\.\s*", "", s).strip()
        if clean_s:
            clean_steps.append(clean_s)
    ai_raw["steps"] = clean_steps
    
    jira_payload = resolver.resolve(ai_raw)
    return jira_payload

@router.post("/connections/{conn_id}/projects/{project_id}/issues")
def create_jira_issue(
    conn_id: int,
    project_id: str,
    issue_data: dict, # The payload from the field_resolver
    db: Session = Depends(deps.get_db), 
    current_user: User = Depends(deps.get_current_user)
):
    conn = db.query(JiraConnection).filter(JiraConnection.id == conn_id, JiraConnection.user_id == current_user.id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
        
    adapter = get_adapter(conn)
    # Ensure project and issuetype are in the payload if not already
    if "project" not in issue_data["fields"]:
        issue_data["fields"]["project"] = {"id": project_id} if str(project_id).isdigit() else {"key": project_id}
        
    issue_key = adapter.create_issue(issue_data)
    
    # Handle optional story linking
    link_to = issue_data.get("link_to_story")
    if link_to:
        try:
            adapter.link_issues(issue_key, "Relates", link_to)
        except Exception as e:
            print(f"[BugMind] Warning: Failed to link issue {issue_key} to {link_to}: {str(e)}")
            
    return {"issue_key": issue_key}


@router.post("/connections/{conn_id}/xray/test-suite", response_model=XrayTestSuitePublishResponse)
def publish_xray_test_suite(
    conn_id: int,
    req: XrayTestSuitePublishRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    if conn_id != req.jira_connection_id:
        raise HTTPException(status_code=400, detail="Connection mismatch for Xray publish request")
    if not req.test_cases:
        raise HTTPException(status_code=400, detail="No test cases were provided for Xray publishing")

    conn = db.query(JiraConnection).filter(
        JiraConnection.id == conn_id,
        JiraConnection.user_id == current_user.id
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    adapter = get_adapter(conn)
    engine = JiraMetadataEngine(adapter)

    issue_types = engine.get_project_metadata(req.xray_project_id)
    test_issue_type_id = _resolve_test_issue_type_id(issue_types, req.test_issue_type_id, req.test_issue_type_name)
    test_fields = engine.get_field_schema(req.xray_project_id, test_issue_type_id)
    repository_path_field_id = _detect_repository_path_field_id(test_fields, req.repository_path_field_id)
    folder_path = _normalize_folder_path(req.folder_path, req.story_issue_key)

    available_link_types: list[str] = []
    try:
        available_link_types = adapter.get_issue_link_types()
    except HTTPException:
        available_link_types = []

    link_candidates = _resolve_link_type_candidates(req.link_type, available_link_types)
    created_tests: list[XrayPublishedTest] = []
    warnings: list[str] = []
    link_type_used: Optional[str] = None

    for test_case in req.test_cases:
        fields = {
            "project": {"key": req.xray_project_key} if req.xray_project_key else {"id": req.xray_project_id},
            "summary": test_case.title,
            "description": _format_test_issue_description(req.story_issue_key, test_case.model_dump()),
            "issuetype": {"id": test_issue_type_id},
        }
        if repository_path_field_id:
            fields[repository_path_field_id] = folder_path

        issue_key = adapter.create_issue({"fields": fields})
        created_tests.append(XrayPublishedTest(id=issue_key, key=issue_key, self=""))

        linked = False
        for candidate in link_candidates:
            try:
                adapter.link_issues(issue_key, candidate, req.story_issue_key)
                linked = True
                if not link_type_used:
                    link_type_used = candidate
                break
            except HTTPException:
                continue

        if not linked:
            warnings.append(f"Created {issue_key} but could not link it to {req.story_issue_key}")

    if not repository_path_field_id:
        warnings.append("Created tests without setting an Xray repository path because no repository path field was detected")

    return XrayTestSuitePublishResponse(
        created_tests=created_tests,
        folder_path=folder_path,
        repository_path_field_id=repository_path_field_id,
        link_type_used=link_type_used,
        warnings=warnings,
    )
