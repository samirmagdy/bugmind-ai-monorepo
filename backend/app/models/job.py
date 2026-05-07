from datetime import datetime
from typing import Optional

from sqlalchemy import ForeignKey, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Float, JSON, String, Text

from app.core.database import Base


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True, index=True)
    job_type: Mapped[str] = mapped_column(String, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="queued", index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    workspace_id: Mapped[Optional[int]] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True, index=True)
    target_key: Mapped[str] = mapped_column(String, nullable=False, index=True)
    project_key: Mapped[str] = mapped_column(String, nullable=False, index=True)

    progress_percentage: Mapped[float] = mapped_column(Float, default=0.0)
    current_step: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    created_at: Mapped[Optional[datetime]] = mapped_column(nullable=True, server_default=func.now())
    updated_at: Mapped[Optional[datetime]] = mapped_column(nullable=True, onupdate=func.now())
    completed_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)

    error_code: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    trace_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    result_payload: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    is_cancelled: Mapped[bool] = mapped_column(default=False)

    user = relationship("User")
