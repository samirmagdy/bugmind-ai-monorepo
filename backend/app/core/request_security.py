from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

from fastapi import HTTPException

from app.core.config import settings


def get_client_ip(request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def normalize_external_base_url(raw_url: str) -> str:
    trimmed = (raw_url or "").strip()
    try:
        parsed = urlparse(trimmed)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid Jira URL: {exc}") from exc

    if parsed.scheme not in {"http", "https"}:
        raise HTTPException(status_code=400, detail="Jira URL must use http or https")
    if not parsed.netloc:
        raise HTTPException(status_code=400, detail="Jira URL must include a hostname")
    if parsed.username or parsed.password:
        raise HTTPException(status_code=400, detail="Jira URL must not include embedded credentials")
    if parsed.query or parsed.fragment:
        raise HTTPException(status_code=400, detail="Jira URL must not include query strings or fragments")

    path = parsed.path.rstrip("/")
    scheme = parsed.scheme
    hostname = (parsed.hostname or "").strip().lower()
    
    # Force HTTPS for Jira Cloud domains
    if hostname.endswith(".atlassian.net"):
        scheme = "https"
        
    return f"{scheme}://{parsed.netloc}{path}"


def _validate_ip(ip: str) -> None:
    parsed = ipaddress.ip_address(ip)
    if (
        parsed.is_private
        or parsed.is_loopback
        or parsed.is_link_local
        or parsed.is_multicast
        or parsed.is_reserved
        or parsed.is_unspecified
    ):
        raise HTTPException(status_code=400, detail="Jira URL must resolve to a public internet host")


def validate_jira_url(raw_url: str, allow_private_host: bool = False) -> str:
    normalized = normalize_external_base_url(raw_url)
    parsed = urlparse(normalized)
    hostname = (parsed.hostname or "").strip().lower()
    if not hostname:
        raise HTTPException(status_code=400, detail="Jira URL must include a valid hostname")
    if hostname in {"localhost", "0.0.0.0"} or hostname.endswith(".local"):
        raise HTTPException(status_code=400, detail="Local Jira hosts are not allowed")

    if not allow_private_host:
        try:
            _validate_ip(hostname)
        except ValueError:
            pass
        except HTTPException:
            raise

    try:
        resolved = socket.getaddrinfo(hostname, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)
    except socket.gaierror:
        return normalized

    seen_ips: set[str] = set()
    for result in resolved:
        ip = result[4][0]
        if ip in seen_ips:
            continue
        seen_ips.add(ip)
        if not allow_private_host:
            _validate_ip(ip)

    return normalized


def validate_connection_host(raw_url: str, auth_type: str) -> str:
    allow_private = auth_type == "server" and settings.allow_private_jira_hosts_effective
    return validate_jira_url(raw_url, allow_private_host=allow_private)


def enforce_secure_jira_ssl(verify_ssl: bool) -> None:
    if settings.is_production:
        if verify_ssl is False:
            if not settings.ALLOW_INSECURE_JIRA_SSL:
                raise HTTPException(
                    status_code=400, 
                    detail="Disabling Jira SSL verification is not allowed in production for security reasons."
                )
            # Log a security warning that we are bypassing SSL verification
            from app.core.audit import log_audit
            import logging
            logger = logging.getLogger("bugmind.security")
            logger.warning("security_risk insecure_jira_ssl_bypass_detected verify_ssl=False")
            # We don't have a user context here easily without passing it, but standard logs are enough
