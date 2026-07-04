# ruff: noqa: E402
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

DB_FILE = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
DB_FILE.close()

os.environ.setdefault("DATABASE_URL", f"sqlite:///{DB_FILE.name}")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-google-auth")
os.environ.setdefault("ENCRYPTION_KEY", Fernet.generate_key().decode())
os.environ.setdefault("GOOGLE_OAUTH_CLIENT_ID", "google-client-id.apps.googleusercontent.com")
os.environ.setdefault("RATE_LIMITS_ENABLED", "false")

from app.core.config import settings  # noqa: E402
from app.main import app as fastapi_app  # noqa: E402
from app.services.auth.google import verify_google_id_token  # noqa: E402


def test_google_config_reports_disabled_when_client_id_missing():
    client = TestClient(fastapi_app)
    with patch.object(settings, "GOOGLE_OAUTH_CLIENT_ID", None):
        response = client.get("/api/v1/auth/google/config")
    client.close()

    assert response.status_code == 200
    assert response.json() == {"client_id": None, "enabled": False}


class FakeGoogleResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def test_verify_google_id_token_accepts_valid_verified_google_token():
    with patch(
        "app.services.auth.google.httpx.get",
        return_value=FakeGoogleResponse(
            200,
            {
                "aud": "google-client-id.apps.googleusercontent.com",
                "iss": "https://accounts.google.com",
                "email": "User@Example.COM ",
                "sub": "google-subject-123",
                "email_verified": "true",
                "name": "Google User",
            },
        ),
    ):
        profile = verify_google_id_token("id-token")

    assert profile == {
        "email": "user@example.com",
        "google_subject": "google-subject-123",
        "name": "Google User",
        "email_verified": True,
    }


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        (
            {
                "aud": "wrong-client.apps.googleusercontent.com",
                "iss": "https://accounts.google.com",
                "email": "user@example.com",
                "sub": "google-subject-123",
                "email_verified": "true",
            },
            "Google token audience mismatch",
        ),
        (
            {
                "aud": "google-client-id.apps.googleusercontent.com",
                "iss": "https://evil.example.com",
                "email": "user@example.com",
                "sub": "google-subject-123",
                "email_verified": "true",
            },
            "Google token issuer mismatch",
        ),
        (
            {
                "aud": "google-client-id.apps.googleusercontent.com",
                "iss": "https://accounts.google.com",
                "email": "user@example.com",
                "sub": "google-subject-123",
                "email_verified": "false",
            },
            "Google account email is not verified",
        ),
    ],
)
def test_verify_google_id_token_rejects_invalid_token_claims(payload, message):
    with patch("app.services.auth.google.httpx.get", return_value=FakeGoogleResponse(200, payload)):
        with pytest.raises(HTTPException) as exc:
            verify_google_id_token("id-token")

    assert exc.value.status_code == 400
    assert exc.value.detail == message


def test_verify_google_id_token_rejects_google_tokeninfo_failure():
    with patch("app.services.auth.google.httpx.get", return_value=FakeGoogleResponse(400, {"error": "invalid_token"})):
        with pytest.raises(HTTPException) as exc:
            verify_google_id_token("bad-id-token")

    assert exc.value.status_code == 400
    assert exc.value.detail == "Invalid Google identity token"


def test_verify_google_id_token_requires_google_client_id():
    with patch.object(settings, "GOOGLE_OAUTH_CLIENT_ID", None):
        with pytest.raises(HTTPException) as exc:
            verify_google_id_token("id-token")

    assert exc.value.status_code == 503
    assert exc.value.detail == "Google sign-in is not configured"


def teardown_module():
    try:
        os.unlink(DB_FILE.name)
    except OSError:
        pass
