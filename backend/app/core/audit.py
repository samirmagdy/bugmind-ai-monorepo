from __future__ import annotations

import json
import logging
from typing import Any


logger = logging.getLogger("bugmind.audit")


def log_audit(action: str, user_id: int, **metadata: Any) -> None:
    payload = {
        "action": action,
        "user_id": user_id,
        **metadata,
    }
    logger.info(json.dumps(payload, default=str, sort_keys=True))
