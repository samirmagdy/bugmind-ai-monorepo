#!/usr/bin/env bash
set -euo pipefail

# Ensure environment from parent .env file is loaded
if [ -f "$(dirname "$0")/..\.env" ]; then
    export $(cat "$(dirname "$0")/..\.env" | grep -v '^#' | xargs)
fi

# On Render, the DATABASE_URL is provided by the Blueprint
# No manual override to SQLite is needed anymore.

# If DATABASE_URL not set, use sqlite fallback for local development
if [ -z "${DATABASE_URL:-}" ]; then
    export DATABASE_URL="sqlite:///./bugmind.db"
    echo "WARNING: DATABASE_URL not set, using SQLite fallback"
fi

exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-10000}"
