#!/usr/bin/env bash
set -euo pipefail

# Ensure environment from parent .env file is loaded
if [ -f "$(dirname "$0")/..\.env" ]; then
    export $(cat "$(dirname "$0")/..\.env" | grep -v '^#' | xargs)
fi

# On Render, the DATABASE_URL is provided by the Blueprint
# No manual override to SQLite is needed anymore.

# DATABASE_URL is MANDATORY for all environments. Fail fast if it is missing.
if [ -z "${DATABASE_URL:-}" ]; then
    echo "ERROR: DATABASE_URL is not set. The application cannot start without a valid database connection."
    echo "Current ENVIRONMENT: ${ENVIRONMENT:-development}"
    exit 1
fi

exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-10000}"
