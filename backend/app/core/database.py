from typing import Generator
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.declarative import declarative_base
from app.core.config import settings
from pathlib import Path
import os
import logging

logger = logging.getLogger("bugmind.http")

# Try to create engine, but don't fail if database is unavailable
engine = None
SessionLocal = None
try:
    engine = create_engine(
        settings.DATABASE_URL, 
        pool_pre_ping=True,
        connect_args={"connect_timeout": 10},
        pool_size=5,
        max_overflow=10
    )
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    logger.info(f"Database connected: {settings.DATABASE_URL.split('@')[0] if '@' in settings.DATABASE_URL else 'unknown'}")
except Exception as e:
    logger.warning(f"Database connection failed: {e}")
    logger.warning("App will run in standalone mode (database unavailable)")

Base = declarative_base()

def get_db() -> Generator:
    try:
        if SessionLocal:
            db = SessionLocal()
            yield db
        else:
            logger.warning("Database not available, skipping session")
            yield None
    finally:
        if 'db' in locals() and db:
            db.close()
