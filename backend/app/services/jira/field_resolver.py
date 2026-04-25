from typing import Dict, Any, List, Optional
import datetime
import re
from app.services.jira.contract_aliases import canonicalize_ai_payload, normalize_ai_field_key

class JiraFieldResolver:
    def __init__(self, mapping_config: Dict[str, Any], schema: List[Dict[str, Any]], platform: str = "cloud"):
        self.mapping_config = mapping_config
        self.schema = {field["key"]: field for field in schema}
        self.platform = platform

    def resolve(self, ai_output: Dict[str, Any]) -> Dict[str, Any]:
        """
        Takes purely semantic AI output and transforms it to exact Jira payload
        using configured mappings and fallback logic.
        """
        ai_output = canonicalize_ai_payload(ai_output)
        jira_payload = {
            "fields": {}
        }
        
        # Base hardcoded mappings that are standard across all Jira
        jira_payload["fields"]["summary"] = ai_output.get("summary", "Generated Bug")
        jira_payload["fields"]["description"] = self._format_jira_description(ai_output)
        
        # Apply custom field mappings
        for ai_key, jira_field_id in self.mapping_config.items():
            normalized_ai_key = normalize_ai_field_key(ai_key)
            if normalized_ai_key in ai_output and jira_field_id in self.schema:
                field_meta = self.schema[jira_field_id]
                structured_val = self._structure_value(ai_output[normalized_ai_key], field_meta)
                jira_payload["fields"][jira_field_id] = structured_val

        return jira_payload

    def resolve_explicit_fields(self, payload_fields: Dict[str, Any]) -> Dict[str, Any]:
        """
        Preserve user-filled Jira field keys that already match the Jira schema.
        These fields should survive preview/submit even when they are not part of
        the AI mapping configuration.
        """
        explicit_fields: Dict[str, Any] = {}
        for field_key, raw_value in payload_fields.items():
            if field_key not in self.schema:
                continue
            if field_key in {"summary", "description", "project", "issuetype", "issuelinks"}:
                continue

            structured_value = self._structure_value(raw_value, self.schema[field_key])
            if structured_value is None:
                continue
            explicit_fields[field_key] = structured_value
        return explicit_fields

    def _structure_value(self, raw_value: Any, field_meta: Dict[str, Any]) -> Any:
        # Check type of field and wrap appropriately
        field_type = field_meta.get("type", "")
        
        # 1. Option / Priority handling
        if field_type == "option" or field_type == "priority":
            if isinstance(raw_value, dict) and ("id" in raw_value or "value" in raw_value):
                return raw_value
            return {"id": raw_value} if raw_value else None

        elif field_type == "sprint":
            if isinstance(raw_value, dict):
                raw_value = raw_value.get("id") or raw_value.get("value") or raw_value.get("name")
            if raw_value in (None, ""):
                return None
            try:
                return int(raw_value)
            except (TypeError, ValueError):
                return raw_value

        # 2. User / Multi-user handling
        elif field_type == "user" or field_type == "multi-user":
            if self.platform == "server":
                # Jira Server v2 expects {"name": "username"}
                if isinstance(raw_value, list):
                    return [{"name": v.get("id") if isinstance(v, dict) else v} for v in raw_value if v]
                if isinstance(raw_value, dict):
                    return {"name": raw_value.get("id")} if "id" in raw_value else raw_value
                return {"name": raw_value} if raw_value else None
            else:
                # Jira Cloud v3 expects {"accountId": "..."}
                # But search returns 'id' as 'accountId' for Cloud in our adapters
                if isinstance(raw_value, list):
                    return [{"accountId": v.get("id") if isinstance(v, dict) else v} for v in raw_value if v]
                if isinstance(raw_value, dict):
                    return {"accountId": raw_value.get("id")} if "id" in raw_value else raw_value
                return {"accountId": raw_value} if raw_value else None

        # 3. Multi-select handling
        elif field_type == "multi-select":
            if not isinstance(raw_value, list):
                if not raw_value:
                    return []
                raw_value = [raw_value]

            structured = []
            for item in raw_value:
                if isinstance(item, dict):
                    structured.append(item)
                elif item:
                    structured.append({"id": item})
            return structured

        # 4. Labels handling
        elif field_type == "labels":
            if not isinstance(raw_value, list):
                if not raw_value:
                    return []
                raw_value = [raw_value]
            return [str(v) for v in raw_value if str(v).strip()]

        # 5. Date / Datetime handling
        elif field_type == "date" or field_type == "datetime":
            if not raw_value:
                return None
            
            # If already looks like ISO (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)
            iso_pattern = re.compile(r"^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2})?")
            if isinstance(raw_value, str) and iso_pattern.match(raw_value):
                return raw_value
                
            # If is actual datetime object
            if isinstance(raw_value, (datetime.date, datetime.datetime)):
                return raw_value.isoformat()
            
            # Simple heuristic for common AI strings
            try:
                # If "today", "tomorrow", etc. (placeholder logic for now, usually AI outputs strings like "2023-10-27")
                return str(raw_value)
            except:
                return None

        # 6. Array handling (generic arrays)
        elif field_type == "array":
            if not isinstance(raw_value, list):
                if not raw_value: return []
                raw_value = [raw_value]
            
            # Special case for labels (list of strings)
            if field_meta.get("items") == "string":
                return [str(v) for v in raw_value]
            
            # Standard array of objects
            return [{"value": v} if isinstance(v, str) else v for v in raw_value]

        return raw_value

    def _format_jira_description(self, ai_output: Dict[str, Any]) -> str:
        """
        Assembles the final Jira description block. 
        It concatenates the core description with steps and results, 
        but only for parts that haven't been mapped to specific custom fields.
        """
        parts = []
        
        # 1. Main Summary / Description
        base_desc = ai_output.get("description", "").strip()
        if base_desc:
            parts.append(base_desc)
            
        # 2. Steps (if not mapped elsewhere)
        if not any(normalize_ai_field_key(key) == "steps" for key in self.mapping_config):
            steps_list = ai_output.get("steps", [])
            if steps_list:
                formatted_steps = "\n".join([f" # {step}" for step in steps_list])
                parts.append(f"*Steps to Reproduce:*\n{formatted_steps}")
                
        # 3. Expected (if not mapped elsewhere)
        if not any(normalize_ai_field_key(key) == "expected" for key in self.mapping_config):
            expected = ai_output.get("expected")
            if expected:
                parts.append(f"*Expected Result:*\n{expected}")
                
        # 4. Actual (if not mapped elsewhere)
        if not any(normalize_ai_field_key(key) == "actual" for key in self.mapping_config):
            actual = ai_output.get("actual")
            if actual:
                parts.append(f"*Actual Result:*\n{actual}")
                
        return "\n\n".join(parts)
