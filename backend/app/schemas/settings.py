from pydantic import BaseModel
from typing import Optional

class AISettingsResponse(BaseModel):
    custom_model: Optional[str] = None
    has_custom_key: bool

class AISettingsUpdate(BaseModel):
    custom_model: Optional[str] = None
    openrouter_key: Optional[str] = None

class JiraSettingsUpdate(BaseModel):
    jira_connection_id: int
    project_key: str
    project_id: Optional[str] = None
    issue_type_id: str
    visible_fields: Optional[list] = None
    ai_mapping: Optional[dict] = None
