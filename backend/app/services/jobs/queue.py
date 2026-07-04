from __future__ import annotations

import asyncio
import json
import logging
import signal
from dataclasses import dataclass
from typing import Any, Callable, Optional

import redis
from redis.exceptions import RedisError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.models.job import Job
from app.models.user import User
from app.services.jobs.epic_processor import (
    brd_coverage_processor,
    epic_audit_processor,
    epic_test_generation_processor,
)
from app.services.jobs.worker import _utcnow

logger = logging.getLogger(__name__)

QUEUE_KEY = "bugmind:jobs:queued"
PROCESSING_KEY = "bugmind:jobs:processing"


@dataclass(frozen=True)
class JobDispatch:
    job_id: str
    job_type: str
    user_id: int
    payload: dict[str, Any]


PROCESSORS: dict[str, Callable[..., Any]] = {
    "epic_test_generation": epic_test_generation_processor,
    "epic_audit": epic_audit_processor,
    "brd_coverage": brd_coverage_processor,
}


def _redis_client() -> redis.Redis:
    return redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)


def enqueue_job(job: Job, payload: dict[str, Any]) -> bool:
    dispatch = JobDispatch(
        job_id=str(job.id),
        job_type=str(job.job_type),
        user_id=int(job.user_id),
        payload=payload,
    )
    try:
        _redis_client().rpush(QUEUE_KEY, json.dumps(dispatch.__dict__))
        return True
    except RedisError:
        logger.exception("job_queue_enqueue_failed job_id=%s", job.id)
        return False


def _processor_args(dispatch: JobDispatch) -> list[Any]:
    payload = dispatch.payload
    connection_id = payload.get("jira_connection_id")
    epic_key = payload.get("epic_key")
    issue_type_id = payload.get("issue_type_id")
    if not connection_id or not epic_key or not issue_type_id:
        raise ValueError("Queued job payload is incomplete")

    if dispatch.job_type == "epic_test_generation":
        return [connection_id, epic_key, issue_type_id]
    if dispatch.job_type == "epic_audit":
        return [
            connection_id,
            epic_key,
            issue_type_id,
            payload.get("project_key") or "",
            payload.get("project_id"),
            payload.get("issue_type_name"),
        ]
    if dispatch.job_type == "brd_coverage":
        brd_text = payload.get("brd_text")
        if not brd_text or not str(brd_text).strip():
            raise ValueError("Queued BRD coverage job is missing brd_text")
        return [
            connection_id,
            epic_key,
            issue_type_id,
            brd_text,
            payload.get("project_key") or "",
            payload.get("project_id"),
            payload.get("issue_type_name"),
        ]
    raise ValueError(f"Unsupported queued job type: {dispatch.job_type}")


async def run_dispatch(dispatch: JobDispatch, *, _session_factory: Callable[[], Session] = SessionLocal) -> None:
    processor = PROCESSORS.get(dispatch.job_type)
    if processor is None:
        raise ValueError(f"Unsupported queued job type: {dispatch.job_type}")

    db = _session_factory()
    try:
        job = db.query(Job).filter(Job.id == dispatch.job_id).first()
        if not job:
            logger.error("queued_job_not_found job_id=%s", dispatch.job_id)
            return
        if job.status == "cancelled":
            return

        user = db.query(User).filter(User.id == dispatch.user_id).first()
        if not user:
            raise ValueError(f"Queued job user not found: {dispatch.user_id}")

        job.status = "running"
        job.updated_at = _utcnow()
        db.commit()

        await processor(dispatch.job_id, db, user, *_processor_args(dispatch))
    except Exception as exc:
        logger.exception("queued_job_failed job_id=%s", dispatch.job_id)
        db.rollback()
        job = db.query(Job).filter(Job.id == dispatch.job_id).first()
        if job and job.status != "cancelled":
            job.status = "failed"
            job.error_message = str(exc)
            job.completed_at = _utcnow()
            db.commit()
    finally:
        db.close()


async def consume_forever(poll_timeout_seconds: int = 5) -> None:
    client = _redis_client()
    stopping = False

    def _stop(*_: Any) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    logger.info("job_queue_worker_started queue=%s", QUEUE_KEY)

    while not stopping:
        try:
            raw_payload: Optional[str] = client.blmove(
                QUEUE_KEY,
                PROCESSING_KEY,
                timeout=poll_timeout_seconds,
            )
        except TypeError:
            raw = client.brpoplpush(QUEUE_KEY, PROCESSING_KEY, timeout=poll_timeout_seconds)
            raw_payload = raw if raw else None
        except RedisError:
            logger.exception("job_queue_poll_failed")
            await asyncio.sleep(2)
            continue

        if not raw_payload:
            continue
        try:
            dispatch = JobDispatch(**json.loads(raw_payload))
            await run_dispatch(dispatch)
            client.lrem(PROCESSING_KEY, 1, raw_payload)
        except Exception:
            logger.exception("job_queue_payload_failed")
            await asyncio.sleep(1)


def run_worker() -> None:
    asyncio.run(consume_forever())
