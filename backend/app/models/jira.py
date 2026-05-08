import enum
from datetime import datetime
from typing import Optional, List
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Enum, JSON
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from app.core.database import Base

class JiraAuthType(str, enum.Enum):
    CLOUD = "cloud"
    SERVER = "server"

class JiraConnection(Base):
    __tablename__ = "jira_connections"
    
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))
    auth_type: Mapped[JiraAuthType] = mapped_column(Enum(JiraAuthType), nullable=False)
    host_url: Mapped[str] = mapped_column(String, nullable=False)
    username: Mapped[str] = mapped_column(String, nullable=False)
    encrypted_token: Mapped[str] = mapped_column(String, nullable=False) # AES-256 encrypted personal access token or API token
    verify_ssl: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    xray_cloud_client_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    encrypted_xray_cloud_client_secret: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    workspace_id: Mapped[Optional[int]] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True, index=True)
    is_shared: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())

    @property
    def has_xray_cloud_credentials(self) -> bool:
        return bool(self.xray_cloud_client_id and self.encrypted_xray_cloud_client_secret)

class JiraFieldMapping(Base):
    __tablename__ = "jira_field_mappings"
    
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))
    jira_connection_id: Mapped[Optional[int]] = mapped_column(ForeignKey("jira_connections.id", ondelete="CASCADE"), nullable=True, index=True)
    workspace_id: Mapped[Optional[int]] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True, index=True)
    project_key: Mapped[str] = mapped_column(String, nullable=False)
    project_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    issue_type_id: Mapped[str] = mapped_column(String, nullable=False)
    visible_fields: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    field_mappings: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict) # Stores the custom structure {"Severity": "customfield_10001", ...}
    field_defaults: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    is_shared: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())


class JiraSyncHistory(Base):
    __tablename__ = "jira_sync_history"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    jira_connection_id: Mapped[int] = mapped_column(ForeignKey("jira_connections.id", ondelete="CASCADE"), nullable=False, index=True)
    story_issue_key: Mapped[str] = mapped_column(String, nullable=False, index=True)
    project_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    project_key: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    operation: Mapped[str] = mapped_column(String, nullable=False, default="xray_publish")
    status: Mapped[str] = mapped_column(String, nullable=False, default="success")
    created_test_keys: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    updated_test_keys: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    warnings: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    request_payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    response_payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    error_detail: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
