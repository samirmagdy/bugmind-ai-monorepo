# BugMind AI — Backend Architecture

## Overview

The backend is a FastAPI application backed by PostgreSQL (via SQLAlchemy 2.x / Alembic), Redis (optional, for rate-limiting and caching), and OpenRouter as the AI provider.

```
backend/
  app/
    api/
      v1/           # Route handlers (auth, ai, jira, jobs, workspaces, settings, stripe)
      deps.py       # Shared FastAPI dependencies (get_db, get_current_user, etc.)
    core/
      config.py     # Settings via pydantic-settings
      database.py   # SQLAlchemy engine + SessionLocal
      security.py   # Password hashing, JWT signing, credential encryption
      audit.py      # Audit log helper
      rate_limit.py # Redis-backed rate limiting (graceful degradation without Redis)
      rbac.py       # Role-based access control helpers
      request_security.py  # Origin validation, ALLOWED_HOSTS, security headers
    models/         # SQLAlchemy ORM models
    schemas/        # Pydantic request/response schemas
    crud/           # CRUD helpers per entity
    services/
      ai/           # OpenRouter client, bug generator, test case generator, workflows
      auth/         # Auth helpers
      jira/         # Jira Cloud/Server adapter, bulk epic service, connection service
      jobs/         # Background job worker + epic processor
      subscription/ # Stripe subscription helpers
```

---

## Request Lifecycle

```
HTTP Request
  → CORS / ALLOWED_HOSTS middleware
  → Rate limiting (Redis, optional)
  → Route handler (FastAPI)
    → Dependency injection (db session, current user, workspace guard)
    → Business logic / service call
    → Pydantic response model
  → HTTP Response
```

---

## Database Session Strategy

- **Request path**: Each request gets a SQLAlchemy `Session` via `Depends(get_db)`, which is yielded from `SessionLocal()` and closed in a `finally` block.
- **Background jobs**: `process_job` creates its **own** `SessionLocal()` session independent of the request context. This prevents `DetachedInstanceError` and "Session already closed" failures on long-running bulk jobs.

```python
async def process_job(job_id: str, processor_func, *args, **kwargs):
    db: Session = SessionLocal()
    try:
        ...
        await processor_func(job_id, db, *args, **kwargs)
    except Exception as e:
        db.rollback()
        # persist failure state
    finally:
        db.close()
```

> **Note**: For production-scale bulk jobs, the recommended next step is to move to a persistent queue (Redis/RQ, Arq, Celery). FastAPI `BackgroundTasks` are in-process and do not survive server restarts.

---

## AI Integration

- **Provider**: OpenRouter (`httpx` async client)
- **Retry logic**: Exponential backoff with fallback model
- **Error handling**: Quota errors, rate-limit (429), timeout (408) all handled gracefully
- **PII redaction**: Applied to all prompt inputs before sending to AI
- **Output validation**: Structured JSON output validated with Pydantic schemas

---

## Security Model

| Control | Implementation |
|---|---|
| Auth | JWT (HS256), rotating refresh tokens |
| Password | bcrypt via `passlib` |
| Credential storage | AES-GCM encrypted via `cryptography` library |
| CORS | Configurable `CORS_ORIGINS`; strict in production |
| ALLOWED_HOSTS | Validated in middleware |
| Rate limiting | Redis-backed; degrades gracefully without Redis |
| PII redaction | Pre-prompt sanitization on all AI calls |

---

## Deployment

See [../operations/DEPLOYMENT.md](../operations/DEPLOYMENT.md).

---

## Health Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health` | App liveness |
| `GET /health/db` | Database connectivity |
| `GET /health/ai` | AI (OpenRouter) configuration |
