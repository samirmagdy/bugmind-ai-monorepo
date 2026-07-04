import os
from pathlib import Path
import sys

import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_main_security.db")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-main-security")
os.environ.setdefault("ENCRYPTION_KEY", Fernet.generate_key().decode())
os.environ.setdefault("RATE_LIMITS_ENABLED", "false")

from app.core.middleware import MAX_REQUEST_BODY_SIZE, _internal_error_detail, _validate_content_length  # noqa: E402
from app.main import app as fastapi_app  # noqa: E402


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


def test_production_rejects_unsafe_request_from_unallowlisted_origin(monkeypatch):
    from app.core import middleware

    monkeypatch.setattr(middleware.settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(middleware.settings, "EXTENSION_ORIGINS", "chrome-extension://allowed-extension")
    monkeypatch.setattr(middleware.settings, "CORS_ORIGINS", "https://app.example.com")

    client = TestClient(fastapi_app)
    response = client.post(
        "/api/v1/auth/login",
        headers={"Origin": "chrome-extension://untrusted-extension"},
        data={"username": "user@example.com", "password": "Password123!"},
    )
    client.close()

    assert response.status_code == 403
    assert "EXTENSION_ORIGIN_NOT_ALLOWED" in response.text


def test_production_allows_unsafe_request_from_configured_extension_origin(monkeypatch):
    from app.core import middleware

    monkeypatch.setattr(middleware.settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(middleware.settings, "EXTENSION_ORIGINS", "chrome-extension://allowed-extension")
    monkeypatch.setattr(middleware.settings, "CORS_ORIGINS", "")

    client = TestClient(fastapi_app)
    response = client.post(
        "/api/v1/auth/login",
        headers={"Origin": "chrome-extension://allowed-extension"},
        data={"username": "missing@example.com", "password": "Password123!"},
    )
    client.close()

    assert response.status_code != 403
    assert "EXTENSION_ORIGIN_NOT_ALLOWED" not in response.text
