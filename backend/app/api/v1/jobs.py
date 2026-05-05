from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List

from app.api import deps
from app.models.user import User
from app.models.job import Job
from app.schemas.job import JobResponse, EpicJobCreateRequest
from app.services.jobs.worker import create_job, process_job
from app.services.jobs.epic_processor import epic_audit_processor, brd_coverage_processor, epic_test_generation_processor

router = APIRouter(prefix="/jobs", tags=["Jobs"])

@router.post("/epic-test-generation", response_model=JobResponse)
def create_epic_test_generation_job(
    request: EpicJobCreateRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    job = create_job(
        db=db,
        user_id=current_user.id,
        job_type="epic_test_generation",
        target_key=request.epic_key,
        project_key=request.project_key or request.epic_key.split("-", 1)[0],
        workspace_id=current_user.default_workspace_id,
    )
    
    background_tasks.add_task(
        process_job,
        db,
        job.id,
        epic_test_generation_processor,
        current_user,
        request.jira_connection_id,
        request.epic_key,
        request.issue_type_id
    )
    return job

@router.post("/epic-audit", response_model=JobResponse)
def create_epic_audit_job(
    request: EpicJobCreateRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    job = create_job(
        db,
        current_user.id,
        "epic_audit",
        request.epic_key,
        request.project_key or request.epic_key.split("-", 1)[0],
        workspace_id=current_user.default_workspace_id,
    )
    background_tasks.add_task(
        process_job,
        db,
        job.id,
        epic_audit_processor,
        current_user,
        request.jira_connection_id,
        request.epic_key,
        request.issue_type_id,
        request.project_key or "",
        request.project_id,
        request.issue_type_name,
    )
    return job

@router.post("/brd-coverage-comparison", response_model=JobResponse)
def create_brd_coverage_job(
    request: EpicJobCreateRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    if not request.brd_text or not request.brd_text.strip():
        raise HTTPException(
            status_code=400,
            detail={
                "code": "BRD_TEXT_REQUIRED",
                "message": "BRD text is required to start an async coverage comparison.",
                "user_action": "Load a BRD attachment or paste BRD text before starting the job.",
            },
        )

    job = create_job(
        db,
        current_user.id,
        "brd_coverage",
        request.epic_key,
        request.project_key or request.epic_key.split("-", 1)[0],
        workspace_id=current_user.default_workspace_id,
    )
    background_tasks.add_task(
        process_job,
        db,
        job.id,
        brd_coverage_processor,
        current_user,
        request.jira_connection_id,
        request.epic_key,
        request.issue_type_id,
        request.brd_text,
        request.project_key or "",
        request.project_id,
        request.issue_type_name,
    )
    return job

@router.get("", response_model=List[JobResponse])
def get_jobs(db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user)):
    jobs = db.query(Job).filter(Job.user_id == current_user.id).order_by(Job.created_at.desc()).limit(50).all()
    return jobs

@router.get("/{job_id}", response_model=JobResponse)
def get_job(job_id: str, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user)):
    job = db.query(Job).filter(Job.id == job_id, Job.user_id == current_user.id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job

@router.post("/{job_id}/cancel", response_model=JobResponse)
def cancel_job(job_id: str, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user)):
    job = db.query(Job).filter(Job.id == job_id, Job.user_id == current_user.id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if job.status in ["completed", "failed", "cancelled"]:
        raise HTTPException(status_code=400, detail="Cannot cancel a job that is already finished.")
        
    job.is_cancelled = True
    job.status = "cancelled"
    db.commit()
    db.refresh(job)
    return job
