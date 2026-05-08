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


def _job_payload(request: EpicJobCreateRequest) -> dict:
    return request.model_dump(exclude_none=True)


def _get_owned_job(db: Session, current_user: User, job_id: str) -> Job:
    job = db.query(Job).filter(Job.id == job_id, Job.user_id == current_user.id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def _start_job_from_payload(background_tasks: BackgroundTasks, job: Job, current_user: User, payload: dict) -> None:
    connection_id = payload.get("jira_connection_id")
    epic_key = payload.get("epic_key")
    issue_type_id = payload.get("issue_type_id")
    if not connection_id or not epic_key or not issue_type_id:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "JOB_PAYLOAD_INCOMPLETE",
                "message": "This job cannot be restarted because its original request is incomplete.",
                "user_action": "Start the workflow again from the main screen.",
            },
        )

    if job.job_type == "epic_test_generation":
        background_tasks.add_task(process_job, job.id, epic_test_generation_processor, current_user, connection_id, epic_key, issue_type_id)
        return

    if job.job_type == "epic_audit":
        background_tasks.add_task(
            process_job,
            job.id,
            epic_audit_processor,
            current_user,
            connection_id,
            epic_key,
            issue_type_id,
            payload.get("project_key") or "",
            payload.get("project_id"),
            payload.get("issue_type_name"),
        )
        return

    if job.job_type == "brd_coverage":
        brd_text = payload.get("brd_text")
        if not brd_text or not str(brd_text).strip():
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "BRD_TEXT_REQUIRED",
                    "message": "This coverage job cannot be restarted because the BRD text is missing.",
                    "user_action": "Reload the BRD attachment or paste BRD text before starting a new job.",
                },
            )
        background_tasks.add_task(
            process_job,
            job.id,
            brd_coverage_processor,
            current_user,
            connection_id,
            epic_key,
            issue_type_id,
            brd_text,
            payload.get("project_key") or "",
            payload.get("project_id"),
            payload.get("issue_type_name"),
        )
        return

    raise HTTPException(status_code=400, detail="Unsupported job type")


def _clone_job_for_restart(
    db: Session,
    source_job: Job,
    *,
    retry_of_job_id: str | None = None,
    resume_of_job_id: str | None = None,
) -> Job:
    if not source_job.request_payload:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "JOB_PAYLOAD_MISSING",
                "message": "This job was created before retry data was stored.",
                "user_action": "Start the workflow again from the main screen.",
            },
        )

    return create_job(
        db=db,
        user_id=source_job.user_id,
        job_type=source_job.job_type,
        target_key=source_job.target_key,
        project_key=source_job.project_key,
        workspace_id=source_job.workspace_id,
        request_payload=source_job.request_payload,
        retry_of_job_id=retry_of_job_id,
        resume_of_job_id=resume_of_job_id,
        retry_count=(source_job.retry_count or 0) + 1,
    )

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
        request_payload=_job_payload(request),
    )
    
    background_tasks.add_task(
        process_job,
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
        request_payload=_job_payload(request),
    )
    background_tasks.add_task(
        process_job,
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
        request_payload=_job_payload(request),
    )
    background_tasks.add_task(
        process_job,
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


@router.post("/{job_id}/retry", response_model=JobResponse)
def retry_job(
    job_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    source_job = _get_owned_job(db, current_user, job_id)
    if source_job.status not in ["failed", "cancelled"]:
        raise HTTPException(status_code=400, detail="Only failed or cancelled jobs can be retried.")

    job = _clone_job_for_restart(db, source_job, retry_of_job_id=source_job.id)
    _start_job_from_payload(background_tasks, job, current_user, job.request_payload or {})
    return job


@router.post("/{job_id}/resume", response_model=JobResponse)
def resume_job(
    job_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    source_job = _get_owned_job(db, current_user, job_id)
    if source_job.status not in ["partial_result_ready", "failed", "cancelled"]:
        raise HTTPException(status_code=400, detail="Only interrupted jobs can be resumed.")

    job = _clone_job_for_restart(db, source_job, resume_of_job_id=source_job.id)
    payload = dict(job.request_payload or {})
    if source_job.result_payload:
        payload["resume_source_job_id"] = source_job.id
        payload["resume_source_payload"] = source_job.result_payload
        job.request_payload = payload
        db.add(job)
        db.commit()
        db.refresh(job)
    _start_job_from_payload(background_tasks, job, current_user, payload)
    return job

@router.get("/{job_id}", response_model=JobResponse)
def get_job(job_id: str, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user)):
    return _get_owned_job(db, current_user, job_id)

@router.post("/{job_id}/cancel", response_model=JobResponse)
def cancel_job(job_id: str, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user)):
    job = _get_owned_job(db, current_user, job_id)
    
    if job.status in ["completed", "failed", "cancelled"]:
        raise HTTPException(status_code=400, detail="Cannot cancel a job that is already finished.")
        
    job.is_cancelled = True
    job.status = "cancelled"
    db.commit()
    db.refresh(job)
    return job
