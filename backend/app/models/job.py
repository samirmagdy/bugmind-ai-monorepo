from datetime import datetime
from typing import TYPE_CHECKING
from sqlalchemy import Integer, String, Float, DateTime, Text, Boolean, JSON, ForeignKey
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.user import User

class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True, index=True)
    job_type: Mapped[str] = mapped_column(String, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="queued", index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    workspace_id: Mapped[int] = mapped_column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True, index=True)
    target_key: Mapped[str] = mapped_column(String, nullable=False, index=True)
    project_key: Mapped[str] = mapped_column(String, nullable=False, index=True)

    progress_percentage: Mapped[float] = mapped_column(Float, default=0.0)
    current_step: Mapped[str] = mapped_column(String, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), onupdate=func.now(), nullable=True)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)

    error_code: Mapped[str] = mapped_column(String, nullable=True)
    error_message: Mapped[str] = mapped_column(Text, nullable=True)
    trace_id: Mapped[str] = mapped_column(String, nullable=True)

    result_payload: Mapped[dict] = mapped_column(JSON, nullable=True)
    request_payload: Mapped[dict] = mapped_column(JSON, nullable=True)
    retry_of_job_id: Mapped[str] = mapped_column(String, ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True, index=True)
    resume_of_job_id: Mapped[str] = mapped_column(String, ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True, index=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    is_cancelled: Mapped[bool] = mapped_column(Boolean, default=False)

    user: Mapped["User"] = relationship("User")
