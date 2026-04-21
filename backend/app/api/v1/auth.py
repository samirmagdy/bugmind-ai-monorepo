from datetime import datetime, timedelta, timezone
from typing import Dict

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from app.api import deps
from app.schemas.token import Token, RefreshTokenRequest, AuthBootstrapRequest, AuthBootstrapResponse
from app.schemas.user import UserCreate, UserResponse
from app.models.user import User
from app.models.auth import RefreshSession
from app.models.jira import JiraConnection
from app.models.subscription import Subscription
from app.core import security
from app.core.config import settings
from app.api.v1.jira import resolve_jira_bootstrap_context
from app.schemas.jira import JiraBootstrapContextRequest
from app.core.rate_limit import rate_limiter
from app.core.request_security import get_client_ip
from app.core.audit import log_audit

router = APIRouter()


def _issue_token_pair(db: Session, user_id: int) -> Dict[str, str]:
    refresh_expires_at = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    refresh_jti = security._build_token_payload(str(user_id), "refresh")["jti"]
    session = RefreshSession(
        user_id=user_id,
        token_jti=refresh_jti,
        expires_at=refresh_expires_at,
    )
    db.add(session)
    db.commit()
    return {
        "access_token": security.create_access_token(user_id),
        "refresh_token": security.create_refresh_token(user_id, jti=refresh_jti),
        "token_type": "bearer",
    }


@router.post("/register", response_model=UserResponse)
def register(user_in: UserCreate, request: Request, db: Session = Depends(deps.get_db)):
    client_ip = get_client_ip(request)
    rate_limiter.check("auth.register.ip", client_ip, limit=5, window_seconds=300)
    normalized_email = user_in.email.lower()
    user = db.query(User).filter(User.email == normalized_email).first()
    if user:
        raise HTTPException(
            status_code=400,
            detail="The user with this username already exists in the system.",
        )
    user = User(
        email=normalized_email,
        hashed_password=security.get_password_hash(user_in.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    
    # Initialize basic free subscription
    sub = Subscription(user_id=user.id)
    db.add(sub)
    db.commit()
    log_audit("auth.register", user.id, db=db, request_path=str(request.url.path))
    
    return user

@router.post("/login", response_model=Token)
def login_access_token(
    request: Request,
    db: Session = Depends(deps.get_db),
    form_data: OAuth2PasswordRequestForm = Depends(),
):
    client_ip = get_client_ip(request)
    username = form_data.username.strip().lower()
    rate_limiter.check("auth.login.ip", client_ip, limit=10, window_seconds=300)
    rate_limiter.check("auth.login.user", username, limit=5, window_seconds=300)
    user = db.query(User).filter(User.email == username).first()
    if not user or not security.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect email or password")
    elif not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    
    token_pair = _issue_token_pair(db, user.id)
    log_audit("auth.login", user.id, db=db, request_path=str(request.url.path))
    return token_pair

@router.post("/refresh", response_model=Token)
def refresh_token(request: RefreshTokenRequest, http_request: Request, db: Session = Depends(deps.get_db)):
    rate_limiter.check("auth.refresh.ip", get_client_ip(http_request), limit=20, window_seconds=300)
    try:
        payload = security.decode_token(request.refresh_token, expected_type="refresh")
        user_id = payload.get("sub")
        token_jti = payload.get("jti")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid token")

    session = db.query(RefreshSession).filter(RefreshSession.token_jti == token_jti).first()
    if not session or session.revoked_at is not None or session.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invalid token")

    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user:
        raise HTTPException(status_code=400, detail="User not found")

    session.revoked_at = datetime.now(timezone.utc)
    new_pair = _issue_token_pair(db, user.id)
    new_payload = security.decode_token(new_pair["refresh_token"], expected_type="refresh")
    session.replaced_by_jti = new_payload["jti"]
    db.add(session)
    db.commit()

    log_audit("auth.refresh", user.id, db=db, request_path=str(http_request.url.path))
    return new_pair

@router.get("/me", response_model=UserResponse)
def get_me(request: Request, current_user: User = Depends(deps.get_current_user)):
    rate_limiter.check("auth.me", str(current_user.id), limit=30, window_seconds=60)
    """
    Validation heartbeat to verify the current session token is still valid.
    """
    return current_user


@router.post("/bootstrap", response_model=AuthBootstrapResponse)
def bootstrap_authenticated_session(
    request: AuthBootstrapRequest,
    http_request: Request,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    has_connections = db.query(JiraConnection).filter(
        JiraConnection.user_id == current_user.id
    ).count() > 0

    if not has_connections:
        return AuthBootstrapResponse(view="setup", has_connections=False, bootstrap_context=None)

    bootstrap_context = None
    if request.instance_url:
        try:
            bootstrap_context = resolve_jira_bootstrap_context(
                JiraBootstrapContextRequest(
                    instance_url=request.instance_url,
                    issue_key=request.issue_key,
                    project_key=request.project_key,
                    project_id=request.project_id,
                    issue_type_id=request.issue_type_id,
                ),
                db,
                current_user,
                http_request,
            )
        except HTTPException:
            bootstrap_context = None

    log_audit("auth.bootstrap", current_user.id, db=db, request_path=str(http_request.url.path), view="main")
    return AuthBootstrapResponse(
        view="main",
        has_connections=True,
        bootstrap_context=bootstrap_context,
    )
