from typing import Generator
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.declarative import declarative_base
from app.core.config import settings
from pathlib import Path

def _normalize_database_url(database_url: str) -> str:
    if database_url.startswith("sqlite:///./"):
        backend_root = Path(__file__).resolve().parents[2]
        sqlite_path = backend_root / database_url.removeprefix("sqlite:///./")
        return f"sqlite:///{sqlite_path}"
    return database_url

engine = create_engine(_normalize_database_url(settings.DATABASE_URL), pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db() -> Generator:
    try:
        db = SessionLocal()
        yield db
    finally:
        db.close()
