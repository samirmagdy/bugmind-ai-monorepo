import os
from pathlib import Path
from typing import Any, Optional

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).resolve().parents[2] / ".env"),
        extra="ignore",
    )

    PROJECT_NAME: str = "BugMind AI API"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: str = "production" if os.getenv("RENDER") else "development"
    
    SECRET_KEY: str = "CHANGE_THIS_IN_PRODUCTION_b8m9k2n3m4n5b6g7v8a9c0d1e2f3a4b"
    ENCRYPTION_KEY: str = "CHANGE_THIS_IN_PRODUCTION_MUST_BE_32_BYTES_!"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    JWT_ISSUER: str = "bugmind-api"
    JWT_AUDIENCE: str = "bugmind-clients"
    DATABASE_URL: str = ""
    REDIS_URL: str = "redis://localhost:6379/0"
    ALGORITHM: str = "HS256"
    FRONTEND_URL: str = "http://localhost:3000"
    CORS_ORIGINS: str = ""
    EXTENSION_ORIGINS: str = "chrome-extension://ljofgjhfclifhgchelabmoknbdmkoomp"
    ALLOWED_HOSTS: str = ""
    EXPOSE_API_DOCS: bool = False
    ALLOW_INSECURE_JIRA_SSL: bool = False
    ALLOW_PRIVATE_JIRA_HOSTS: bool = False
    LOG_LEVEL: str = "INFO"
    RATE_LIMITS_ENABLED: bool = True
    OPENROUTER_API_KEY: Optional[str] = None
    OPENROUTER_MODEL: str = "google/gemini-2.0-flash-001"
    OPENROUTER_CONNECT_TIMEOUT_SECONDS: float = 10.0
    OPENROUTER_READ_TIMEOUT_SECONDS: float = 75.0
    OPENROUTER_WRITE_TIMEOUT_SECONDS: float = 20.0
    OPENROUTER_POOL_TIMEOUT_SECONDS: float = 20.0
    OPENROUTER_RETRIES: int = 2
    OPENROUTER_MAX_TOKENS: int = 1800
    STRIPE_SECRET_KEY: Optional[str] = None
    STRIPE_WEBHOOK_SECRET: Optional[str] = None
    XRAY_CLOUD_CLIENT_ID: Optional[str] = None
    XRAY_CLOUD_CLIENT_SECRET: Optional[str] = None
    SMTP_HOST: Optional[str] = None
    SMTP_PORT: int = 587
    SMTP_USERNAME: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    SMTP_FROM_EMAIL: Optional[str] = None
    SMTP_USE_TLS: bool = True
    PASSWORD_RESET_CODE_EXPIRE_MINUTES: int = 15
    GOOGLE_OAUTH_CLIENT_ID: Optional[str] = None

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def normalize_db_url(cls, v: Any) -> Any:
        if isinstance(v, str):
            if v.startswith("postgres://"):
                v = v.replace("postgres://", "postgresql+psycopg://", 1)
            elif v.startswith("postgresql://") and "+psycopg" not in v:
                v = v.replace("postgresql://", "postgresql+psycopg://", 1)
            
            # Ensure SSL mode for production postgres connections
            if v.startswith("postgresql") and "sslmode=" not in v:
                separator = "&" if "?" in v else "?"
                v = f"{v}{separator}sslmode=require"
        
        # Raise error if DATABASE_URL is empty (all environments)
        if not v:
            raise ValueError("DATABASE_URL is mandatory. Please provide a valid database connection string (PostgreSQL or SQLite) via environment variables.")
        return v

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT.lower() == "production"

    @property
    def cors_origins_list(self) -> list[str]:
        origins = []
        if self.FRONTEND_URL and not self.is_production:
            origins.append(self.FRONTEND_URL.strip().rstrip("/"))
            
        raw = (self.CORS_ORIGINS or "").strip()
        if raw:
            origins.extend([origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()])

        origins.extend(self.extension_origins_list)
            
        return list(set(origins))  # Unique origins only

    @property
    def extension_origins_list(self) -> list[str]:
        raw = (self.EXTENSION_ORIGINS or "").strip()
        if not raw:
            return []
        return list({
            origin.strip().rstrip("/")
            for origin in raw.split(",")
            if origin.strip()
        })

    @property
    def allowed_hosts_list(self) -> list[str]:
        raw = (self.ALLOWED_HOSTS or "").strip()
        if not raw:
            return []
        return [host.strip() for host in raw.split(",") if host.strip()]

    @property
    def should_enforce_rate_limits(self) -> bool:
        if not self.RATE_LIMITS_ENABLED:
            return False
        return self.is_production

    @property
    def allow_private_jira_hosts_effective(self) -> bool:
        if self.ALLOW_PRIVATE_JIRA_HOSTS:
            return True
        return not self.is_production

    @property
    def docs_enabled(self) -> bool:
        return self.EXPOSE_API_DOCS or not self.is_production

settings = Settings()
