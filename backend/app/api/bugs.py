from fastapi import APIRouter, Depends, HTTPException, Security, Request
from ..services.ai_engine import AIConnectionError
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from ..db.session import get_db
from ..models import database as models
from ..schemas import schemas
from ..services.ai_engine import AIEngine
from ..services.jira import JiraService
from ..core import security
from ..core.limiter import limiter
from ..core.crypto import decrypt_token
from jose import jwt
import os
from datetime import datetime
from fastapi.security import OAuth2PasswordBearer
from typing import List

router = APIRouter(prefix="/api/bugs", tags=["bugs"])
reusable_oauth2 = OAuth2PasswordBearer(tokenUrl="api/auth/login")

async def get_current_user(token: str = Depends(reusable_oauth2), db: Session = Depends(get_db)) -> models.User:
    try:
        payload = jwt.decode(token, security.SECRET_KEY, algorithms=[security.ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    user = db.query(models.User).filter(models.User.id == int(user_id)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

async def check_usage_limit(user_id: int, db: Session) -> bool:
    # Get user subscription
    sub = db.query(models.Subscription).filter(models.Subscription.user_id == user_id).first()
    if sub and sub.plan == "pro":
        return True # Unlimited for Pro
        
    # Check usage in current month
    now = datetime.utcnow()
    month_start = datetime(now.year, now.month, 1)
    
    count = db.query(models.UsageLog).filter(
        models.UsageLog.user_id == user_id,
        models.UsageLog.action == "generate_bug",
        models.UsageLog.timestamp >= month_start
    ).count()
    
    return count < 5 # Limit to 5 free reports

@router.get("/usage")
async def get_usage(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    sub = db.query(models.Subscription).filter(models.Subscription.user_id == current_user.id).first()
    plan = sub.plan if sub else "free"
    
    now = datetime.utcnow()
    month_start = datetime(now.year, now.month, 1)
    count = db.query(models.UsageLog).filter(
        models.UsageLog.user_id == current_user.id,
        models.UsageLog.action == "generate_bug",
        models.UsageLog.timestamp >= month_start
    ).count()
    
    return {"plan": plan, "used": count, "limit": 5 if plan == "free" else 9999}

@router.post("/generate", response_model=List[schemas.BugReport])
@limiter.limit("5/minute")
async def generate_bugs(
    request: Request,
    story: schemas.GenerateBugsRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    # 1. Enforce usage limits
    if not await check_usage_limit(current_user.id, db):
        raise HTTPException(status_code=402, detail="Monthly generation limit reached. Upgrade to Pro for unlimited reports.")
    
    # 2. Get AI engine with user-specific fallback
    api_key = os.getenv("OPENROUTER_API_KEY")
    model = None
    
    user_settings = db.query(models.AISettings).filter(models.AISettings.user_id == current_user.id).first()
    if user_settings:
        if user_settings.openrouter_key_encrypted:
            api_key = decrypt_token(user_settings.openrouter_key_encrypted)
        if user_settings.custom_model:
            model = user_settings.custom_model
            
    ai = AIEngine(api_key=api_key, model=model)
    
    # 3. Generate bugs
    try:
        bugs = await ai.generate_bugs(
            story.summary, 
            story.description, 
            story.acceptance_criteria,
            field_context=[f.dict() for f in story.field_context] if story.field_context else None
        )
        
        # 4. Log generation
        log = models.UsageLog(
            user_id=current_user.id,
            action="generate_bug",
            tokens_used=len(str(bugs)) // 4  # Approximate: AI engine doesn't propagate raw usage stats
        )
        db.add(log)
        
        gen_log = models.BugGeneration(
            user_id=current_user.id,
            issue_key=story.issue_key,
            input_data={
                "summary": story.summary,
                "description": story.description,
                "ac": story.acceptance_criteria
            },
            ai_output=bugs
        )
        db.add(gen_log)
        db.commit()
        
        return bugs
    except AIConnectionError:
        raise
    except Exception as e:
        error_msg = f"{type(e).__name__}: {str(e)}"
        raise HTTPException(status_code=500, detail=error_msg)

@router.post("/generate-stream")
@limiter.limit("3/minute")
async def generate_bugs_stream(
    request: Request,
    story: schemas.GenerateBugsRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # 1. Enforce usage limits
    if not await check_usage_limit(current_user.id, db):
        raise HTTPException(status_code=402, detail="Monthly generation limit reached.")
    
    # 2. Get AI engine settings
    api_key = os.getenv("OPENROUTER_API_KEY")
    model = None
    user_settings = db.query(models.AISettings).filter(models.AISettings.user_id == current_user.id).first()
    if user_settings:
        if user_settings.openrouter_key_encrypted:
            api_key = decrypt_token(user_settings.openrouter_key_encrypted)
        if user_settings.custom_model:
            model = user_settings.custom_model
            
    ai = AIEngine(api_key=api_key, model=model)
    
    # 3. Stream response
    async def event_generator():
        async for chunk in ai.stream_generate_bugs(
            story.summary, 
            story.description, 
            story.acceptance_criteria,
            field_context=[f.dict() for f in story.field_context] if story.field_context else None
        ):
            yield chunk

    return StreamingResponse(event_generator(), media_type="text/plain")

@router.post("/submit/batch")
async def submit_bugs_batch(
    request: schemas.CreateBugsRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # 1. Get Jira connection for specific instance
    base_url = request.base_url.rstrip("/")
    conn = db.query(models.JiraConnection).filter(
        models.JiraConnection.user_id == current_user.id,
        models.JiraConnection.base_url == base_url
    ).first()
    
    if not conn:
        raise HTTPException(status_code=400, detail=f"Jira connection not found for {base_url}")
    
    jira = JiraService(
        base_url=conn.base_url,
        auth_type=conn.auth_type.value if hasattr(conn.auth_type, 'value') else conn.auth_type,
        token=decrypt_token(conn.token_encrypted),
        username=conn.username,
        verify_ssl=conn.verify_ssl
    )
    
    # 2. Get AI Mapping for this project
    query = db.query(models.JiraFieldMapping).filter(
        models.JiraFieldMapping.user_id == current_user.id,
        models.JiraFieldMapping.base_url == base_url
    )
    if request.project_id:
        query = query.filter(models.JiraFieldMapping.project_id == request.project_id)
    else:
        query = query.filter(models.JiraFieldMapping.project_key == request.project_key)
        
    mapping_rec = query.first()
    ai_mapping = mapping_rec.ai_mapping if mapping_rec else {}
    
    # 3. Create tickets in Jira
    results = []
    errors = []
    for bug in request.bugs:
        try:
            # Prepare extra fields with AI mappings
            final_extra_fields = {
                "priority": {"name": bug.severity},
                **(request.extra_fields or {}),
                **(bug.extra_fields or {})
            }
            
            # Use field mapping for AI-generated properties
            desc_parts = [bug.description]
            ai_props = {
                "steps_to_reproduce": ("Steps to Reproduce", bug.steps_to_reproduce),
                "expected_result": ("Expected Result", bug.expected_result),
                "actual_result": ("Actual Result", bug.actual_result)
            }
            
            for prop_key, (label, value) in ai_props.items():
                target_field = ai_mapping.get(prop_key)
                if target_field and target_field != "description":
                    # Map to custom field
                    final_extra_fields[target_field] = value
                else:
                    # Append to description fallback
                    desc_parts.append(f"\n* {label}*:\n{value}")
            
            res = await jira.create_issue(
                project_key=request.project_key,
                summary=bug.summary,
                description="\n".join(desc_parts),
                issue_type="Bug",
                extra_fields=final_extra_fields,
                project_id=request.project_id
            )
            
            # Step 4: Link to parent story if available
            if request.issue_key and "key" in res:
                await jira.link_issues(outward_key=request.issue_key, inward_key=res["key"])
                
            results.append(res)
        except Exception as e:
            err_msg = str(e)
            print(f"Failed to create bug in Jira: {err_msg}")
            errors.append(err_msg)
            
    if not results and errors:
        # If everything failed, report the errors
        raise HTTPException(
            status_code=400, 
            detail=f"Failed to publish any bugs to Jira. Errors: {'; '.join(errors[:3])}"
        )
            
    return {
        "status": "success", 
        "created_count": len(results), 
        "issues": results,
        "errors": errors if errors else None
    }

@router.post("/generate/manual", response_model=schemas.BugReport)
@limiter.limit("5/minute")
async def generate_manual_bug(
    request: Request,
    data: schemas.ManualBugRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    # 1. Enforce usage limits
    if not await check_usage_limit(current_user.id, db):
        raise HTTPException(status_code=402, detail="Monthly generation limit reached.")
    
    # 2. Get AI engine
    api_key = os.getenv("OPENROUTER_API_KEY")
    model = None
    user_settings = db.query(models.AISettings).filter(models.AISettings.user_id == current_user.id).first()
    if user_settings:
        if user_settings.openrouter_key_encrypted:
            api_key = decrypt_token(user_settings.openrouter_key_encrypted)
        if user_settings.custom_model:
            model = user_settings.custom_model
            
    ai = AIEngine(api_key=api_key, model=model)
    
    # 3. Structure bug
    try:
        bug = await ai.generate_bug_from_description(
            data.description,
            data.jira_context or "General"
        )
        
        # 4. Log generation
        log = models.UsageLog(
            user_id=current_user.id,
            action="generate_bug",
            tokens_used=500 # Manual structuring is relatively light
        )
        db.add(log)
        db.commit()
        
        return bug
    except AIConnectionError:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        error_msg = f"{type(e).__name__}: {str(e)}"
        raise HTTPException(status_code=500, detail=error_msg or "Internal Server Error during manual structuring")
