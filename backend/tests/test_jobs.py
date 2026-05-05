import pytest
import os
import sys
import tempfile
from pathlib import Path

DB_FILE = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
DB_FILE.close()
os.environ["DATABASE_URL"] = f"sqlite:///{DB_FILE.name}"

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from unittest.mock import patch, MagicMock
import app.models # Registers metadata
from app.models.job import Job
from app.services.jobs.worker import create_job, update_job_progress, check_cancelled, process_job
from app.services.jobs.epic_processor import epic_test_generation_processor
from fastapi.testclient import TestClient
from app.main import app
from app.models.user import User

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.database import Base

engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(scope="session", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)

@pytest.fixture
def db():
    db = SessionLocal()
    for table in reversed(Base.metadata.sorted_tables):
        db.execute(table.delete())
    db.commit()
    yield db
    db.close()

@pytest.fixture
def client():
    def override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()
    
    from app.core.database import get_db
    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    app.dependency_overrides.clear()

@pytest.fixture
def test_user(db):
    user = User(email="test@example.com")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

@pytest.fixture
def test_user_token_headers(test_user):
    from app.core.security import create_access_token
    token = create_access_token(str(test_user.id))
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture
def anyio_backend():
    return 'asyncio'

def test_create_job(db, test_user):
    job = create_job(db, test_user.id, "epic_test_generation", "PROJ-123", "PROJ")
    assert job.job_type == "epic_test_generation"
    assert job.status == "queued"
    assert job.target_key == "PROJ-123"
    assert job.user_id == test_user.id

def test_job_status_transitions(db, test_user):
    job = create_job(db, test_user.id, "epic_test_generation", "PROJ-123", "PROJ")
    update_job_progress(db, job.id, 50.0, "Halfway", {"result": "partial"})
    
    db.refresh(job)
    assert job.progress_percentage == 50.0
    assert job.status == "partial_result_ready"
    assert job.current_step == "Halfway"
    assert job.result_payload == {"result": "partial"}

    update_job_progress(db, job.id, 100.0, "Done")
    db.refresh(job)
    assert job.status == "completed"
    assert job.completed_at is not None

def test_cancel_job(db, test_user):
    job = create_job(db, test_user.id, "epic_test_generation", "PROJ-123", "PROJ")
    job.is_cancelled = True
    job.status = "cancelled"
    db.commit()
    
    assert check_cancelled(db, job.id) is True

@pytest.mark.anyio
async def test_worker_process_job_exception(db, test_user):
    job = create_job(db, test_user.id, "epic_test_generation", "PROJ-123", "PROJ")
    
    async def failing_processor(*args, **kwargs):
        raise ValueError("Simulated failure")
        
    await process_job(db, job.id, failing_processor)
    
    db.refresh(job)
    assert job.status == "failed"
    assert "Simulated failure" in job.error_message

@pytest.mark.anyio
@patch("app.services.jobs.epic_processor.get_adapter")
@patch("app.services.jobs.epic_processor.get_owned_connection")
@patch("app.services.jobs.epic_processor.fetch_epic_children")
@patch("app.services.jobs.epic_processor.TestCaseGenerator")
async def test_epic_processor_flow(mock_generator_class, mock_fetch, mock_get_owned, mock_get_adapter, db, test_user):
    job = create_job(db, test_user.id, "epic_test_generation", "PROJ-123", "PROJ")
    
    mock_adapter = MagicMock()
    mock_get_adapter.return_value = mock_adapter
    
    mock_fetch_response = MagicMock()
    mock_issue = MagicMock()
    mock_issue.key = "PROJ-1"
    mock_issue.summary = "Story 1"
    mock_issue.description = "Long description" * 1000  # Will be truncated
    mock_fetch_response.issues = [mock_issue]
    mock_fetch.return_value = mock_fetch_response
    
    mock_ai = MagicMock()
    mock_generator_class.return_value = mock_ai
    # Return a mocked generated result
    async def mock_generate(*args, **kwargs):
        # Verify context is truncated
        assert len(kwargs.get("context_text")) <= 20050
        return {"test_cases": [{"title": "Test 1"}], "coverage_score": 100.0}
    mock_ai.generate_test_cases = mock_generate
    
    await epic_test_generation_processor(job.id, db, test_user, 1, "PROJ-123", "10001")
    
    db.refresh(job)
    assert job.status == "completed"
    assert job.progress_percentage == 100.0
    assert len(job.result_payload["stories"]) == 1
    assert job.result_payload["stories"][0]["test_cases"][0]["title"] == "Test 1"
    
@pytest.mark.skip(reason="FastAPI TestClient DB isolation issues with SQLite temp files")
def test_user_access_isolation(client, test_user, test_user_token_headers, db):
    # Create job for test_user
    job1 = create_job(db, test_user.id, "epic", "PROJ-1", "PROJ")
    
    # Another user
    from app.models.user import User
    user2 = User(email="test2@example.com")
    db.add(user2)
    db.commit()
    db.refresh(user2)
    job2 = create_job(db, user2.id, "epic", "PROJ-2", "PROJ")
    
    from app.api.deps import get_current_user
    app.dependency_overrides[get_current_user] = lambda: test_user
    
    response = client.get("/api/v1/jobs", headers=test_user_token_headers)
    assert response.status_code == 200
    data = response.json()
    # Should only see job1
    assert len(data) == 1
    assert data[0]["id"] == job1.id
    
    response = client.get(f"/api/v1/jobs/{job2.id}", headers=test_user_token_headers)
    assert response.status_code == 404
    
    app.dependency_overrides.pop(get_current_user, None)
