from __future__ import annotations

import logging
import threading
import time

from fastapi import HTTPException
import redis
from redis.exceptions import RedisError

from app.core.config import settings

logger = logging.getLogger("bugmind.security")


class RateLimiter:
    def __init__(self) -> None:
        self.redis = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
        self._fallback_counts: dict[str, tuple[int, float]] = {}
        self._fallback_lock = threading.Lock()
        self._last_redis_warning_at = 0.0

    def _raise_limited(self, retry_after: int) -> None:
        raise HTTPException(
            status_code=429,
            detail={
                "error": {
                    "code": "RATE_LIMITED",
                    "message": "Too many requests",
                    "details": [{"retry_after_seconds": max(retry_after, 0)}],
                }
            },
        )

    def _check_fallback(self, cache_key: str, limit: int, window_seconds: int) -> None:
        now = time.monotonic()
        with self._fallback_lock:
            current, expires_at = self._fallback_counts.get(cache_key, (0, now + window_seconds))
            if expires_at <= now:
                current = 0
                expires_at = now + window_seconds

            current += 1
            self._fallback_counts[cache_key] = (current, expires_at)

            if len(self._fallback_counts) > 10000:
                self._fallback_counts = {
                    key: value for key, value in self._fallback_counts.items()
                    if value[1] > now
                }

            if current > limit:
                self._raise_limited(int(expires_at - now))

    def check(self, scope: str, subject: str, limit: int, window_seconds: int) -> None:
        if not settings.should_enforce_rate_limits:
            return

        cache_key = f"ratelimit:{scope}:{subject}"
        try:
            current = self.redis.incr(cache_key)
            if current == 1:
                self.redis.expire(cache_key, window_seconds)
            if current > limit:
                self._raise_limited(self.redis.ttl(cache_key))
        except RedisError:
            now = time.monotonic()
            if now - self._last_redis_warning_at > 60:
                logger.warning("rate_limit_redis_unavailable fallback=in_process")
                self._last_redis_warning_at = now
            self._check_fallback(cache_key, limit, window_seconds)


rate_limiter = RateLimiter()
