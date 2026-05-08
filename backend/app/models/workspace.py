import enum
from datetime import datetime
from typing import List, Optional
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Enum, JSON, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
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
    
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())
    
    owner: Mapped["User"] = relationship("User", foreign_keys=[owner_id])
    members: Mapped[List["WorkspaceMember"]] = relationship("WorkspaceMember", back_populates="workspace", cascade="all, delete-orphan")
    templates: Mapped[List["WorkspaceTemplate"]] = relationship("WorkspaceTemplate", back_populates="workspace", cascade="all, delete-orphan")
    template_assignments: Mapped[List["WorkspaceTemplateAssignment"]] = relationship("WorkspaceTemplateAssignment", back_populates="workspace", cascade="all, delete-orphan")

class WorkspaceMember(Base):
    __tablename__ = "workspace_members"
    
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role: Mapped[WorkspaceRole] = mapped_column(Enum(WorkspaceRole), nullable=False, default=WorkspaceRole.VIEWER)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())
    
    workspace: Mapped["Workspace"] = relationship("Workspace", back_populates="members")
    user: Mapped["User"] = relationship("User")

    __table_args__ = (
        UniqueConstraint("workspace_id", "user_id", name="uq_workspace_member"),
    )

class WorkspaceTemplateType(str, enum.Enum):
    BUG = "bug"
    TEST = "test"
    PRESET = "preset"
    STYLE = "style"

class WorkspaceTemplate(Base):
    __tablename__ = "workspace_templates"
    
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    template_type: Mapped[WorkspaceTemplateType] = mapped_column(Enum(WorkspaceTemplateType), nullable=False)
    content: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())
    
    workspace: Mapped["Workspace"] = relationship("Workspace", back_populates="templates")
    assignments: Mapped[List["WorkspaceTemplateAssignment"]] = relationship("WorkspaceTemplateAssignment", back_populates="template", cascade="all, delete-orphan")


class WorkspaceTemplateAssignment(Base):
    __tablename__ = "workspace_template_assignments"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("workspace_templates.id", ondelete="CASCADE"), nullable=False, index=True)
    project_key: Mapped[Optional[str]] = mapped_column(String, nullable=True, index=True)
    issue_type_id: Mapped[Optional[str]] = mapped_column(String, nullable=True, index=True)
    workflow: Mapped[Optional[str]] = mapped_column(String, nullable=True, index=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())

    workspace: Mapped["Workspace"] = relationship("Workspace", back_populates="template_assignments")
    template: Mapped["WorkspaceTemplate"] = relationship("WorkspaceTemplate", back_populates="assignments")
