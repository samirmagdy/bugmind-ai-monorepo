from typing import Optional
from urllib.parse import urlparse

from cryptography.fernet import InvalidToken
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core import security
from app.core.request_security import enforce_secure_jira_ssl, validate_connection_host
from app.models.jira import JiraAuthType, JiraConnection
from app.services.jira.adapters.cloud import JiraCloudAdapter
from app.services.jira.adapters.server import JiraServerAdapter


def normalize_instance_url(url: Optional[str]) -> str:
    trimmed = (url or "").strip().lower().rstrip("/")
    if not trimmed:
        return ""

    if not (trimmed.startswith("http://") or trimmed.startswith("https://")):
        trimmed = f"https://{trimmed}"

    try:
        parsed = urlparse(trimmed)
        scheme = parsed.scheme or "https"
        netloc = parsed.netloc
        path = parsed.path.rstrip("/")
        for marker in ("/browse/", "/issues/", "/projects/", "/rest/"):
            if marker in path:
                path = path.split(marker, 1)[0]
                break
        return f"{scheme}://{netloc}{path}".rstrip("/")
    except Exception:
        return trimmed


def get_adapter(connection: JiraConnection):
    enforce_secure_jira_ssl(connection.verify_ssl)
    safe_host_url = validate_connection_host(connection.host_url, connection.auth_type.value)
    try:
        token = security.decrypt_credential(connection.encrypted_token)
    except InvalidToken:
        raise HTTPException(
            status_code=401,
            detail="Jira Connection Stale: Encryption keys have changed. Please delete and re-add this connection.",
        )
    if connection.auth_type == JiraAuthType.CLOUD:
        return JiraCloudAdapter(safe_host_url, connection.username, token, verify_ssl=connection.verify_ssl)
    return JiraServerAdapter(safe_host_url, connection.username, token, verify_ssl=connection.verify_ssl)


def verify_connection_credentials(
    auth_type: JiraAuthType,
    host_url: str,
    username: str,
    token: str,
    verify_ssl: bool,
) -> None:
    adapter = (
        JiraCloudAdapter(host_url, username, token, verify_ssl=verify_ssl)
        if auth_type == JiraAuthType.CLOUD
        else JiraServerAdapter(host_url, username, token, verify_ssl=verify_ssl)
    )
    adapter.get_current_user()


def get_owned_connection(db: Session, user_id: int, connection_id: int) -> JiraConnection:
    conn = db.query(JiraConnection).filter(
        JiraConnection.id == connection_id,
        JiraConnection.user_id == user_id,
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Jira connection not found")
    return conn


def assert_connection_matches_instance(connection: JiraConnection, instance_url: Optional[str]) -> None:
    if not instance_url:
        return

    requested = normalize_instance_url(instance_url)
    connection_url = normalize_instance_url(connection.host_url)
    if requested and connection_url and requested != connection_url:
        raise HTTPException(
            status_code=400,
            detail=f"Security Alert: Your active Jira connection ({connection_url}) does not match the page you are currently viewing ({requested}). Please verify your connection settings.",
        )
