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

def get_database_engine(dsn: str):
    """Create appropriate engine based on database type."""
    if dsn.startswith("sqlite"):
        # SQLite doesn't support connect_timeout or connection pooling
        return create_engine(dsn)
    else:
        # PostgreSQL supports these parameters
        return create_engine(
            dsn,
            pool_pre_ping=True,
            connect_args={"connect_timeout": 10},
            pool_size=5,
            max_overflow=10
        )

try:
    engine = get_database_engine(settings.DATABASE_URL)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    logger.info(f"Database connected: {settings.DATABASE_URL.split('@')[0] if '@' in settings.DATABASE_URL else 'unknown'}")
except Exception as e:
    logger.warning(f"Database connection failed: {e}")
    logger.warning("App will run in standalone mode (database unavailable)")
    # If we can't connect to database, SQLite fallback should be used
    # but if we got here, DATABASE_URL might be set to PostgreSQL
    # Check if it's SQLite and create a backup
    if not settings.DATABASE_URL.startswith("sqlite"):
        logger.info("Attempting SQLite fallback...")
        sqlite_url = "sqlite:///./bugmind.db"
        try:
            engine = create_engine(sqlite_url)
            SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
            logger.info("Successfully fell back to SQLite database")
        except Exception as sqlite_error:
            logger.error(f"SQLite fallback also failed: {sqlite_error}")
    else:
        logger.info("Using SQLite database")

Base = declarative_base()

def get_db() -> Generator:
    try:
        if SessionLocal:
            db = SessionLocal()
            yield db
        else:
            logger.warning("No database connection available")
            yield None
    finally:
        if 'db' in locals() and db:
            db.close()
