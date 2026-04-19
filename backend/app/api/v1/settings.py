from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.api import deps
from app.models.user import User
from app.models.jira import JiraFieldMapping
from app.schemas.settings import AISettingsResponse, AISettingsUpdate, JiraSettingsUpdate
from app.core.security import encrypt_credential

router = APIRouter()

@router.get("/ai", response_model=AISettingsResponse)
def get_ai_settings(
    current_user: User = Depends(deps.get_current_user)
):
    return AISettingsResponse(
        custom_model=current_user.custom_ai_model,
        has_custom_key=bool(current_user.encrypted_ai_api_key)
    )

@router.post("/ai")
def update_ai_settings(
    settings: AISettingsUpdate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    if settings.custom_model is not None:
        current_user.custom_ai_model = settings.custom_model
    
    if settings.openrouter_key:
        current_user.encrypted_ai_api_key = encrypt_credential(settings.openrouter_key)
    
    db.commit()
    return {"status": "ok"}

@router.post("/jira")
def update_jira_settings(
    settings: JiraSettingsUpdate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    mapping = db.query(JiraFieldMapping).filter(
        JiraFieldMapping.user_id == current_user.id,
        JiraFieldMapping.project_key == settings.project_key,
        JiraFieldMapping.issue_type_id == settings.issue_type_id
    ).first()

    if not mapping:
        mapping = JiraFieldMapping(
            user_id=current_user.id,
            project_key=settings.project_key,
            project_id=settings.project_id,
            issue_type_id=settings.issue_type_id,
            visible_fields=settings.visible_fields or [],
            field_mappings=settings.ai_mapping or {}
        )
        db.add(mapping)
    else:
        if settings.project_id is not None:
            mapping.project_id = settings.project_id
        if settings.visible_fields is not None:
            mapping.visible_fields = settings.visible_fields
        if settings.ai_mapping is not None:
            mapping.field_mappings = settings.ai_mapping

    db.commit()
    return {"status": "ok"}
