# BugMind AI — Deployment Guide

## Options

**Option 1: Render Blueprint** — See [`render.yaml`](../../render.yaml) at the repo root. In Render, choose New → Blueprint, select this repo, and fill in the prompted env vars (see below).

**Option 2: Docker Compose** — `cp .env.example .env && docker-compose up --build`

**Option 3: Local** — `cd backend && pip install -r requirements.txt && alembic upgrade head && uvicorn app.main:app --reload`

---

## Required Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL or SQLite connection string |
| `SECRET_KEY` | JWT signing key — use `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | AES key for credential encryption — generate with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `ENVIRONMENT` | `production` or `development` |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `ALLOWED_HOSTS` | Comma-separated allowed hostnames |

## Optional Variables

| Variable | Default | Notes |
|---|---|---|
| `OPENROUTER_MODEL` | `openai/gpt-4o` | Override AI model |
| `REDIS_URL` | None | Required for rate limiting |
| `RATE_LIMITS_ENABLED` | `false` | Set `true` when Redis is available |
| `STRIPE_SECRET_KEY` | None | Required for billing |
| `STRIPE_WEBHOOK_SECRET` | None | Required for Stripe webhooks |
| `LOG_LEVEL` | `INFO` | Logging verbosity |

---

## CI/CD

GitHub Actions CI runs on every push and PR. Render deploy is triggered via deploy hook on `main`. See [ROADMAP.md](../product/ROADMAP.md) for planned improvements.

---

> **Warning**: Back up your `ENCRYPTION_KEY`. Losing it makes all stored Jira/Xray credentials unrecoverable.
