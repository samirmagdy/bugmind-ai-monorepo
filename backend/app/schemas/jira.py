from pydantic import BaseModel
from typing import Optional, Dict, Any, List
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


class JiraBootstrapContextRequest(BaseModel):
    instance_url: str
    project_key: Optional[str] = None
    project_id: Optional[str] = None
    issue_type_id: Optional[str] = None


class JiraIssueTypeResponse(BaseModel):
    id: str
    name: str
    icon_url: Optional[str] = None
    subtask: bool = False


class JiraFieldResponse(BaseModel):
    key: str
    name: str
    type: str
    required: bool
    allowed_values: Optional[List[Dict[str, Any]]] = None


class JiraMetadataResponse(BaseModel):
    project_key: str
    project_id: Optional[str] = None
    issue_type_id: Optional[str] = None
    fields: List[JiraFieldResponse]


class JiraBootstrapContextResponse(BaseModel):
    connection_id: int
    instance_url: str
    platform: JiraAuthType
    verify_ssl: bool = True
    issue_types: List[JiraIssueTypeResponse] = []
    selected_issue_type: Optional[JiraIssueTypeResponse] = None
    visible_fields: List[str] = []
    ai_mapping: Dict[str, Any] = {}
    jira_metadata: Optional[JiraMetadataResponse] = None
