import logging
import time
import traceback
from typing import Optional
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import HTTPException, Request, Response
from fastapi.responses import JSONResponse

from app.core.api_errors import build_error_response
from app.core.config import settings
from app.core.context import set_trace_id, get_trace_id

logger = logging.getLogger("bugmind.http")

MAX_REQUEST_BODY_SIZE = 5 * 1024 * 1024


def _normalize_request_origin(raw_origin: str) -> str:
    if not raw_origin:
        return ""
    parsed = urlparse(raw_origin)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
    return raw_origin.rstrip("/")


def _validate_content_length(content_length: Optional[str]) -> None:
    if not content_length:
        return
    try:
        request_size = int(content_length)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid Content-Length header")
    if request_size < 0:
        raise HTTPException(status_code=400, detail="Invalid Content-Length header")
    if request_size > MAX_REQUEST_BODY_SIZE:
        raise HTTPException(status_code=413, detail="Request payload too large (max 5MB)")


def _internal_error_detail(exc: Exception) -> dict[str, str]:
    return {
        "code": "INTERNAL_ERROR",
        "message": "An unexpected error occurred" if settings.is_production else str(exc),
        "user_action": "An internal error occurred. Please contact support and provide the trace ID.",
    }


async def limit_request_size_middleware(request: Request, call_next):
    _validate_content_length(request.headers.get("Content-Length"))
    return await call_next(request)


async def security_headers_middleware(request: Request, call_next):
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
        error_body = build_error_response(500, _internal_error_detail(e))
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
