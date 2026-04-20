import logging
import time
import traceback
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response, JSONResponse, RedirectResponse
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from sqlalchemy import text, inspect
from sqlalchemy.exc import SQLAlchemyError
from app.core.config import settings
from app.core.api_errors import http_exception_handler, validation_exception_handler
from app.core.database import engine
from app.core.logging import configure_logging

configure_logging()
logger = logging.getLogger("bugmind.http")

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json"
)

app.add_exception_handler(HTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    tb = traceback.format_exc()
    logger.error("INTERNAL SERVER ERROR (UNCAUGHT EXCEPTION): %s\n%s", str(exc), tb)
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Internal Server Error",
            "error": {
                "code": "INTERNAL_SERVER_ERROR",
                "message": str(exc) if not settings.is_production else "An unexpected error occurred",
                "details": []
            }
        }
    )

# Standard CORS behavior for Chrome Extension
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list or ["*"],
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
    request_id = request.headers.get("X-Request-ID") or str(uuid4())
    
    # Strict Origin Validation in Production
    if settings.is_production and request.method != "GET":
        allowed_extension_prefix = "chrome-extension://"
        origin = request.headers.get("Origin") or request.headers.get("Referer")
        
        # If origin is provided, it must be from an extension
        if origin and not origin.startswith(allowed_extension_prefix):
             # Highly sensitive: we might want to log this attempt
             logger.warning("security_alert unauthorized_origin_attempt origin=%s request_id=%s", origin, request_id)
             return JSONResponse(
                 status_code=403, 
                 content={"detail": "Unauthorized request origin", "origin": origin, "method": request.method}
             )

    started_at = time.perf_counter()
    response: Response = await call_next(request)
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
    
    try:
        from app.core.database import engine
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        logger.info("DATABASE TABLES FOUND: %s", ", ".join(tables) if tables else "NONE")
        
        required_tables = ["users", "audit_logs", "jira_connections"]
        missing_tables = [t for t in required_tables if t not in tables]
        if missing_tables:
            logger.warning("CRITICAL: Missing core tables: %s. Did migrations run?", ", ".join(missing_tables))
    except Exception as e:
        logger.error("Startup database check failed: %s", str(e))

@app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
def root_redirect():
    return RedirectResponse(url="/docs")

@app.get("/health", tags=["System"])
@app.get("/health ", tags=["System"], include_in_schema=False)
def health_check():
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail="Database health check failed")

    return {"status": "ok", "version": settings.VERSION}

@app.get("/metrics", tags=["System"])
def metrics():
    return {"status": "ok", "message": "Metrics placeholder"}

from app.api.v1.api import api_router

app.include_router(api_router, prefix=settings.API_V1_STR)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
