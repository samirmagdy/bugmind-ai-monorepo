#!/usr/bin/env bash
set -euo pipefail

# DATABASE_URL is MANDATORY for all environments. Fail fast if it is missing.
if [ -z "${DATABASE_URL:-}" ]; then
    echo "ERROR: DATABASE_URL is not set. The application cannot start without a valid database connection."
    echo "Current ENVIRONMENT: ${ENVIRONMENT:-development}"
    exit 1
fi

if [ -z "${ENVIRONMENT:-}" ] && [ -n "${RENDER:-}" ]; then
    export ENVIRONMENT=production
fi

echo "Running database migrations..."
python -m alembic upgrade head

exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-10000}"
