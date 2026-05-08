from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from app.core.database import Base

class BugGeneration(Base):
    __tablename__ = "bug_generations"
    
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    jira_connection_id: Mapped[Optional[int]] = mapped_column(ForeignKey("jira_connections.id"), nullable=True) # Optional, can be generated offline
    input_text: Mapped[str] = mapped_column(String, nullable=False)
    generated_bug: Mapped[dict] = mapped_column(JSON, nullable=False) # Stores the structured output
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

class UsageLog(Base):
    __tablename__ = "usage_logs"
    
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    endpoint: Mapped[str] = mapped_column(String, nullable=False)
    tokens_used: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
