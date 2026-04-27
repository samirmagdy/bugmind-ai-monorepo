from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, Optional

from fastapi import HTTPException
import redis
from redis.exceptions import RedisError

from app.core.config import settings


class IdempotencyStore:
    def __init__(self) -> None:
        self.redis = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
        self.ttl_seconds = 60 * 60 * 24
        self.pending_ttl_seconds = 60

    def _key(self, scope: str, subject: str, idem_key: str) -> str:
        return f"idempotency:{scope}:{subject}:{idem_key}"

    def _fingerprint(self, payload: Any) -> str:
        raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def replay_or_reserve(self, scope: str, subject: str, idem_key: Optional[str], payload: Any) -> Optional[Dict[str, Any]]:
        if not idem_key:
            return None

        cache_key = self._key(scope, subject, idem_key)
        payload_fingerprint = self._fingerprint(payload)
        pending_payload = json.dumps({"fingerprint": payload_fingerprint, "response": None, "status": "pending"})

        try:
            reserved = self.redis.set(cache_key, pending_payload, ex=self.pending_ttl_seconds, nx=True)
            if reserved:
                return None
            cached = self.redis.get(cache_key)
        except RedisError:
            return None

        if not cached:
            return None

        try:
            cached_payload = json.loads(cached)
        except json.JSONDecodeError:
            return None
        cached_fingerprint = cached_payload.get("fingerprint")
        if cached_fingerprint != payload_fingerprint:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": {
                        "code": "IDEMPOTENCY_CONFLICT",
                        "message": "Idempotency-Key has already been used with a different request payload.",
                        "details": [],
                    }
                },
            )

        response = cached_payload.get("response")
        if response is None:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": {
                        "code": "IDEMPOTENCY_IN_PROGRESS",
                        "message": "A request with this Idempotency-Key is already in progress.",
                        "details": [],
                    }
                },
            )
        return response

    def store_response(self, scope: str, subject: str, idem_key: Optional[str], payload: Any, response_body: Any) -> None:
        if not idem_key:
            return

        cache_key = self._key(scope, subject, idem_key)
        stored = {
            "fingerprint": self._fingerprint(payload),
            "response": response_body,
        }
        try:
            self.redis.setex(cache_key, self.ttl_seconds, json.dumps(stored, default=str))
        except RedisError:
            return

    def clear_reservation(self, scope: str, subject: str, idem_key: Optional[str], payload: Any) -> None:
        if not idem_key:
            return

        cache_key = self._key(scope, subject, idem_key)
        payload_fingerprint = self._fingerprint(payload)
        try:
            cached = self.redis.get(cache_key)
            if not cached:
                return
            cached_payload = json.loads(cached)
            if cached_payload.get("fingerprint") == payload_fingerprint and cached_payload.get("response") is None:
                self.redis.delete(cache_key)
        except (RedisError, json.JSONDecodeError):
            return


idempotency_store = IdempotencyStore()
