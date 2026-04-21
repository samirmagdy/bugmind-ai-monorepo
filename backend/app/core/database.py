import logging
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

from app.core.config import settings

logger = logging.getLogger("bugmind.http")

def get_database_engine(dsn: str):
    """Create appropriate engine based on database type."""
    if dsn.startswith("sqlite"):
        # SQLite doesn't support connect_timeout or connection pooling
        return create_engine(dsn)
    return create_engine(
        dsn,
        pool_pre_ping=True,
        connect_args={"connect_timeout": 10},
        pool_size=5,
        max_overflow=10,
    )

engine = get_database_engine(settings.DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
logger.info(
    "Database engine configured for %s",
    "sqlite" if settings.DATABASE_URL.startswith("sqlite") else "postgresql",
)

Base = declarative_base()

def get_db() -> Generator:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
