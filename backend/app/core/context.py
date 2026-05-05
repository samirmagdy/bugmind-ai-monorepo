from contextvars import ContextVar
from typing import Optional

_trace_id_ctx_var: ContextVar[Optional[str]] = ContextVar("trace_id", default=None)

def get_trace_id() -> Optional[str]:
    return _trace_id_ctx_var.get()

def set_trace_id(trace_id: str) -> None:
    _trace_id_ctx_var.set(trace_id)
