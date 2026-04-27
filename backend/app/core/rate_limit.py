from __future__ import annotations

from fastapi import HTTPException
import redis
from redis.exceptions import RedisError

from app.core.config import settings


class RateLimiter:
    def __init__(self) -> None:
        self.redis = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)

    def check(self, scope: str, subject: str, limit: int, window_seconds: int) -> None:
        if not settings.should_enforce_rate_limits:
            return

        cache_key = f"ratelimit:{scope}:{subject}"
        try:
            current = self.redis.incr(cache_key)
            if current == 1:
                self.redis.expire(cache_key, window_seconds)
            if current > limit:
                retry_after = self.redis.ttl(cache_key)
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
        except RedisError:
            if settings.is_production:
                raise HTTPException(status_code=503, detail="Rate limiting service unavailable")
            return


rate_limiter = RateLimiter()
