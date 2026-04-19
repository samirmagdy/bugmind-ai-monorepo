from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, JSON
from sqlalchemy.sql import func
from app.core.database import Base

class BugGeneration(Base):
    __tablename__ = "bug_generations"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    jira_connection_id = Column(Integer, ForeignKey("jira_connections.id"), nullable=True) # Optional, can be generated offline
    input_text = Column(String, nullable=False)
    generated_bug = Column(JSON, nullable=False) # Stores the structured output
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class UsageLog(Base):
    __tablename__ = "usage_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    endpoint = Column(String, nullable=False)
    tokens_used = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
