from __future__ import annotations

import json
import logging
from typing import Any, Optional
from sqlalchemy.orm import Session

from app.models.audit import AuditLog


logger = logging.getLogger("bugmind.audit")


def _json_safe(value: Any) -> Any:
    try:
        json.dumps(value)
        return value
    except TypeError:
        if isinstance(value, dict):
            return {str(key): _json_safe(inner) for key, inner in value.items()}
        if isinstance(value, (list, tuple, set)):
            return [_json_safe(item) for item in value]
        return str(value)


def log_audit(action: str, user_id: Optional[int], db: Optional[Session] = None, **metadata: Any) -> None:
    # Try to extract context if called within a request
    client_ip = "unknown"
    request_id = "unknown"
    
    try:
        from fastapi import Request
        from starlette.requests import Request as StarletteRequest
        import inspect
        
        # Look for request in caller frames
        for frame_info in inspect.stack():
            for arg_name, arg_val in frame_info.frame.f_locals.items():
                if isinstance(arg_val, (Request, StarletteRequest)):
                    client_ip = getattr(arg_val.client, "host", "unknown")
                    request_id = arg_val.headers.get("X-Request-ID", "unknown")
                    break
            if client_ip != "unknown":
                break
    except Exception:
        pass

    payload = {
        "action": action,
        "user_id": user_id,
        "client_ip": client_ip,
        "request_id": request_id,
        **metadata,
    }
    safe_metadata = {key: _json_safe(value) for key, value in metadata.items()}
    if db is not None:
        db.add(AuditLog(user_id=user_id, action=action, event_metadata=safe_metadata))
        db.commit()
    logger.info(json.dumps(payload, default=str, sort_keys=True))
