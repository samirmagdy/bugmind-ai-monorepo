from datetime import datetime
from typing import Optional
from sqlalchemy import String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from app.core.database import Base

class User(Base):
    __tablename__ = "users"
    
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    hashed_password: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    google_subject: Mapped[Optional[str]] = mapped_column(String, unique=True, index=True, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    email_verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())
    
    # AI Settings
    custom_ai_model: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    encrypted_ai_api_key: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # Workspace
    default_workspace_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("workspaces.id", ondelete="SET NULL", use_alter=True, name="fk_users_default_workspace_id"),
        nullable=True,
    )
