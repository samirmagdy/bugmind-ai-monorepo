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

derive_external_database_url() {
    python - <<'PY'
import os
import sys
from urllib.parse import urlparse, urlunparse

url = os.environ.get("DATABASE_URL", "")
suffix = os.environ.get("DATABASE_EXTERNAL_HOST_SUFFIX", "oregon-postgres.render.com").strip()
parsed = urlparse(url)
host = parsed.hostname

if not host or not suffix or not parsed.scheme.startswith(("postgres", "postgresql")):
    sys.exit(1)

if "." in host:
    sys.exit(1)

external_host = f"{host}.{suffix}"
if parsed.port:
    netloc = parsed.netloc.replace(host, external_host, 1)
else:
    netloc = parsed.netloc.replace(host, external_host, 1)

print(urlunparse(parsed._replace(netloc=netloc)))
PY
}

ensure_postgres_sslmode() {
    python - <<'PY'
import os
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

url = os.environ.get("DATABASE_URL", "")
parsed = urlparse(url)

if not parsed.scheme.startswith(("postgres", "postgresql")):
    print(url)
    raise SystemExit(0)

params = dict(parse_qsl(parsed.query, keep_blank_values=True))
params.setdefault("sslmode", "require")
print(urlunparse(parsed._replace(query=urlencode(params))))
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

export DATABASE_URL="$(ensure_postgres_sslmode)"
echo "Database target: $(describe_database_url)"

if ! database_host_resolves; then
    if [ -n "${DATABASE_EXTERNAL_URL:-}" ]; then
        echo "Render private database hostname is not resolvable here. Falling back to DATABASE_EXTERNAL_URL."
        export DATABASE_URL="${DATABASE_EXTERNAL_URL}"
        export DATABASE_URL="$(ensure_postgres_sslmode)"
        echo "Database target after fallback: $(describe_database_url)"
        database_host_resolves
    elif [ "${ALLOW_DERIVED_DATABASE_EXTERNAL_URL:-false}" = "true" ] && derived_database_url="$(derive_external_database_url)"; then
        echo "Render private database hostname is not resolvable here. Deriving external Render Postgres URL."
        export DATABASE_URL="${derived_database_url}"
        export DATABASE_URL="$(ensure_postgres_sslmode)"
        echo "Database target after derived fallback: $(describe_database_url)"
        database_host_resolves
    else
        echo "ERROR: Render private database hostname is not resolvable from this service."
        echo "Set DATABASE_EXTERNAL_URL to the database External Database URL from Render."
        exit 1
    fi
fi

echo "Running database migrations..."
python -m alembic upgrade head

exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-10000}"
