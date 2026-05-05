import asyncio
import uuid
import logging
from datetime import datetime
from typing import Optional
from sqlalchemy.orm import Session
from app.models.job import Job

logger = logging.getLogger(__name__)

async def process_job(db: Session, job_id: str, processor_func, *args, **kwargs):
    """
    Minimal internal job runner loop.
    processor_func must be an async function taking (job_id, db, *args, **kwargs).
    """
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        logger.error(f"Job {job_id} not found in worker.")
        return

    try:
        job.status = "running"
        job.updated_at = datetime.utcnow()
        db.commit()

        await processor_func(job_id, db, *args, **kwargs)

    except Exception as e:
        logger.exception(f"Job {job_id} failed.")
        db.refresh(job)
        if job.status != "cancelled":
            job.status = "failed"
            job.error_message = str(e)
            job.completed_at = datetime.utcnow()
            db.commit()

def create_job(
    db: Session,
    user_id: int,
    job_type: str,
    target_key: str,
    project_key: str,
    workspace_id: Optional[int] = None,
) -> Job:
    job = Job(
        id=str(uuid.uuid4()),
        user_id=user_id,
        workspace_id=workspace_id,
        job_type=job_type,
        target_key=target_key,
        project_key=project_key,
        status="queued"
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job

def update_job_progress(db: Session, job_id: str, progress: float, current_step: str = None, payload: dict = None):
    job = db.query(Job).filter(Job.id == job_id).first()
    if job:
        job.progress_percentage = progress
        if current_step:
            job.current_step = current_step
        if payload is not None:
            job.result_payload = payload
        
        job.status = "partial_result_ready" if progress < 100.0 else "completed"
        if progress >= 100.0:
            job.completed_at = datetime.utcnow()
        job.updated_at = datetime.utcnow()
        db.commit()

def check_cancelled(db: Session, job_id: str) -> bool:
    job = db.query(Job).filter(Job.id == job_id).first()
    return job and job.is_cancelled
