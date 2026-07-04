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
    from pathlib import Path
    log_dir = Path(__file__).resolve().parents[2] / "logs"
    log_dir.mkdir(exist_ok=True)
    log_file = log_dir / "errors.log"

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
                },
                "error_file": {
                    "class": "logging.handlers.RotatingFileHandler",
                    "filename": str(log_file),
                    "maxBytes": 10 * 1024 * 1024,  # 10MB
                    "backupCount": 5,
                    "formatter": "standard",
                    "filters": ["redact"],
                    "level": "ERROR",
                }
            },
            "root": {
                "handlers": ["default", "error_file"],
                "level": settings.LOG_LEVEL.upper(),
            },
        }
    )
