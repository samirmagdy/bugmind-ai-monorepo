from typing import Any, Dict, Iterable, Optional


AI_FIELD_ALIASES: Dict[str, str] = {
    "steps_to_reproduce": "steps",
    "expected_result": "expected",
    "actual_result": "actual",
}


STANDARD_FIELD_ALIASES: Dict[str, Dict[str, set[str]]] = {
    "project": {
        "systems": {"project"},
        "names": {"project"},
        "keys": {"project", "projectid", "pid"},
    },
    "issuetype": {
        "systems": {"issuetype"},
        "names": {"issue type"},
        "keys": {"issuetype", "issuetypeid", "typeid"},
    },
}


def _normalize_schema_key(value: object) -> str:
    return str(value or "").strip().lower().replace("_", "").replace("-", "")


def _normalize_name(value: object) -> str:
    return str(value or "").strip().lower()


def normalize_ai_field_key(ai_key: str) -> str:
    normalized = str(ai_key or "").strip().lower()
    return AI_FIELD_ALIASES.get(normalized, normalized)


def canonicalize_ai_payload(ai_output: Dict[str, Any]) -> Dict[str, Any]:
    canonical = dict(ai_output)
    for key, value in ai_output.items():
        canonical_key = normalize_ai_field_key(key)
        canonical.setdefault(canonical_key, value)
    return canonical


def resolve_standard_field_name(field: Dict[str, Any]) -> Optional[str]:
    field_key = _normalize_schema_key(field.get("key"))
    field_system = _normalize_name(field.get("system"))
    field_name = _normalize_name(field.get("name"))

    for standard_field, config in STANDARD_FIELD_ALIASES.items():
        if (
            field_system in config["systems"]
            or field_name in config["names"]
            or field_key in config["keys"]
        ):
            return standard_field

    return None


def get_payload_value_for_field(field: Dict[str, Any], payload_fields: Dict[str, Any]) -> Any:
    field_key = field.get("key")
    if field_key in payload_fields:
        return payload_fields[field_key]

    standard_field = resolve_standard_field_name(field)
    if standard_field:
        return payload_fields.get(standard_field)

    return None


def inject_standard_field_aliases(schema: Iterable[Dict[str, Any]], payload_fields: Dict[str, Any]) -> Dict[str, Any]:
    enriched_fields = dict(payload_fields)

    for field in schema:
        field_key = field.get("key")
        if not field_key or field_key in enriched_fields:
            continue

        standard_field = resolve_standard_field_name(field)
        if standard_field and standard_field in enriched_fields:
            enriched_fields[field_key] = enriched_fields[standard_field]

    return enriched_fields


def is_system_managed_standard_field(field: Dict[str, Any]) -> bool:
    return resolve_standard_field_name(field) in {"project", "issuetype"}
