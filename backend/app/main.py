from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from .api import auth, bugs, jira, stripe, settings
from .db.session import engine, Base
from .services.jira import JiraConnectionError
from .services.ai_engine import AIConnectionError
from .core.limiter import limiter
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler
import os
import time
import logging
from starlette.middleware.base import BaseHTTPMiddleware

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("bugmind")

# Create DB tables (In production use Alembic)
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="BugMind AI API",
    description="Intelligent Bug Generator from Jira User Stories",
    version="1.0.0"
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
# Restricted to the specific extension ID from ENV or a whitelist
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "").split(",")
if not any(ALLOWED_ORIGINS):
    # Fallback to a warning-level permissive state for local dev ONLY
    if os.getenv("ENV") == "production":
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
    return {"message": "Welcome to BugMind AI API", "status": "running"}

# Register logger as the outermost middleware (last added)
app.add_middleware(InteractionLogger)
