from pydantic import BaseModel, ConfigDict
from typing import Optional, Any
from datetime import datetime

class JobResponse(BaseModel):
    id: str
    job_type: str
    status: str
    target_key: str
    project_key: str
    progress_percentage: float
    current_step: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    result_payload: Optional[Any] = None
    request_payload: Optional[Any] = None
    retry_of_job_id: Optional[str] = None
    resume_of_job_id: Optional[str] = None
    retry_count: int = 0
    is_cancelled: bool

    model_config = ConfigDict(from_attributes=True)

class EpicJobCreateRequest(BaseModel):
    jira_connection_id: int
    epic_key: str
    issue_type_id: str
    project_key: Optional[str] = None
    project_id: Optional[str] = None
    issue_type_name: Optional[str] = None
    brd_text: Optional[str] = None
