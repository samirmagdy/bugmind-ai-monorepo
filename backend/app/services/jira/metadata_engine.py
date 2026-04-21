import json
import redis
from typing import Dict, Any, List, Optional
from app.core.config import settings
from app.services.jira.adapters.base import JiraAdapter
from redis.exceptions import RedisError

class JiraMetadataEngine:
    FIELD_SCHEMA_CACHE_VERSION = "v2"

    def __init__(self, adapter: JiraAdapter):
        self.adapter = adapter
        self.redis = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
        self.cache_ttl = 600 # 10 minutes

    def _get_cached_json(self, cache_key: str) -> Any:
        try:
            cached = self.redis.get(cache_key)
            if cached:
                return json.loads(cached)
        except (RedisError, json.JSONDecodeError, TypeError):
            # Log warning if needed, but fail silently for best-effort caching
            pass
        return None

    def _set_cached_json(self, cache_key: str, value: Any) -> None:
        try:
            self.redis.setex(cache_key, self.cache_ttl, json.dumps(value))
        except RedisError:
            # Cache is best-effort; metadata fetches should still succeed without Redis.
            return

    def get_project_metadata(self, project_id: str) -> Dict[str, Any]:
        cache_key = f"jira:project_context:v1:{self.adapter.host_url}:{project_id}"
        cached = self._get_cached_json(cache_key)
        if isinstance(cached, dict):
            return cached
            
        data = self.adapter.get_issue_types(project_id)
        self._set_cached_json(cache_key, data)
        return data

    def get_field_schema(self, project_id: str, issue_type_id: str) -> List[Dict[str, Any]]:
        cache_key = f"jira:fields:{self.FIELD_SCHEMA_CACHE_VERSION}:{self.adapter.host_url}:{project_id}:{issue_type_id}"
        cached = self._get_cached_json(cache_key)
        if cached:
            return cached
            
        fields = self.adapter.get_fields(project_id, issue_type_id)
        
        processed_fields = []
        for field in fields:
            # Multi-layer safety for required flag
            is_required = field.get("required", False)
            
            # Robust schema extraction
            schema = field.get("schema", {})
            if not schema and "schema" in field:
                # Handle cases where schema might be a list or something else unexpectedly
                schema = field["schema"] if isinstance(field["schema"], dict) else {}

            # Type mapping - default to string but check custom field types
            f_type = schema.get("type", "string")
            custom_type = schema.get("custom", "")
            
            # Refine type based on common custom field types if generic 'string' or 'array'
            if "userpicker" in custom_type.lower():
                f_type = "user" if f_type != "array" else "multi-user"
            elif "multiselect" in custom_type.lower() or "multicheckboxes" in custom_type.lower():
                f_type = "multi-select"
            elif "labels" in custom_type.lower():
                f_type = "labels"

            processed_fields.append({
                "key": field.get("fieldId") or field.get("key") or field.get("id"),
                "name": field.get("name"),
                "required": is_required,
                "type": f_type,
                "items": schema.get("items"),
                "system": schema.get("system"),
                "custom": custom_type,
                "allowed_values": field.get("allowedValues") or field.get("values") or []
            })

        if processed_fields:
            self._set_cached_json(cache_key, processed_fields)
        return processed_fields
