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
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

class JiraFieldMapping(Base):
    __tablename__ = "jira_field_mappings"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    project_key = Column(String, nullable=False)
    project_id = Column(String, nullable=True)
    issue_type_id = Column(String, nullable=False)
    visible_fields = Column(JSON, nullable=False, default=list)
    field_mappings = Column(JSON, nullable=False, default=dict) # Stores the custom structure {"Severity": "customfield_10001", ...}
    field_defaults = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
