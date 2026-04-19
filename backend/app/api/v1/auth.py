from fastapi import APIRouter, Depends, HTTPException, status
from jose import jwt
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from app.api import deps
from app.schemas.token import Token, RefreshTokenRequest, AuthBootstrapRequest, AuthBootstrapResponse
from app.schemas.user import UserCreate, UserResponse
from app.models.user import User
from app.models.jira import JiraConnection
from app.models.subscription import Subscription
from app.core import security
from app.core.config import settings
from app.api.v1.jira import resolve_jira_bootstrap_context
from app.schemas.jira import JiraBootstrapContextRequest

router = APIRouter()

@router.post("/register", response_model=UserResponse)
def register(user_in: UserCreate, db: Session = Depends(deps.get_db)):
    user = db.query(User).filter(User.email == user_in.email).first()
    if user:
        raise HTTPException(
            status_code=400,
            detail="The user with this username already exists in the system.",
        )
    user = User(
        email=user_in.email,
        hashed_password=security.get_password_hash(user_in.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    
    # Initialize basic free subscription
    sub = Subscription(user_id=user.id)
    db.add(sub)
    db.commit()
    
    return user

@router.post("/login", response_model=Token)
def login_access_token(db: Session = Depends(deps.get_db), form_data: OAuth2PasswordRequestForm = Depends()):
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not security.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect email or password")
    elif not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    
    return {
        "access_token": security.create_access_token(user.id),
        "refresh_token": security.create_refresh_token(user.id),
        "token_type": "bearer",
    }

@router.post("/refresh", response_model=Token)
def refresh_token(request: RefreshTokenRequest, db: Session = Depends(deps.get_db)):
    try:
        payload = jwt.decode(request.refresh_token, settings.SECRET_KEY, algorithms=[security.ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=400, detail="Invalid token type")
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=400, detail="Invalid token")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid token")
        
    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user:
        raise HTTPException(status_code=400, detail="User not found")
        
    return {
        "access_token": security.create_access_token(user.id),
        "refresh_token": security.create_refresh_token(user.id),
        "token_type": "bearer",
    }

@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(deps.get_current_user)):
    """
    Validation heartbeat to verify the current session token is still valid.
    """
    return current_user


@router.post("/bootstrap", response_model=AuthBootstrapResponse)
def bootstrap_authenticated_session(
    request: AuthBootstrapRequest,
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
                    project_key=request.project_key,
                    project_id=request.project_id,
                    issue_type_id=request.issue_type_id,
                ),
                db,
                current_user,
            )
        except HTTPException:
            bootstrap_context = None

    return AuthBootstrapResponse(
        view="main",
        has_connections=True,
        bootstrap_context=bootstrap_context,
    )
