import os
from pathlib import Path
import sys

import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_main_security.db")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-main-security")
os.environ.setdefault("ENCRYPTION_KEY", Fernet.generate_key().decode())
os.environ.setdefault("RATE_LIMITS_ENABLED", "false")

from app.core.middleware import MAX_REQUEST_BODY_SIZE, _internal_error_detail, _validate_content_length  # noqa: E402


def test_invalid_content_length_rejected():
    with pytest.raises(HTTPException) as exc_info:
        _validate_content_length("not-a-number")

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Invalid Content-Length header"


def test_negative_content_length_rejected():
    with pytest.raises(HTTPException) as exc_info:
        _validate_content_length("-1")

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Invalid Content-Length header"


def test_large_content_length_rejected():
    with pytest.raises(HTTPException) as exc_info:
        _validate_content_length(str(MAX_REQUEST_BODY_SIZE + 1))

    assert exc_info.value.status_code == 413


def test_internal_error_detail_masks_production_message(monkeypatch):
    from app.core import middleware

    monkeypatch.setattr(middleware.settings, "ENVIRONMENT", "production")

    detail = _internal_error_detail(RuntimeError("database password leaked in stack"))

    assert detail["message"] == "An unexpected error occurred"
    assert "database password" not in detail["message"]


def test_internal_error_detail_keeps_development_message(monkeypatch):
    from app.core import middleware

    monkeypatch.setattr(middleware.settings, "ENVIRONMENT", "development")

    detail = _internal_error_detail(RuntimeError("useful local debug message"))

    assert detail["message"] == "useful local debug message"
