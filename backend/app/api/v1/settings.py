from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.api import deps
from app.models.user import User
from app.models.jira import JiraFieldMapping
from app.schemas.settings import AISettingsResponse, AISettingsUpdate, JiraSettingsUpdate
from app.core.security import decrypt_credential, encrypt_credential
from app.core.audit import log_audit
from app.services.jira.connection_service import get_owned_connection

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
    changed = False

    if settings.custom_model is not None:
        normalized_model = settings.custom_model.strip() or None
        if current_user.custom_ai_model != normalized_model:
            current_user.custom_ai_model = normalized_model
            changed = True
    
    if settings.clear_openrouter_key:
        if current_user.encrypted_ai_api_key:
            current_user.encrypted_ai_api_key = None
            changed = True
    elif settings.openrouter_key is not None:
        incoming_key = settings.openrouter_key.strip()
        if incoming_key:
            existing_key = None
            if current_user.encrypted_ai_api_key:
                try:
                    existing_key = decrypt_credential(current_user.encrypted_ai_api_key)
                except Exception:
                    existing_key = None

            if existing_key != incoming_key:
                current_user.encrypted_ai_api_key = encrypt_credential(incoming_key)
                changed = True

    if changed:
        db.commit()
        log_audit("settings.ai_update", current_user.id, db=db, custom_model=current_user.custom_ai_model)

    return {"status": "ok"}

@router.post("/jira")
def update_jira_settings(
    settings: JiraSettingsUpdate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    get_owned_connection(db, current_user.id, settings.jira_connection_id)
    query = db.query(JiraFieldMapping).filter(
        JiraFieldMapping.user_id == current_user.id,
        JiraFieldMapping.jira_connection_id == settings.jira_connection_id,
        JiraFieldMapping.project_key == settings.project_key,
        JiraFieldMapping.issue_type_id == settings.issue_type_id
    )
    if settings.project_id is None:
        query = query.filter(JiraFieldMapping.project_id.is_(None))
    else:
        query = query.filter(JiraFieldMapping.project_id == settings.project_id)
    mapping = query.first()

    if not mapping:
        mapping = JiraFieldMapping(
            user_id=current_user.id,
            jira_connection_id=settings.jira_connection_id,
            project_key=settings.project_key,
            project_id=settings.project_id,
            issue_type_id=settings.issue_type_id,
            visible_fields=settings.visible_fields or [],
            field_mappings=settings.ai_mapping or {},
            field_defaults=settings.field_defaults or {},
        )
        db.add(mapping)
    else:
        mapping.jira_connection_id = settings.jira_connection_id
        if settings.project_id is not None:
            mapping.project_id = settings.project_id
        if settings.visible_fields is not None:
            mapping.visible_fields = settings.visible_fields
        if settings.ai_mapping is not None:
            mapping.field_mappings = settings.ai_mapping
        if settings.field_defaults is not None:
            mapping.field_defaults = settings.field_defaults

    db.commit()
    log_audit("settings.jira_mapping_update", current_user.id, db=db, project_key=settings.project_key)
    return {"status": "ok"}
