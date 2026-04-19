from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    PROJECT_NAME: str = "BugMind AI API"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    
    SECRET_KEY: str = "CHANGE_THIS_IN_PRODUCTION_b8m9k2n3m4n5b6g7v8a9c0d1e2f3a4b"
    ENCRYPTION_KEY: str = "CHANGE_THIS_IN_PRODUCTION_MUST_BE_32_BYTES_!"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    DATABASE_URL: str = "sqlite:///./bugmind.db"
    REDIS_URL: str = "redis://localhost:6379/0"
    OPENROUTER_API_KEY: Optional[str] = None
    OPENROUTER_MODEL: str = "google/gemini-2.0-flash-001"
    STRIPE_SECRET_KEY: Optional[str] = None
    STRIPE_WEBHOOK_SECRET: Optional[str] = None

    class Config:
        env_file = ".env"

settings = Settings()
