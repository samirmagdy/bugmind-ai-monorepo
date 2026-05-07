from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Enum, JSON
from sqlalchemy.sql import func
from app.core.database import Base
import enum

class JiraAuthType(str, enum.Enum):
    CLOUD = "cloud"
    SERVER = "server"

class JiraConnection(Base):
    __tablename__ = "jira_connections"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    auth_type = Column(Enum(JiraAuthType), nullable=False)
    host_url = Column(String, nullable=False)
    username = Column(String, nullable=False)
    encrypted_token = Column(String, nullable=False) # AES-256 encrypted personal access token or API token
    verify_ssl = Column(Boolean, nullable=False, default=True)
    is_active = Column(Boolean, default=True)
    xray_cloud_client_id = Column(String, nullable=True)
    encrypted_xray_cloud_client_secret = Column(String, nullable=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True, index=True)
    is_shared = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    @property
    def has_xray_cloud_credentials(self) -> bool:
        return bool(self.xray_cloud_client_id and self.encrypted_xray_cloud_client_secret)

class JiraFieldMapping(Base):
    __tablename__ = "jira_field_mappings"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    jira_connection_id = Column(Integer, ForeignKey("jira_connections.id", ondelete="CASCADE"), nullable=True, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True, index=True)
    project_key = Column(String, nullable=False)
    project_id = Column(String, nullable=True)
    issue_type_id = Column(String, nullable=False)
    visible_fields = Column(JSON, nullable=False, default=list)
    field_mappings = Column(JSON, nullable=False, default=dict) # Stores the custom structure {"Severity": "customfield_10001", ...}
    field_defaults = Column(JSON, nullable=False, default=dict)
    is_shared = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class JiraSyncHistory(Base):
    __tablename__ = "jira_sync_history"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    jira_connection_id = Column(Integer, ForeignKey("jira_connections.id", ondelete="CASCADE"), nullable=False, index=True)
    story_issue_key = Column(String, nullable=False, index=True)
    project_id = Column(String, nullable=True)
    project_key = Column(String, nullable=True)
    operation = Column(String, nullable=False, default="xray_publish")
    status = Column(String, nullable=False, default="success")
    created_test_keys = Column(JSON, nullable=False, default=list)
    updated_test_keys = Column(JSON, nullable=False, default=list)
    warnings = Column(JSON, nullable=False, default=list)
    request_payload = Column(JSON, nullable=False, default=dict)
    response_payload = Column(JSON, nullable=False, default=dict)
    error_detail = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
