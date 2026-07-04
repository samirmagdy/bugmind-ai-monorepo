from __future__ import annotations

import logging
import httpx
import smtplib
from collections import deque
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Query, status, Body
from sqlalchemy import func
from sqlalchemy.orm import Session
from redis.exceptions import RedisError

from app.api import deps
from app.core.config import settings
from app.models.job import Job
from app.services.jobs.queue import _redis_client, QUEUE_KEY, PROCESSING_KEY

logger = logging.getLogger(__name__)

router = APIRouter()


async def verify_monitoring_token(
    x_monitoring_token: Optional[str] = Header(None, alias="X-Monitoring-Token"),
    token: Optional[str] = Query(None),
) -> None:
    if settings.MONITORING_SECRET_TOKEN:
        provided = x_monitoring_token or token
        if not provided or provided != settings.MONITORING_SECRET_TOKEN:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or missing monitoring token",
            )


def send_alert(subject: str, message_text: str) -> None:
    # 1. Webhook alert
    if settings.ALERT_WEBHOOK_URL:
        try:
            payload = {"text": f"*{subject}*\n{message_text}"}
            response = httpx.post(settings.ALERT_WEBHOOK_URL, json=payload, timeout=5)
            response.raise_for_status()
            logger.info("Sent alert webhook: %s", subject)
        except Exception as e:
            logger.error("Failed to send webhook alert: %s", str(e))

    # 2. Email alert
    if settings.SMTP_HOST and settings.SMTP_FROM_EMAIL and settings.ALERT_EMAIL_RECIPIENTS:
        try:
            recipients = [r.strip() for r in settings.ALERT_EMAIL_RECIPIENTS.split(",") if r.strip()]
            if recipients:
                msg = EmailMessage()
                msg["Subject"] = subject
                msg["From"] = settings.SMTP_FROM_EMAIL
                msg["To"] = ", ".join(recipients)
                msg.set_content(message_text)

                with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as smtp:
                    if settings.SMTP_USE_TLS:
                        smtp.starttls()
                    if settings.SMTP_USERNAME and settings.SMTP_PASSWORD:
                        smtp.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
                    smtp.send_message(msg)
                logger.info("Sent alert email: %s", subject)
        except Exception as e:
            logger.error("Failed to send email alert: %s", str(e))


@router.post("/render-deploy-webhook", status_code=status.HTTP_200_OK)
async def render_deploy_webhook(
    payload: Dict[str, Any] = Body(...),
    _ = Depends(verify_monitoring_token),
) -> Dict[str, str]:
    """
    Receives deploy webhooks from Render. Sends alerts on deploy failures.
    """
    event_type = payload.get("event") or ""
    data = payload.get("data", {})
    service = data.get("service", {})
    service_name = service.get("name", "Unknown Service")
    status_str = data.get("status") or ""

    if event_type == "deploy.failed" or status_str == "failed":
        commit = data.get("commit", {})
        commit_msg = commit.get("message", "No commit message")
        commit_sha = commit.get("id", "No SHA")

        subject = f"🚨 Render Deploy Failure: {service_name}"
        message = (
            f"A deployment has failed on Render.\n\n"
            f"Service: {service_name}\n"
            f"Event: {event_type}\n"
            f"Status: {status_str}\n"
            f"Commit Message: {commit_msg}\n"
            f"Commit SHA: {commit_sha}\n"
            f"Deploy ID: {data.get('id')}\n"
        )
        logger.error("render_deploy_failed service=%s sha=%s msg=%s", service_name, commit_sha, commit_msg)
        send_alert(subject, message)
        return {"status": "alert_sent"}

    return {"status": "ignored"}


@router.get("/queue")
def get_queue_depth(
    _ = Depends(verify_monitoring_token)
) -> Dict[str, Any]:
    """
    Returns Redis queue depth statistics.
    """
    try:
        client = _redis_client()
        queued_count = client.llen(QUEUE_KEY)
        processing_count = client.llen(PROCESSING_KEY)
        return {
            "status": "ok",
            "redis_connected": True,
            "queued_jobs": queued_count,
            "processing_jobs": processing_count,
        }
    except RedisError as e:
        logger.error("Redis connection failed for queue check: %s", str(e))
        return {
            "status": "degraded",
            "redis_connected": False,
            "queued_jobs": 0,
            "processing_jobs": 0,
            "error": str(e),
        }


@router.get("/worker")
def get_worker_status(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(deps.get_db),
    _ = Depends(verify_monitoring_token),
) -> Dict[str, Any]:
    """
    Retrieves worker job failure and retry statistics from the database.
    """
    status_counts_raw = db.query(Job.status, func.count(Job.id)).group_by(Job.status).all()
    status_counts = {status_str: count for status_str, count in status_counts_raw}

    all_statuses = ["queued", "running", "completed", "failed", "partial_result_ready", "cancelled"]
    for s in all_statuses:
        status_counts.setdefault(s, 0)

    total_jobs = db.query(Job).count()
    failed_jobs = status_counts.get("failed", 0)
    success_rate = 100.0 * (1 - (failed_jobs / total_jobs)) if total_jobs > 0 else 100.0

    retried_jobs_count = db.query(Job).filter(Job.retry_count > 0).count()

    latest_failures = (
        db.query(Job)
        .filter((Job.status == "failed") | (Job.retry_count > 0))
        .order_by(Job.updated_at.desc())
        .limit(limit)
        .all()
    )

    failures_list = []
    for job in latest_failures:
        failures_list.append({
            "id": job.id,
            "job_type": job.job_type,
            "status": job.status,
            "retry_count": job.retry_count,
            "retry_of_job_id": job.retry_of_job_id,
            "error_message": job.error_message,
            "created_at": job.created_at.isoformat() if job.created_at else None,
            "updated_at": job.updated_at.isoformat() if job.updated_at else None,
            "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        })

    return {
        "status_counts": status_counts,
        "total_jobs": total_jobs,
        "retried_jobs_count": retried_jobs_count,
        "success_rate_percentage": round(success_rate, 2),
        "latest_failures_and_retries": failures_list,
    }


@router.get("/errors")
def get_error_logs(
    limit: int = Query(100, ge=1, le=500),
    _ = Depends(verify_monitoring_token),
) -> Dict[str, Any]:
    """
    Reads the last N lines of the rotating error log file.
    """
    log_dir = Path(__file__).resolve().parents[3] / "logs"
    log_file = log_dir / "errors.log"

    if not log_file.exists():
        return {
            "log_file_found": False,
            "lines": [],
        }

    try:
        with open(log_file, "r") as f:
            lines = list(deque(f, limit))
        lines = [line.rstrip() for line in lines]
        return {
            "log_file_found": True,
            "lines": lines,
        }
    except Exception as e:
        logger.error("Failed to read error logs: %s", str(e))
        return {
            "log_file_found": True,
            "error": str(e),
            "lines": [],
        }
