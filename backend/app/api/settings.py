from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..db.session import get_db
from ..models import database as models
from ..schemas import schemas
from ..api.bugs import get_current_user
from ..core.crypto import encrypt_token, decrypt_token
from typing import Optional

router = APIRouter(prefix="/api/settings", tags=["settings"])

@router.get("/ai", response_model=schemas.AISettingsResponse)
async def get_ai_settings(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    settings = db.query(models.AISettings).filter(models.AISettings.user_id == current_user.id).first()
    if not settings:
        return schemas.AISettingsResponse(has_custom_key=False, custom_model=None)
    
    return schemas.AISettingsResponse(
        has_custom_key=settings.openrouter_key_encrypted is not None,
        custom_model=settings.custom_model,
        updated_at=settings.updated_at
    )

@router.post("/ai", response_model=schemas.AISettingsResponse)
async def update_ai_settings(
    request: schemas.AISettingsUpdate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    settings = db.query(models.AISettings).filter(models.AISettings.user_id == current_user.id).first()
    if not settings:
        settings = models.AISettings(user_id=current_user.id)
        db.add(settings)

    if request.openrouter_key:
        settings.openrouter_key_encrypted = encrypt_token(request.openrouter_key)
    
    if request.custom_model:
        settings.custom_model = request.custom_model
    
    db.commit()
    db.refresh(settings)

    return schemas.AISettingsResponse(
        has_custom_key=settings.openrouter_key_encrypted is not None,
        custom_model=settings.custom_model,
        updated_at=settings.updated_at
    )
