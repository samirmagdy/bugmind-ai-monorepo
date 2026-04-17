from pydantic import BaseModel, EmailStr, HttpUrl
from typing import Optional, List, Dict, Any
from datetime import datetime

# Auth
class UserBase(BaseModel):
    email: str

class UserCreate(UserBase):
    password: str

class UserResponse(UserBase):
    id: int
    created_at: datetime
    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str

# Jira
class JiraConnect(BaseModel):
    base_url: str
    auth_type: str  # cloud or server
    token: str
    username: Optional[str] = None
    verify_ssl: bool = True

class JiraField(BaseModel):
    key: str
    name: str
    type: str
    required: bool = False
    allowed_values: Optional[List[Dict[str, Any]]] = None

class JiraMetadataResponse(BaseModel):
    project_key: str
    issue_type_id: Optional[str] = None
    fields: List[JiraField]

class JiraIssue(BaseModel):
    key: str
    summary: str
    description: Optional[str] = None
    acceptance_criteria: Optional[str] = None

# Bug Generation
class GenerateBugsRequest(BaseModel):
    issue_key: str
    summary: str
    description: str
    acceptance_criteria: str
    field_context: Optional[List[JiraField]] = None

class ManualBugRequest(BaseModel):
    description: str
    issue_key: str
    jira_context: Optional[str] = None

class BugReport(BaseModel):
    summary: str
    description: str
    steps_to_reproduce: str
    expected_result: str
    actual_result: str
    severity: str
    extra_fields: Optional[Dict[str, Any]] = None

class CreateBugsRequest(BaseModel):
    issue_key: str
    project_key: str
    project_id: Optional[str] = None
    base_url: str
    bugs: List[BugReport]
    extra_fields: Optional[Dict[str, Any]] = None

# Subscriptions
class SubscriptionResponse(BaseModel):
    plan: str
    status: str
    current_period_end: Optional[datetime]

# Jira App Settings
class IssueType(BaseModel):
    id: str
    name: str
    iconUrl: Optional[str] = None
    subtask: bool

class FieldSettingsUpdate(BaseModel):
    project_id: Optional[str] = None
    project_key: str
    base_url: str
    issue_type_id: Optional[str] = None
    issue_type_name: Optional[str] = None
    visible_fields: List[str]
    ai_mapping: Optional[Dict[str, str]] = None
    verify_ssl: Optional[bool] = None

class FieldSettingsResponse(BaseModel):
    project_id: Optional[str] = None
    project_key: str
    issue_type_id: Optional[str] = None
    issue_type_name: Optional[str] = None
    visible_fields: List[str]
    ai_mapping: Optional[Dict[str, str]] = None
    verify_ssl: bool = True

# AI Settings
class AISettingsUpdate(BaseModel):
    openrouter_key: Optional[str] = None
    custom_model: Optional[str] = None

class AISettingsResponse(BaseModel):
    has_custom_key: bool
    custom_model: Optional[str] = None
    updated_at: Optional[datetime] = None
