from typing import Dict, Any, List

class JiraFieldResolver:
    def __init__(self, mapping_config: Dict[str, Any], schema: List[Dict[str, Any]]):
        self.mapping_config = mapping_config
        self.schema = {field["key"]: field for field in schema}

    def resolve(self, ai_output: Dict[str, Any]) -> Dict[str, Any]:
        """
        Takes purely semantic AI output and transforms it to exact Jira payload
        using configured mappings and fallback logic.
        """
        jira_payload = {
            "fields": {}
        }
        
        # Base hardcoded mappings that are standard across all Jira
        jira_payload["fields"]["summary"] = ai_output.get("summary", "Generated Bug")
        jira_payload["fields"]["description"] = self._format_jira_description(ai_output)
        
        # Apply custom field mappings
        for ai_key, jira_field_id in self.mapping_config.items():
            if ai_key in ai_output and jira_field_id in self.schema:
                field_meta = self.schema[jira_field_id]
                structured_val = self._structure_value(ai_output[ai_key], field_meta)
                jira_payload["fields"][jira_field_id] = structured_val

        return jira_payload

    def _structure_value(self, raw_value: Any, field_meta: Dict[str, Any]) -> Any:
        # Check type of field and wrap appropriately
        field_type = field_meta.get("type", "")
        if field_type == "option" or field_type == "priority":
            return {"id": raw_value} # Expecting AI to output valid ID or we resolve ID before this step
        elif field_type == "array":
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
        if "steps" not in self.mapping_config:
            steps_list = ai_output.get("steps", [])
            if steps_list:
                formatted_steps = "\n".join([f" # {step}" for step in steps_list])
                parts.append(f"*Steps to Reproduce:*\n{formatted_steps}")
                
        # 3. Expected (if not mapped elsewhere)
        if "expected" not in self.mapping_config:
            expected = ai_output.get("expected")
            if expected:
                parts.append(f"*Expected Result:*\n{expected}")
                
        # 4. Actual (if not mapped elsewhere)
        if "actual" not in self.mapping_config:
            actual = ai_output.get("actual")
            if actual:
                parts.append(f"*Actual Result:*\n{actual}")
                
        return "\n\n".join(parts)
