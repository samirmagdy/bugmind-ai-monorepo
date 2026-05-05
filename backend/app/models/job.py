from sqlalchemy import Column, Integer, String, Float, DateTime, Text, Boolean, JSON, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base

class Job(Base):
    __tablename__ = "jobs"

    id = Column(String, primary_key=True, index=True)
    job_type = Column(String, nullable=False, index=True)
    status = Column(String, nullable=False, index=True, default="queued")
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    
    target_key = Column(String, nullable=False, index=True) # issue_key or epic_key
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
