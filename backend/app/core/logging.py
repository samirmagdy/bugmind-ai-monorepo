from __future__ import annotations

import logging
import re
from logging.config import dictConfig

from app.core.config import settings


class RedactingFilter(logging.Filter):
    _patterns = [
        re.compile(r"Bearer\s+[A-Za-z0-9\-._~+/]+=*", re.IGNORECASE),
        re.compile(r"Basic\s+[A-Za-z0-9+/]+=*", re.IGNORECASE),
        # Detect and mask username:password or username:token combinations (8+ chars for secret)
        re.compile(r"[a-zA-Z0-9._%+-]+:[A-Za-z0-9\-._~+/]{8,}"),
        re.compile(r"sk_[A-Za-z0-9]+"),
        re.compile(r"sbp_[A-Za-z0-9]+"),
    ]

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        for pattern in self._patterns:
            message = pattern.sub("[REDACTED]", message)
        record.msg = message
        record.args = ()
        return True


def configure_logging() -> None:
    dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "filters": {
                "redact": {"()": "app.core.logging.RedactingFilter"},
            },
            "formatters": {
                "standard": {
                    "format": "%(asctime)s %(levelname)s %(name)s %(message)s",
                }
            },
            "handlers": {
                "default": {
                    "class": "logging.StreamHandler",
                    "formatter": "standard",
                    "filters": ["redact"],
                }
            },
            "root": {
                "handlers": ["default"],
                "level": settings.LOG_LEVEL.upper(),
            },
        }
    )
