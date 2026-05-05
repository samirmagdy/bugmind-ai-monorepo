from typing import Any, Dict, List, Optional
from datetime import datetime
from pydantic import BaseModel, EmailStr
from app.models.workspace import WorkspaceRole, WorkspaceTemplateType

# Workspace Member Schemas
class WorkspaceMemberBase(BaseModel):
    user_id: int
    role: WorkspaceRole

class WorkspaceMemberCreate(WorkspaceMemberBase):
    pass

class WorkspaceMemberUpdate(BaseModel):
    role: WorkspaceRole

class WorkspaceMemberResponse(WorkspaceMemberBase):
    id: int
    workspace_id: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    email: Optional[str] = None # Helper for UI

    class Config:
        from_attributes = True

# Workspace Template Schemas
class WorkspaceTemplateBase(BaseModel):
    name: str
    template_type: WorkspaceTemplateType
    content: dict

class WorkspaceTemplateCreate(WorkspaceTemplateBase):
    pass

class WorkspaceTemplateUpdate(BaseModel):
    name: Optional[str] = None
    content: Optional[dict] = None

class WorkspaceTemplateResponse(WorkspaceTemplateBase):
    id: int
    workspace_id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

# Workspace Schemas
class WorkspaceBase(BaseModel):
    name: str

class WorkspaceCreate(WorkspaceBase):
    pass

class WorkspaceUpdate(WorkspaceBase):
    pass

class WorkspaceResponse(WorkspaceBase):
    id: int
    owner_id: int
    role: Optional[WorkspaceRole] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True

class WorkspaceDetailResponse(WorkspaceResponse):
    members: List[WorkspaceMemberResponse]
    templates: List[WorkspaceTemplateResponse]


class WorkspaceAuditLogResponse(BaseModel):
    id: int
    user_id: Optional[int] = None
    action: str
    metadata: Dict[str, Any] = {}
    created_at: datetime

    class Config:
        from_attributes = True


class WorkspaceUsageResponse(BaseModel):
    workspace_id: int
    members_count: int
    templates_count: int
    shared_connections_count: int
    jobs_count: int
    audit_events_count: int
