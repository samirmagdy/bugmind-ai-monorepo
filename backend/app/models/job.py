from sqlalchemy import Column, Integer, String, Float, DateTime, Text, Boolean, JSON, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base

# NOTE: This model intentionally uses legacy Column() style instead of Mapped[]/mapped_column().
# SQLAlchemy 2.0.35 has a Python 3.14 incompatibility in de_stringify_union_elements()
# (Union.__getitem__ broken) that triggers on any nullable Mapped[] annotation.
# Upgrade to sqlalchemy>=2.0.38 to use Mapped[] style safely on Python 3.14.


class Job(Base):
    __tablename__ = "jobs"

    id = Column(String, primary_key=True, index=True)
    job_type = Column(String, nullable=False, index=True)
    status = Column(String, nullable=False, default="queued", index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True, index=True)
    target_key = Column(String, nullable=False, index=True)
    project_key = Column(String, nullable=False, index=True)

    progress_percentage = Column(Float, default=0.0)
    current_step = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)

    error_code = Column(String, nullable=True)
    error_message = Column(Text, nullable=True)
    trace_id = Column(String, nullable=True)

    result_payload = Column(JSON, nullable=True)
    is_cancelled = Column(Boolean, default=False)

    user = relationship("User")
