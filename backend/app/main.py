import logging
import traceback
import time
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, Response
from sqlalchemy import text, inspect
from sqlalchemy.exc import SQLAlchemyError

from app.core.api_errors import http_exception_handler, validation_exception_handler, build_error_response
from app.core.config import settings
from app.core.database import engine
from app.core.logging import configure_logging
from app.core.context import set_trace_id, get_trace_id

configure_logging()
logger = logging.getLogger("bugmind.http")


REQUIRED_TABLES = ["users", "audit_logs", "jira_connections"]
REQUIRED_COLUMNS = {
    "users": {"google_subject", "email_verified_at"},
    "password_reset_codes": {"email", "code_hash", "expires_at", "used_at"},
}


def _normalize_request_origin(raw_origin: str) -> str:
    if not raw_origin:
        return ""
    parsed = urlparse(raw_origin)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
    return raw_origin.rstrip("/")

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json" if settings.docs_enabled else None,
    docs_url="/docs" if settings.docs_enabled else None,
    redoc_url="/redoc" if settings.docs_enabled else None,
)

app.add_exception_handler(HTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    tb = traceback.format_exc()
    trace_id = get_trace_id() or str(uuid4())
    logger.error("INTERNAL SERVER ERROR (UNCAUGHT EXCEPTION): %s\n%s [trace_id=%s]", str(exc), tb, trace_id)
    
    error_body = build_error_response(500, {
        "code": "INTERNAL_ERROR",
        "message": str(exc) if not settings.is_production else "An unexpected error occurred",
        "user_action": "An internal error occurred. Please contact support and provide the trace ID."
    })
    
    return JSONResponse(
        status_code=500,
        content=error_body.model_dump(),
        headers={"X-Request-ID": trace_id}
    )

# Standard CORS behavior for Chrome Extension
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list or (["*"] if not settings.is_production else []),
    allow_credentials=bool(settings.cors_origins_list) or not settings.is_production,
    allow_methods=["*"],
    allow_headers=["*"],
)
if settings.allowed_hosts_list:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts_list)


@app.middleware("http")
async def limit_request_size(request: Request, call_next):
    # Limit body size to 5MB (5 * 1024 * 1024 bytes)
    MAX_SIZE = 5 * 1024 * 1024
    
    content_length = request.headers.get("Content-Length")
    if content_length and int(content_length) > MAX_SIZE:
        raise HTTPException(status_code=413, detail="Request payload too large (max 5MB)")
    
    return await call_next(request)

@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or request.headers.get("X-Correlation-ID") or str(uuid4())
    set_trace_id(request_id)
    
    # Strict Origin Validation in Production
    if settings.is_production and request.method != "GET":
        origin = _normalize_request_origin(request.headers.get("Origin") or request.headers.get("Referer") or "")
        
        if origin:
            allowed_origins = set(settings.extension_origins_list + settings.cors_origins_list)
            if origin not in allowed_origins:
                logger.warning("security_alert unauthorized_origin_attempt origin=%s request_id=%s", origin, request_id)
                error_body = build_error_response(403, {
                    "code": "EXTENSION_ORIGIN_NOT_ALLOWED",
                    "message": f"Unauthorized request origin: {origin}",
                    "user_action": "Add the current chrome-extension origin to the EXTENSION_ORIGINS server configuration."
                })
                return JSONResponse(
                    status_code=403,
                    content=error_body.model_dump(),
                    headers={"X-Request-ID": request_id}
                )

    started_at = time.perf_counter()
    try:
        response: Response = await call_next(request)
    except Exception as e:
        # Fallback for errors in middleware or before exception handlers
        logger.exception("Exception in middleware chain: %s", str(e))
        error_body = build_error_response(500, str(e))
        return JSONResponse(
            status_code=500,
            content=error_body.model_dump(),
            headers={"X-Request-ID": request_id}
        )

    duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
    logger.info(
        "request_complete request_id=%s method=%s path=%s status=%s duration_ms=%s client_ip=%s",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
        request.client.host if request.client else "unknown",
    )
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    if settings.is_production:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response

@app.on_event("startup")
async def startup_event():
    logger.info("ENVIRONMENT: %s", settings.ENVIRONMENT)
    logger.info("DATABASE_URL: %s", settings.DATABASE_URL.split("@")[-1] if "@" in settings.DATABASE_URL else "masked")
    # 1. Verify Security Keys
    _placeholders = [
        "32-byte-base64-encryption-key-for-jira-tokens",
        "CHANGE_THIS_IN_PRODUCTION_MUST_BE_32_BYTES_!",
        "CHANGE_THIS_IN_PRODUCTION_b8m9k2n3m4n5b6g7v8a9c0d1e2f3a4b"
    ]
    if not settings.SECRET_KEY or settings.SECRET_KEY in _placeholders:
        logger.error("CRITICAL: SECRET_KEY is missing or using a default value. Deployment aborted for safety.")
        import sys
        sys.exit(1)
        
    if not settings.ENCRYPTION_KEY or settings.ENCRYPTION_KEY in _placeholders:
        logger.error("CRITICAL: ENCRYPTION_KEY is missing or using a default value. Cannot protect Jira credentials.")
        import sys
        sys.exit(1)

    # 2. Perform mandatory connection check
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        logger.info("DATABASE TABLES FOUND: %s", ", ".join(tables) if tables else "NONE")
        
        missing_tables = [t for t in REQUIRED_TABLES if t not in tables]
        if missing_tables:
            logger.error("CRITICAL: Missing core tables: %s. Migrations did not run successfully.", ", ".join(missing_tables))
            import sys
            sys.exit(1)

        for table_name, required_columns in REQUIRED_COLUMNS.items():
            if table_name not in tables:
                logger.error("CRITICAL: Missing required table: %s. Latest migrations are not applied.", table_name)
                import sys
                sys.exit(1)
            existing_columns = {column["name"] for column in inspector.get_columns(table_name)}
            missing_columns = sorted(required_columns - existing_columns)
            if missing_columns:
                logger.error(
                    "CRITICAL: Missing required columns on %s: %s. Latest migrations are not applied.",
                    table_name,
                    ", ".join(missing_columns),
                )
                import sys
                sys.exit(1)
    except Exception as e:
        logger.error("CRITICAL DATABASE CONNECTION FAILURE: %s", str(e))
        logger.error("The application cannot start without a valid database connection.")
        import sys
        sys.exit(1)

@app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
def root_redirect():
    return RedirectResponse(url="/docs" if settings.docs_enabled else "/health")

@app.get("/health", tags=["System"])
def health_check():
    return {
        "status": "ok", 
        "version": settings.VERSION, 
        "environment": settings.ENVIRONMENT,
        "trace_id": get_trace_id()
    }

@app.get("/health/db", tags=["System"])
def health_db():
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return {"status": "ok", "service": "database", "trace_id": get_trace_id()}
    except Exception as e:
        logger.error("DB Health Check Failed: %s", str(e))
        raise HTTPException(status_code=503, detail="Database connection failed")

@app.get("/health/ai", tags=["System"])
async def health_ai():
    if not settings.OPENROUTER_API_KEY:
        return {"status": "degraded", "service": "ai", "message": "API key missing", "trace_id": get_trace_id()}
    
    # We don't want to call the AI for every health check, but we can verify settings
    return {
        "status": "ok", 
        "service": "ai", 
        "provider": "openrouter", 
        "model": settings.OPENROUTER_MODEL,
        "trace_id": get_trace_id()
    }

@app.get("/health/jira", tags=["System"])
def health_jira():
    # Jira health is usually per-user connection, so we just report if the service logic is ready
    return {"status": "ok", "service": "jira_integration", "trace_id": get_trace_id()}

@app.get("/metrics", tags=["System"])
def metrics():
    return {"status": "ok", "message": "Metrics placeholder"}

from app.api.v1.api import api_router

app.include_router(api_router, prefix=settings.API_V1_STR)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
