import enum
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Enum, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base

class WorkspaceRole(str, enum.Enum):
    OWNER = "owner"
    ADMIN = "admin"
    QA_LEAD = "qa_lead"
    QA_ENGINEER = "qa_engineer"
    VIEWER = "viewer"

class Workspace(Base):
    __tablename__ = "workspaces"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    owner = relationship("User", foreign_keys=[owner_id])
    members = relationship("WorkspaceMember", back_populates="workspace", cascade="all, delete-orphan")
    templates = relationship("WorkspaceTemplate", back_populates="workspace", cascade="all, delete-orphan")
    template_assignments = relationship("WorkspaceTemplateAssignment", back_populates="workspace", cascade="all, delete-orphan")

class WorkspaceMember(Base):
    __tablename__ = "workspace_members"
    
    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(Enum(WorkspaceRole), nullable=False, default=WorkspaceRole.VIEWER)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    workspace = relationship("Workspace", back_populates="members")
    user = relationship("User")

class WorkspaceTemplateType(str, enum.Enum):
    BUG = "bug"
    TEST = "test"
    PRESET = "preset"
    STYLE = "style"

class WorkspaceTemplate(Base):
    __tablename__ = "workspace_templates"
    
    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False)
    template_type = Column(Enum(WorkspaceTemplateType), nullable=False)
    content = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    workspace = relationship("Workspace", back_populates="templates")
    assignments = relationship("WorkspaceTemplateAssignment", back_populates="template", cascade="all, delete-orphan")


class WorkspaceTemplateAssignment(Base):
    __tablename__ = "workspace_template_assignments"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    template_id = Column(Integer, ForeignKey("workspace_templates.id", ondelete="CASCADE"), nullable=False, index=True)
    project_key = Column(String, nullable=True, index=True)
    issue_type_id = Column(String, nullable=True, index=True)
    workflow = Column(String, nullable=True, index=True)
    is_default = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    workspace = relationship("Workspace", back_populates="template_assignments")
    template = relationship("WorkspaceTemplate", back_populates="assignments")
