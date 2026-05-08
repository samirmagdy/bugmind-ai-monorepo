from datetime import datetime, timedelta, timezone
import logging
import secrets
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.api import deps
from app.core import security
from app.core.audit import log_audit
from app.core.rate_limit import rate_limiter
from app.core.request_security import get_client_ip
from app.models.auth import PasswordResetCode, RefreshSession
from app.models.jira import JiraConnection
from app.models.subscription import Subscription
from app.models.user import User
from app.schemas.jira import JiraBootstrapContextRequest
from app.schemas.token import (
    AuthBootstrapError,
    AuthBootstrapRequest,
    AuthBootstrapResponse,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    GoogleLoginRequest,
    LogoutRequest,
    RefreshTokenRequest,
    ResetPasswordRequest,
    Token,
)
from app.schemas.user import UserCreate, UserResponse
from app.services.auth.google import verify_google_id_token
from app.services.auth.mail import send_password_reset_code
from app.services.jira.bootstrap_service import resolve_jira_bootstrap_context

router = APIRouter()
logger = logging.getLogger("bugmind.http")


def _ensure_active_user(user: User) -> User:
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return user


def _issue_token_pair(db: Session, user_id: int) -> Dict[str, str]:
    refresh_expires_at = datetime.now(timezone.utc) + timedelta(days=security.settings.REFRESH_TOKEN_EXPIRE_DAYS)
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


def _create_user_with_subscription(
    db: Session,
    *,
    email: str,
    hashed_password: Optional[str],
    google_subject: Optional[str] = None,
) -> User:
    user = User(
        email=email,
        hashed_password=hashed_password,
        google_subject=google_subject,
        email_verified_at=datetime.now(timezone.utc),
    )
    try:
        db.add(user)
        db.flush()
        db.add(Subscription(user_id=user.id))
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(user)
    return user


def _revoke_all_refresh_sessions(db: Session, user_id: int) -> None:
    now = datetime.now(timezone.utc)
    sessions = db.query(RefreshSession).filter(
        RefreshSession.user_id == user_id,
        RefreshSession.revoked_at.is_(None),
    ).all()
    for session in sessions:
        session.revoked_at = now
        db.add(session)
    db.commit()


def _build_reset_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _is_expired(value: datetime) -> bool:
    comparable = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return comparable <= datetime.now(timezone.utc)


@router.post("/register", response_model=UserResponse)
def register(user_in: UserCreate, request: Request, db: Session = Depends(deps.get_db)):
    client_ip = get_client_ip(request)
    rate_limiter.check("auth.register.ip", client_ip, limit=5, window_seconds=300)
    normalized_email = user_in.email.lower()
    existing_user = db.query(User).filter(User.email == normalized_email).first()
    if existing_user:
        raise HTTPException(
            status_code=400,
            detail="The user with this username already exists in the system.",
        )

    user = _create_user_with_subscription(
        db,
        email=normalized_email,
        hashed_password=security.get_password_hash(user_in.password),
    )
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
    if not user or not user.hashed_password or not security.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect email or password")

    _ensure_active_user(user)
    token_pair = _issue_token_pair(db, user.id)
    log_audit("auth.login", user.id, db=db, request_path=str(request.url.path))
    return token_pair


@router.get("/google/config")
def google_login_config():
    return {
        "client_id": security.settings.GOOGLE_OAUTH_CLIENT_ID,
        "enabled": bool(security.settings.GOOGLE_OAUTH_CLIENT_ID),
    }


@router.post("/google", response_model=Token)
def google_login(request: GoogleLoginRequest, http_request: Request, db: Session = Depends(deps.get_db)):
    rate_limiter.check("auth.google.ip", get_client_ip(http_request), limit=10, window_seconds=300)
    google_profile = verify_google_id_token(request.id_token)
    normalized_email = google_profile["email"]
    rate_limiter.check("auth.google.user", normalized_email, limit=10, window_seconds=300)

    user = db.query(User).filter(User.google_subject == google_profile["google_subject"]).first()
    if not user:
        user = db.query(User).filter(User.email == normalized_email).first()
        if user and user.google_subject and user.google_subject != google_profile["google_subject"]:
            raise HTTPException(status_code=409, detail="Google account is already linked to another user")
        if user:
            user.google_subject = google_profile["google_subject"]
            user.email_verified_at = user.email_verified_at or datetime.now(timezone.utc)
            db.add(user)
            db.commit()
            db.refresh(user)
        else:
            user = _create_user_with_subscription(
                db,
                email=normalized_email,
                hashed_password=None,
                google_subject=google_profile["google_subject"],
            )

    _ensure_active_user(user)
    token_pair = _issue_token_pair(db, user.id)
    log_audit("auth.login.google", user.id, db=db, request_path=str(http_request.url.path))
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
    if not session or session.revoked_at is not None or _is_expired(session.expires_at):
        raise HTTPException(status_code=400, detail="Invalid token")

    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user:
        raise HTTPException(status_code=400, detail="User not found")

    _ensure_active_user(user)
    session.revoked_at = datetime.now(timezone.utc)
    new_pair = _issue_token_pair(db, user.id)
    new_payload = security.decode_token(new_pair["refresh_token"], expected_type="refresh")
    session.replaced_by_jti = new_payload["jti"]
    db.add(session)
    db.commit()

    log_audit("auth.refresh", user.id, db=db, request_path=str(http_request.url.path))
    return new_pair


@router.post("/logout")
def logout(request: LogoutRequest, http_request: Request, db: Session = Depends(deps.get_db)):
    if request.refresh_token:
        try:
            payload = security.decode_token(request.refresh_token, expected_type="refresh")
        except ValueError:
            return {"success": True}

        token_jti = payload.get("jti")
        session = db.query(RefreshSession).filter(RefreshSession.token_jti == token_jti).first()
        if session and session.revoked_at is None:
            session.revoked_at = datetime.now(timezone.utc)
            db.add(session)
            db.commit()
            log_audit("auth.logout", session.user_id, db=db, request_path=str(http_request.url.path))

    return {"success": True}


@router.get("/me", response_model=UserResponse)
def get_me(request: Request, current_user: User = Depends(deps.get_current_user)):
    rate_limiter.check("auth.me", str(current_user.id), limit=30, window_seconds=60)
    return current_user


@router.post("/password/forgot", response_model=ForgotPasswordResponse)
def forgot_password(request: ForgotPasswordRequest, http_request: Request, db: Session = Depends(deps.get_db)):
    normalized_email = request.email.lower()
    client_ip = get_client_ip(http_request)
    rate_limiter.check("auth.password_forgot.ip", client_ip, limit=5, window_seconds=300)
    rate_limiter.check("auth.password_forgot.user", normalized_email, limit=3, window_seconds=300)

    user = db.query(User).filter(User.email == normalized_email).first()
    if user and user.is_active:
        now = datetime.now(timezone.utc)
        code = _build_reset_code()
        db.query(PasswordResetCode).filter(
            PasswordResetCode.user_id == user.id,
            PasswordResetCode.used_at.is_(None),
        ).update({PasswordResetCode.used_at: now}, synchronize_session=False)
        db.add(
            PasswordResetCode(
                user_id=user.id,
                email=normalized_email,
                code_hash=security.hash_password_reset_code(normalized_email, code),
                expires_at=now + timedelta(minutes=security.settings.PASSWORD_RESET_CODE_EXPIRE_MINUTES),
            )
        )
        if not send_password_reset_code(to_email=normalized_email, code=code):
            db.rollback()
            logger.warning("password_reset_code_not_persisted email=%s reason=email_not_sent", normalized_email)
            return ForgotPasswordResponse(message="If an account exists for that email, a reset code has been sent.")
        db.commit()
        log_audit("auth.password_forgot", user.id, db=db, request_path=str(http_request.url.path))

    return ForgotPasswordResponse(message="If an account exists for that email, a reset code has been sent.")


@router.post("/password/reset", response_model=ForgotPasswordResponse)
def reset_password(request: ResetPasswordRequest, http_request: Request, db: Session = Depends(deps.get_db)):
    normalized_email = request.email.lower()
    client_ip = get_client_ip(http_request)
    rate_limiter.check("auth.password_reset.ip", client_ip, limit=8, window_seconds=300)
    rate_limiter.check("auth.password_reset.user", normalized_email, limit=5, window_seconds=300)

    validated = UserCreate(email=normalized_email, password=request.new_password)
    user = db.query(User).filter(User.email == normalized_email).first()
    if not user:
        raise HTTPException(status_code=400, detail="Invalid reset code")

    _ensure_active_user(user)
    code_hash = security.hash_password_reset_code(normalized_email, request.code.strip())
    reset_record = db.query(PasswordResetCode).filter(
        PasswordResetCode.user_id == user.id,
        PasswordResetCode.email == normalized_email,
        PasswordResetCode.code_hash == code_hash,
        PasswordResetCode.used_at.is_(None),
    ).order_by(PasswordResetCode.created_at.desc()).first()
    if not reset_record or _is_expired(reset_record.expires_at):
        raise HTTPException(status_code=400, detail="Invalid reset code")

    reset_record.used_at = datetime.now(timezone.utc)
    user.hashed_password = security.get_password_hash(validated.password)
    user.email_verified_at = user.email_verified_at or datetime.now(timezone.utc)
    db.add(reset_record)
    db.add(user)
    db.commit()
    _revoke_all_refresh_sessions(db, user.id)
    log_audit("auth.password_reset", user.id, db=db, request_path=str(http_request.url.path))
    return ForgotPasswordResponse(message="Password updated successfully. Please sign in again.")


from app.models.workspace import Workspace, WorkspaceMember

@router.post("/bootstrap", response_model=AuthBootstrapResponse)
def bootstrap_authenticated_session(
    request: AuthBootstrapRequest,
    http_request: Request,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    # Fetch workspaces
    user_workspaces = db.query(Workspace).join(WorkspaceMember).filter(
        WorkspaceMember.user_id == current_user.id
    ).all()
    
    workspace_list = []
    for ws in user_workspaces:
        # Find role
        member = db.query(WorkspaceMember).filter(
            WorkspaceMember.workspace_id == ws.id,
            WorkspaceMember.user_id == current_user.id
        ).first()
        
        workspace_list.append({
            "id": ws.id,
            "name": ws.name,
            "owner_id": ws.owner_id,
            "role": member.role.value if member else "viewer"
        })

    has_connections = db.query(JiraConnection).filter(
        JiraConnection.user_id == current_user.id
    ).count() > 0

    if not has_connections:
        # Check shared connections
        has_connections = db.query(JiraConnection).join(WorkspaceMember, JiraConnection.workspace_id == WorkspaceMember.workspace_id).filter(
            WorkspaceMember.user_id == current_user.id,
            JiraConnection.is_shared
        ).count() > 0

    if not has_connections:
        return AuthBootstrapResponse(
            view="setup", 
            has_connections=False, 
            bootstrap_context=None, 
            bootstrap_error=None,
            workspaces=workspace_list,
            active_workspace_id=current_user.default_workspace_id
        )

    bootstrap_context = None
    bootstrap_error = None
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
        except HTTPException as exc:
            bootstrap_context = None
            bootstrap_error = AuthBootstrapError(
                code="JIRA_BOOTSTRAP_FAILED",
                message=str(exc.detail) if exc.detail else "Failed to resolve Jira bootstrap context",
            )

    log_audit("auth.bootstrap", current_user.id, db=db, request_path=str(http_request.url.path), view="main")
    return AuthBootstrapResponse(
        view="main",
        has_connections=True,
        bootstrap_context=bootstrap_context,
        bootstrap_error=bootstrap_error,
        workspaces=workspace_list,
        active_workspace_id=current_user.default_workspace_id
    )
