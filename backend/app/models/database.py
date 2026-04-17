from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, JSON, Enum as SQLEnum, Boolean, UniqueConstraint
from sqlalchemy.sql import func
from ..db.session import Base
import enum

class AuthType(str, enum.Enum):
    CLOUD = "cloud"
    SERVER = "server"

class SubscriptionStatus(str, enum.Enum):
    ACTIVE = "active"
    CANCELED = "canceled"
    PAST_DUE = "past_due"
    INCOMPLETE = "incomplete"

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class JiraConnection(Base):
    __tablename__ = "jira_connections"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    base_url = Column(String, nullable=False)
    auth_type = Column(SQLEnum(AuthType), nullable=False)
    verify_ssl = Column(Boolean, default=True)
    # Encrypted token or PAT
    token_encrypted = Column(String, nullable=False)
    # Additional context like username for Basic Auth (Jira Server)
    username = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Ensure one connection per user/domain
    __table_args__ = (
        UniqueConstraint('user_id', 'base_url', name='_user_jira_domain_uc'),
    )

class BugGeneration(Base):
    __tablename__ = "bug_generations"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    issue_key = Column(String, index=True, nullable=False)
    input_data = Column(JSON, nullable=False)  # Story + AC
    ai_output = Column(JSON, nullable=False)   # Generated Bugs
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    stripe_customer_id = Column(String, unique=True, nullable=False)
    stripe_subscription_id = Column(String, unique=True, nullable=True)
    plan = Column(String, default="free")  # free, pro, enterprise
    status = Column(SQLEnum(SubscriptionStatus), default=SubscriptionStatus.INCOMPLETE)
    current_period_end = Column(DateTime(timezone=True), nullable=True)

class UsageLog(Base):
    __tablename__ = "usage_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    action = Column(String, nullable=False)  # e.g., "generate_bug", "create_jira_ticket"
    tokens_used = Column(Integer, default=0)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())

class AISettings(Base):
    __tablename__ = "ai_settings"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    openrouter_key_encrypted = Column(String, nullable=True)
    custom_model = Column(String, nullable=True)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

class JiraFieldMapping(Base):
    __tablename__ = "jira_field_mappings"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    base_url = Column(String, nullable=True) # Domain context
    project_id = Column(String, nullable=True) # Numeric ID
    project_key = Column(String, nullable=False)
    issue_type_id = Column(String, nullable=True)
    issue_type_name = Column(String, nullable=True)
    visible_fields = Column(JSON, default=[]) # List of field IDs
    ai_mapping = Column(JSON, default={})    # Mapping of AI property -> Jira field ID
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())
    
    # Scoped settings per user project on specific server
    __table_args__ = (
        UniqueConstraint('user_id', 'base_url', 'project_id', 'project_key', 'issue_type_id', name='_user_proj_type_uc'),
    )
