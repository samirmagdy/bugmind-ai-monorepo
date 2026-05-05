from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.context import get_trace_id
from app.schemas.error import APIErrorResponse

ERROR_MAPPINGS = {
    "JIRA_AUTH_FAILED": {
        "user_action": "Check your Jira API token and username in Settings.",
        "status_code": 401
    },
    "JIRA_CONNECTION_FAILED": {
        "user_action": "Verify the Jira Base URL and check your network/VPN connection.",
        "status_code": 502
    },
    "JIRA_PERMISSION_DENIED": {
        "user_action": "Ensure your Jira account has 'Browse Projects' and 'Create Issues' permissions.",
        "status_code": 403
    },
    "XRAY_NOT_SUPPORTED": {
        "user_action": "Xray Cloud is not supported yet, or the project does not have Xray enabled.",
        "status_code": 400
    },
    "AI_PROVIDER_TIMEOUT": {
        "user_action": "The AI provider is taking too long. Please try again in a few seconds.",
        "status_code": 504
    },
    "AI_PROVIDER_FAILED": {
        "user_action": "The AI service is currently unavailable. Check your AI configuration or try later.",
        "status_code": 502
    },
    "RATE_LIMIT_EXCEEDED": {
        "user_action": "You are sending too many requests. Please wait a moment before trying again.",
        "status_code": 429
    },
    "PLAN_LIMIT_EXCEEDED": {
        "user_action": "You have reached your current plan's usage limit. Consider upgrading.",
        "status_code": 403
    },
    "EXTENSION_ORIGIN_NOT_ALLOWED": {
        "user_action": "This extension build is not authorized. Add its origin to the server whitelist.",
        "status_code": 403
    },
    "VALIDATION_FAILED": {
        "user_action": "Check the input data for errors and try again.",
        "status_code": 422
    },
    "INTERNAL_ERROR": {
        "user_action": "An unexpected server error occurred. Please contact support with the trace ID.",
        "status_code": 500
    },
}

DEFAULT_ERROR_CODES = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    402: "PAYMENT_REQUIRED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    413: "REQUEST_TOO_LARGE",
    422: "VALIDATION_FAILED",
    429: "RATE_LIMIT_EXCEEDED",
    500: "INTERNAL_ERROR",
    502: "AI_PROVIDER_FAILED",
    504: "AI_PROVIDER_TIMEOUT",
}

def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _json_safe(inner) for key, inner in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)

def build_error_response(status_code: int, detail: Any) -> APIErrorResponse:
    trace_id = get_trace_id() or "unknown"
    
    code = DEFAULT_ERROR_CODES.get(status_code, "INTERNAL_ERROR")
    message = "An unexpected error occurred"
    user_action = "Please try again later or contact support."
    details = {}

    if isinstance(detail, str):
        message = detail
    elif isinstance(detail, dict):
        message = detail.get("message") or detail.get("detail") or message
        code = detail.get("code") or code
        user_action = detail.get("user_action") or user_action
        details = detail.get("details") or {}
    elif isinstance(detail, list):
        message = "Validation failed"
        code = "VALIDATION_FAILED"
        details = {"errors": _json_safe(detail)}

    # Apply mapping if code matches
    if code in ERROR_MAPPINGS:
        mapping = ERROR_MAPPINGS[code]
        user_action = mapping.get("user_action", user_action)

    return APIErrorResponse(
        code=code,
        message=message,
        user_action=user_action,
        trace_id=trace_id,
        details=_json_safe(details) if isinstance(details, dict) else {"raw": _json_safe(details)},
        detail=message
    )

async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    error_body = build_error_response(exc.status_code, exc.detail)
    return JSONResponse(
        status_code=exc.status_code,
        content=error_body.model_dump(),
        headers={"X-Request-ID": error_body.trace_id}
    )

async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    error_body = build_error_response(422, exc.errors())
    return JSONResponse(
        status_code=422,
        content=error_body.model_dump(),
        headers={"X-Request-ID": error_body.trace_id}
    )

