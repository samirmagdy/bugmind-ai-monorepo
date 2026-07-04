#!/usr/bin/env bash
set -euo pipefail

describe_database_url() {
    python - <<'PY'
import os
from urllib.parse import urlparse

url = os.environ.get("DATABASE_URL", "")
parsed = urlparse(url)
host = parsed.hostname or "unknown"
database = (parsed.path or "/").lstrip("/") or "unknown"
if (parsed.scheme or "").startswith("sqlite"):
    print(f"{parsed.scheme}:{parsed.path}")
else:
    print(f"{parsed.scheme or 'unknown'}://{host}/{database}")
PY
}

database_host_resolves() {
    python - <<'PY'
import os
import socket
import sys
from urllib.parse import urlparse

host = urlparse(os.environ.get("DATABASE_URL", "")).hostname
scheme = urlparse(os.environ.get("DATABASE_URL", "")).scheme
if scheme.startswith("sqlite"):
    sys.exit(0)

if not host:
    sys.exit(1)

try:
    socket.getaddrinfo(host, 5432)
except OSError as exc:
    print(f"Database host DNS lookup failed for {host}: {exc}")
    sys.exit(1)
PY
}

# DATABASE_URL is MANDATORY for all environments. Fail fast if it is missing.
if [ -z "${DATABASE_URL:-}" ]; then
    echo "ERROR: DATABASE_URL is not set. The application cannot start without a valid database connection."
    echo "Current ENVIRONMENT: ${ENVIRONMENT:-development}"
    exit 1
fi

if [ -z "${ENVIRONMENT:-}" ] && [ -n "${RENDER:-}" ]; then
    export ENVIRONMENT=production
fi

echo "Database target: $(describe_database_url)"

if ! database_host_resolves; then
    if [ -n "${DATABASE_EXTERNAL_URL:-}" ]; then
        echo "Render private database hostname is not resolvable here. Falling back to DATABASE_EXTERNAL_URL."
        export DATABASE_URL="${DATABASE_EXTERNAL_URL}"
        echo "Database target after fallback: $(describe_database_url)"
        database_host_resolves
    else
        echo "ERROR: Render private database hostname is not resolvable from this service."
        echo "If the database and service are already in the same Render region/workspace, set DATABASE_EXTERNAL_URL to the database External Database URL from Render."
        exit 1
    fi
fi

echo "Running database migrations..."
python -m alembic upgrade head

exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-10000}"
