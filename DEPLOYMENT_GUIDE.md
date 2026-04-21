# Deployment Guide for BugMind AI

## Problem Analysis

The deployment was failing because:
1. **DATABASE_URL not properly synced** - The `render.yaml` had `sync: false` for DATABASE_URL
2. **Environment variable loading order** - Backend wasn't inheriting from parent `.env` file
3. **Missing environment variables** - Required secrets weren't configured in Render

## What Was Fixed

### 1. Updated `start_render.sh`
```bash
# Now loads parent .env file first
# Sets fallback SQLite for local development
# Exits with clear error if DATABASE_URL missing in production
```

### 2. Updated `config.py` 
```python
# DATABASE_URL now defaults to empty string
# Validates that production has valid DATABASE_URL
# Loads from parent directory .env file (3 levels up)
```

### 3. Updated `render.yaml`
```yaml
# Changed sync: false → sync: true for:
# - DATABASE_URL
# - SECRET_KEY  
# - ENCRYPTION_KEY
# - OPENROUTER_API_KEY
# - OPENROUTER_MODEL
# - CORS_ORIGINS
# - ALLOWED_HOSTS
# - STRIPE_SECRET_KEY
# - STRIPE_WEBHOOK_SECRET
```

## Deployment Instructions

### Step 1: Configure Environment Variables in Render Dashboard

1. Go to https://dashboard.render.com/
2. Navigate to your service → **Environment** tab
3. The `DATABASE_URL` is automatically provided by the linked **bugmind-db** resource.
4. Verify/Add these other variables:

| Variable | Value | Notes |
|----------|-------|-------|
| `SECRET_KEY` | 64+ character random string | `openssl rand -hex 64` |
| `ENCRYPTION_KEY` | 32 byte base64 string | `openssl rand -base64 32` |
| `OPENROUTER_API_KEY` | Your OpenRouter API key | Required for AI features |
| `CORS_ORIGINS` | `https://your-extension-url.com` | Comma-separated list |
| `ALLOWED_HOSTS` | `bugmind-ai-monorepo.onrender.com` | Your render domain |
| `STRIPE_SECRET_KEY` | `sk_live_...` | For production payments |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | From Stripe dashboard |

### Step 2: Commit and Push Changes

The system now uses Render managed Postgres via Blueprint logic.

```bash
git add .
git commit -m "Migrate to Render managed Postgres"
git push origin main
```

### Step 3: Trigger New Deploy

Render should auto-deploy after detected changes in `render.yaml`. Alternatively:
1. Go to Render dashboard
2. Click **Manual Deploy** → **Deploy latest commit**

### Step 4: Verify Deployment

Check logs for successful startup:
```bash
# In Render dashboard → Logs
# Should see:
# INFO:     Started server process
# INFO:     Application startup complete.
# INFO:     Uvicorn running on http://0.0.0.0:10000
```

## Local Development

For local development, ensure `.env` file exists in root:
```env
DATABASE_URL=sqlite:///./bugmind.db
ENVIRONMENT=development
SECRET_KEY=your-secret-key
ENCRYPTION_KEY=your-encryption-key
OPENROUTER_API_KEY=your-key
```

## Common Issues and Solutions

### "DATABASE_URL must be set in production"
- **Fix**: Ensure the `bugmind-backend` service is correctly linked to the `bugmind-db` database in the Render dashboard. This should happen automatically via the `render.yaml` Blueprint.

### "psycopg.OperationalError connection to server failed"
- **Fix**: Verify that the managed database "bugmind-db" is active and healthy in your Render dashboard.

## Summary of Changes Made

Files modified:
1. `render.yaml` - Added managed PostgreSQL resource and linked it to the backend.
2. `backend/alembic/versions/*.py` - Hardened migrations to support non-Supabase Postgres.
3. `validate_env.py` - Added support for identifying Render databases.
4. `README.md` & `DEPLOYMENT_GUIDE.md` - Updated documentation.

Next deployment will use a fully integrated Render Postgres database.
