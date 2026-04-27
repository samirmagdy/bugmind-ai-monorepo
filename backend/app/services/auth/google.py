from __future__ import annotations

from typing import Any

import httpx
from fastapi import HTTPException

from app.core.config import settings


def verify_google_id_token(id_token: str) -> dict[str, Any]:
    if not settings.GOOGLE_OAUTH_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")

    try:
        response = httpx.get(
            "https://oauth2.googleapis.com/tokeninfo",
            params={"id_token": id_token},
            timeout=10.0,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Failed to verify Google identity token: {exc}") from exc

    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Invalid Google identity token")

    payload = response.json()
    audience = payload.get("aud")
    issuer = payload.get("iss")
    email = str(payload.get("email") or "").strip().lower()
    subject = str(payload.get("sub") or "").strip()
    email_verified = str(payload.get("email_verified") or "").lower() == "true"

    if audience != settings.GOOGLE_OAUTH_CLIENT_ID:
        raise HTTPException(status_code=400, detail="Google token audience mismatch")
    if issuer not in {"accounts.google.com", "https://accounts.google.com"}:
        raise HTTPException(status_code=400, detail="Google token issuer mismatch")
    if not subject or not email or not email_verified:
        raise HTTPException(status_code=400, detail="Google account email is not verified")

    return {
        "email": email,
        "google_subject": subject,
        "name": str(payload.get("name") or "").strip() or None,
        "email_verified": email_verified,
    }
