from pydantic import BaseModel
from typing import Optional, Dict, Any
from app.models.jira import JiraAuthType

class JiraConnectionBase(BaseModel):
    auth_type: JiraAuthType
    host_url: str
    username: str
    verify_ssl: bool = True

class JiraConnectionCreate(JiraConnectionBase):
    token: str

class JiraConnectionUpdate(BaseModel):
    auth_type: Optional[JiraAuthType] = None
    host_url: Optional[str] = None
    username: Optional[str] = None
    token: Optional[str] = None
    verify_ssl: Optional[bool] = None
    is_active: Optional[bool] = None

class JiraConnectionResponse(JiraConnectionBase):
    id: int
    is_active: bool

    class Config:
        from_attributes = True

class JiraFieldMappingBase(BaseModel):
    project_key: str
    issue_type_id: str
    field_mappings: Dict[str, Any]

class JiraFieldMappingCreate(JiraFieldMappingBase):
    pass

class JiraFieldMappingResponse(JiraFieldMappingBase):
    id: int

    class Config:
        from_attributes = True
