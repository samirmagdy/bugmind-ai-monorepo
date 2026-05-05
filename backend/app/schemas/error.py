from typing import Any, Dict, Optional
from pydantic import BaseModel, Field

class APIErrorResponse(BaseModel):
    code: str = Field(..., description="Machine-readable error code")
    message: str = Field(..., description="Human-readable error message")
    user_action: str = Field(..., description="Suggested action for the user to resolve the issue")
    trace_id: str = Field(..., description="Request trace ID for debugging")
    details: Dict[str, Any] = Field(default_factory=dict, description="Additional technical details")
    detail: str = Field(..., description="Legacy field for backward compatibility")
