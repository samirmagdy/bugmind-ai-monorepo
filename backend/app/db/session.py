from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
import os
from dotenv import load_dotenv

load_dotenv()

# Auto-detect Docker environment
db_host = os.getenv("POSTGRES_HOST", "localhost")
if os.path.exists("/.dockerenv"):
    db_host = "postgres"

DATABASE_URL = os.getenv("DATABASE_URL", f"postgresql://postgres:postgres@{db_host}:5432/bugmind")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
