from pydantic import BaseModel, EmailStr
from typing import Optional, Literal

from app.schemas.jira import JiraBootstrapContextResponse

class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str

class RefreshTokenRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: Optional[str] = None


class TokenPayload(BaseModel):
    sub: str = None
    type: Optional[str] = None
    jti: Optional[str] = None


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ForgotPasswordResponse(BaseModel):
    message: str


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    code: str
    new_password: str


class GoogleLoginRequest(BaseModel):
    id_token: str


class AuthBootstrapRequest(BaseModel):
    instance_url: Optional[str] = None
    issue_key: Optional[str] = None
    project_key: Optional[str] = None
    project_id: Optional[str] = None
    issue_type_id: Optional[str] = None


class AuthBootstrapError(BaseModel):
    code: str
    message: str


class AuthBootstrapResponse(BaseModel):
    view: Literal["main", "setup"]
    has_connections: bool
    bootstrap_context: Optional[JiraBootstrapContextResponse] = None
    bootstrap_error: Optional[AuthBootstrapError] = None
