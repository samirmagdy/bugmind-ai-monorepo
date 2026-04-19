import json
import redis
from typing import Dict, Any, List, Optional
from app.core.config import settings
from app.services.jira.adapters.base import JiraAdapter
from redis.exceptions import RedisError

class JiraMetadataEngine:
    def __init__(self, adapter: JiraAdapter):
        self.adapter = adapter
        self.redis = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
        self.cache_ttl = 600 # 10 minutes

    def _get_cached_json(self, cache_key: str) -> Optional[List[Dict[str, Any]]]:
        try:
            cached = self.redis.get(cache_key)
        except RedisError:
            return None

        if not cached:
            return None

        return json.loads(cached)

    def _set_cached_json(self, cache_key: str, value: List[Dict[str, Any]]) -> None:
        try:
            self.redis.setex(cache_key, self.cache_ttl, json.dumps(value))
        except RedisError:
            # Cache is best-effort; metadata fetches should still succeed without Redis.
            return

    def get_project_metadata(self, project_id: str) -> List[Dict[str, Any]]:
        cache_key = f"jira:issue_types:{self.adapter.host_url}:{project_id}"
        cached = self._get_cached_json(cache_key)
        if cached:
            return cached
            
        issue_types = self.adapter.get_issue_types(project_id)
        self._set_cached_json(cache_key, issue_types)
        return issue_types

    def get_field_schema(self, project_id: str, issue_type_id: str) -> List[Dict[str, Any]]:
        cache_key = f"jira:fields:{self.adapter.host_url}:{project_id}:{issue_type_id}"
        cached = self._get_cached_json(cache_key)
        if cached:
            return cached
            
        fields = self.adapter.get_fields(project_id, issue_type_id)
        
        processed_fields = []
        for field in fields:
            is_required = field.get("required", False)
            schema = field.get("schema", {})
            processed_fields.append({
                "key": field.get("fieldId") or field.get("key"),
                "name": field.get("name"),
                "required": is_required,
                "type": schema.get("type") if schema else "string",
                "items": schema.get("items") if schema else None,
                "system": schema.get("system") if schema else None,
                "custom": schema.get("custom") if schema else None,
                "allowed_values": field.get("allowedValues", [])
            })

        if processed_fields:
            self._set_cached_json(cache_key, processed_fields)
        return processed_fields
