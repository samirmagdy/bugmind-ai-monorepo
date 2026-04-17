from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from .api import auth, bugs, jira, stripe, settings
from .db.session import engine, Base
from .services.jira import JiraConnectionError
from .services.ai_engine import AIConnectionError
from .core.limiter import limiter
from .core.config import settings
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler
import os
import time
import logging
from starlette.middleware.base import BaseHTTPMiddleware
from sqlalchemy import text

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("bugmind")

# Create DB tables (In production, use Alembic - removal of auto-creation here)
# Base.metadata.create_all(bind=engine)

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Intelligent Bug Generator from Jira User Stories",
    version=settings.VERSION
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

class InteractionLogger(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start_time = time.time()
        path = request.url.path
        if request.query_params:
            path += f"?{request.query_params}"
        
        logger.info(f"[REQUEST]  {request.method} {path}")
        
        try:
            response = await call_next(request)
            process_time = time.time() - start_time
            logger.info(f"[RESPONSE] {request.method} {request.url.path} -> {response.status_code} ({process_time:.3f}s)")
            return response
        except Exception as e:
            process_time = time.time() - start_time
            logger.error(f"[CRASH]    {request.method} {request.url.path} -> {str(e)} ({process_time:.3f}s)")
            raise e


@app.exception_handler(JiraConnectionError)
async def jira_connection_exception_handler(request: Request, exc: JiraConnectionError):
    return JSONResponse(
        status_code=503,
        content={"detail": str(exc)},
    )

@app.exception_handler(AIConnectionError)
async def ai_connection_exception_handler(request: Request, exc: AIConnectionError):
    return JSONResponse(
        status_code=503,
        content={"detail": str(exc)},
    )

# CORS configuration
ALLOWED_ORIGINS = settings.ALLOWED_ORIGINS
if not ALLOWED_ORIGINS or ALLOWED_ORIGINS == ["*"]:
    if settings.ENV == "production":
        logger.error("DANGER: No ALLOWED_ORIGINS set in production!")
    ALLOWED_ORIGINS = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True, # Required for some extension setups
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

app.add_middleware(SecurityHeadersMiddleware)

# Include Routers
app.include_router(auth.router)
app.include_router(bugs.router)
app.include_router(jira.router)
app.include_router(stripe.router)
app.include_router(settings.router)

@app.get("/")
def read_root():
    return {"message": f"Welcome to {settings.PROJECT_NAME} API", "status": "running"}

@app.get("/health")
async def health_check():
    health_status = {"status": "ok", "timestamp": time.time(), "services": {}}
    
    # Check Database
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        health_status["services"]["database"] = "ok"
    except Exception as e:
        logger.error(f"Health Check - DB Failure: {str(e)}")
        health_status["services"]["database"] = "error"
        health_status["status"] = "degraded"

    return health_status

# Register logger as the outermost middleware (last added)
app.add_middleware(InteractionLogger)
