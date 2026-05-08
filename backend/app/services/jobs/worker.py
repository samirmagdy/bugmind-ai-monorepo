import asyncio
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy.orm import Session
from app.models.job import Job
from app.core.database import SessionLocal

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def process_job(job_id: str, processor_func, *args, _session_factory=None, **kwargs):
    """
    Background job runner that owns its own database session.

    Each background task gets a fresh session independent of the request-scoped
    session. This prevents 'Session already closed' errors on long-running bulk
    jobs (Epic test generation, BRD comparison, etc.) that outlive the HTTP request.

    processor_func must be an async callable with signature:
        processor_func(job_id: str, db: Session, *args, **kwargs)

    _session_factory: optional callable returning a Session (default: SessionLocal).
        Override in tests to inject a controlled in-memory session.
    """
    factory = _session_factory or SessionLocal
    db: Session = factory()
    try:
        job = db.query(Job).filter(Job.id == job_id).first()
        if not job:
            logger.error("Job %s not found in worker.", job_id)
            return

        job.status = "running"
        job.updated_at = _utcnow()
        db.commit()

        await processor_func(job_id, db, *args, **kwargs)

    except Exception as e:
        logger.exception("Job %s failed.", job_id)
        try:
            db.rollback()
            job = db.query(Job).filter(Job.id == job_id).first()
            if job and job.status != "cancelled":
                job.status = "failed"
                job.error_message = str(e)
                job.completed_at = _utcnow()
                db.commit()
        except Exception:
            logger.exception("Failed to persist error state for job %s.", job_id)
    finally:
        db.close()



def create_job(
    db: Session,
    user_id: int,
    job_type: str,
    target_key: str,
    project_key: str,
    workspace_id: Optional[int] = None,
    request_payload: Optional[dict] = None,
    retry_of_job_id: Optional[str] = None,
    resume_of_job_id: Optional[str] = None,
    retry_count: int = 0,
) -> Job:
    job = Job(
        id=str(uuid.uuid4()),
        user_id=user_id,
        workspace_id=workspace_id,
        job_type=job_type,
        target_key=target_key,
        project_key=project_key,
        status="queued",
        request_payload=request_payload,
        retry_of_job_id=retry_of_job_id,
        resume_of_job_id=resume_of_job_id,
        retry_count=retry_count,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def update_job_progress(
    db: Session,
    job_id: str,
    progress: float,
    current_step: Optional[str] = None,
    payload: Optional[dict] = None,
) -> None:
    job = db.query(Job).filter(Job.id == job_id).first()
    if job:
        job.progress_percentage = progress
        if current_step:
            job.current_step = current_step
        if payload is not None:
            job.result_payload = payload

        job.status = "partial_result_ready" if progress < 100.0 else "completed"
        if progress >= 100.0:
            job.completed_at = _utcnow()
        job.updated_at = _utcnow()
        db.commit()


def check_cancelled(db: Session, job_id: str) -> bool:
    job = db.query(Job).filter(Job.id == job_id).first()
    return bool(job and job.is_cancelled)
