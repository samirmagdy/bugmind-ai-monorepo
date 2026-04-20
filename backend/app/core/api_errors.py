from __future__ import annotations

from typing import Any

from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


DEFAULT_ERROR_CODES = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    402: "PAYMENT_REQUIRED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    422: "VALIDATION_ERROR",
    429: "RATE_LIMITED",
    500: "INTERNAL_SERVER_ERROR",
}


def _normalize_error_parts(detail: Any, status_code: int) -> tuple[str, list[Any], str]:
    if isinstance(detail, dict):
        error = detail.get("error")
        if isinstance(error, dict):
            message = str(error.get("message") or detail.get("detail") or "Request failed")
            details = error.get("details")
            if not isinstance(details, list):
                details = [details] if details is not None else []
            code = str(error.get("code") or DEFAULT_ERROR_CODES.get(status_code, "REQUEST_FAILED"))
            return message, details, code

        message = str(detail.get("message") or detail.get("detail") or "Request failed")
        return message, [detail], DEFAULT_ERROR_CODES.get(status_code, "REQUEST_FAILED")

    if isinstance(detail, list):
        message = "Validation failed" if status_code == 422 else "Request failed"
        return message, detail, DEFAULT_ERROR_CODES.get(status_code, "REQUEST_FAILED")

    if isinstance(detail, str):
        return detail, [], DEFAULT_ERROR_CODES.get(status_code, "REQUEST_FAILED")

    return "Request failed", [], DEFAULT_ERROR_CODES.get(status_code, "REQUEST_FAILED")


def build_error_body(status_code: int, detail: Any) -> dict[str, Any]:
    message, details, code = _normalize_error_parts(detail, status_code)
    return {
        "detail": message,
        "error": {
            "code": code,
            "message": message,
            "details": details,
        },
    }


async def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content=build_error_body(exc.status_code, exc.detail))


async def validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content=build_error_body(422, exc.errors()))
