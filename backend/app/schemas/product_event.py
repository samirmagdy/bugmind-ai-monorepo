from datetime import datetime
from typing import Any, Dict, Optional

from pydantic import BaseModel, ConfigDict, Field


class ProductEventCreate(BaseModel):
    event_type: str = Field(min_length=2, max_length=120)
    source: str = Field(default="sidepanel", max_length=80)
    workspace_id: Optional[int] = None
    issue_key: Optional[str] = Field(default=None, max_length=80)
    title: Optional[str] = Field(default=None, max_length=240)
    detail: Optional[str] = Field(default=None, max_length=2000)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ProductEventResponse(BaseModel):
    id: int
    user_id: int
    workspace_id: Optional[int] = None
    event_type: str
    source: str
    issue_key: Optional[str] = None
    title: Optional[str] = None
    detail: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
