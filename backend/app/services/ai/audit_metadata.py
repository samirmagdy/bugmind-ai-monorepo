from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel

from app.core.config import settings
from app.services.ai.base_generator import BaseAIGenerator


PROMPT_TEMPLATE_ID = "bugmind.findings.v1"
PROMPT_TEMPLATE_VERSION = "1.0.0"
REDACTION_RULES_VERSION = "2026-05-08"
AI_PROVIDER_NAME = "openrouter"


def _to_plain(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, dict):
        return {str(key): _to_plain(inner) for key, inner in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_to_plain(item) for item in value]
    return value


def _canonical_json(value: Any) -> str:
    return json.dumps(_to_plain(value), default=str, sort_keys=True, separators=(",", ":"))


def _sha256(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _redact_plain(value: Any) -> Any:
    generator = BaseAIGenerator(api_key="audit-metadata-only")

    def redact(inner: Any) -> Any:
        if isinstance(inner, str):
            return generator._sanitize_for_ai(inner)
        if isinstance(inner, dict):
            return {str(key): redact(item) for key, item in inner.items()}
        if isinstance(inner, (list, tuple, set)):
            return [redact(item) for item in inner]
        return inner

    return redact(_to_plain(value))


def build_ai_generation_audit_metadata(
    *,
    request_payload: BaseModel,
    response_payload: Optional[BaseModel] = None,
    current_user: Any,
    generation_source: str,
    request_path: str,
    duration_ms: Optional[int] = None,
    success: bool,
    failure_reason: Optional[str] = None,
    output_count: Optional[int] = None,
    extra: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    redacted_input = _redact_plain(request_payload)
    raw_input = _to_plain(request_payload)
    output_payload = _redact_plain(response_payload) if response_payload is not None else None
    issue_context = getattr(request_payload, "issue_context", None)
    issue_key = getattr(issue_context, "issue_key", None) if issue_context is not None else None
    model_name = (
        getattr(request_payload, "model", None)
        or getattr(current_user, "custom_ai_model", None)
        or settings.OPENROUTER_MODEL
    )

    metadata: dict[str, Any] = {
        "audit_schema_version": "ai_generation.v1",
        "prompt_template_id": PROMPT_TEMPLATE_ID,
        "prompt_template_version": PROMPT_TEMPLATE_VERSION,
        "ai_model_name": model_name,
        "provider_name": AI_PROVIDER_NAME,
        "input_hash": _sha256(redacted_input),
        "output_hash": _sha256(output_payload) if output_payload is not None else None,
        "redaction_applied": _canonical_json(raw_input) != _canonical_json(redacted_input),
        "redaction_rules_version": REDACTION_RULES_VERSION,
        "jira_issue_key": issue_key,
        "generation_user_id": getattr(current_user, "id", None),
        "generation_workspace_id": getattr(current_user, "default_workspace_id", None),
        "generation_timestamp": datetime.now(timezone.utc).isoformat(),
        "generation_source": generation_source,
        "request_path": request_path,
        "duration_ms": duration_ms,
        "success": success,
        "failure_reason": failure_reason,
        "output_count": output_count,
    }
    if extra:
        metadata.update(extra)
    return metadata
