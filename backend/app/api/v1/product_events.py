from datetime import datetime
from typing import List, cast, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api import deps
from app.core.rbac import Action, check_permission
from app.models.product_event import ProductEvent
from app.models.user import User
from app.schemas.product_event import ProductEventCreate, ProductEventResponse

router = APIRouter(prefix="/events", tags=["events"])


def _serialize_event(event: ProductEvent) -> ProductEventResponse:
    return ProductEventResponse(
        id=cast(int, event.id),
        user_id=cast(int, event.user_id),
        workspace_id=cast(Optional[int], event.workspace_id),
        event_type=cast(str, event.event_type),
        source=cast(str, event.source),
        issue_key=cast(Optional[str], event.issue_key),
        title=cast(Optional[str], event.title),
        detail=cast(Optional[str], event.detail),
        metadata=cast(dict, event.event_metadata or {}),
        created_at=cast(datetime, event.created_at),
    )


def _create_event(db: Session, current_user: User, payload: ProductEventCreate, required_prefix: str) -> ProductEventResponse:
    if not payload.event_type.startswith(required_prefix):
        raise HTTPException(status_code=400, detail=f"event_type must start with {required_prefix}")

    workspace_id = payload.workspace_id or cast(Optional[int], current_user.default_workspace_id)
    if workspace_id and not check_permission(db, cast(int, current_user.id), workspace_id, Action.WORKSPACE_READ):
        raise HTTPException(status_code=403, detail="Not enough permissions for workspace event")

    event = ProductEvent(
        user_id=cast(int, current_user.id),
        workspace_id=workspace_id,
        event_type=payload.event_type,
        source=payload.source or "sidepanel",
        issue_key=payload.issue_key,
        title=payload.title,
        detail=payload.detail,
        event_metadata=payload.metadata or {},
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return _serialize_event(event)


@router.post("/activity", response_model=ProductEventResponse)
def create_activity_event(
    payload: ProductEventCreate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    return _create_event(db, current_user, payload, "activity.")


@router.get("/activity", response_model=List[ProductEventResponse])
def list_activity_events(
    limit: int = 50,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    rows = (
        db.query(ProductEvent)
        .filter(ProductEvent.user_id == cast(int, current_user.id), ProductEvent.event_type.like("activity.%"))
        .order_by(ProductEvent.created_at.desc())
        .limit(max(1, min(limit, 200)))
        .all()
    )
    return [_serialize_event(row) for row in rows]


@router.post("/analytics", response_model=ProductEventResponse)
def create_analytics_event(
    payload: ProductEventCreate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    return _create_event(db, current_user, payload, "analytics.")


@router.get("/analytics", response_model=List[ProductEventResponse])
def list_analytics_events(
    workspace_id: int,
    limit: int = 100,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    if not check_permission(db, cast(int, current_user.id), workspace_id, Action.AUDIT_READ):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    rows = (
        db.query(ProductEvent)
        .filter(ProductEvent.workspace_id == workspace_id, ProductEvent.event_type.like("analytics.%"))
        .order_by(ProductEvent.created_at.desc())
        .limit(max(1, min(limit, 500)))
        .all()
    )
    return [_serialize_event(row) for row in rows]
