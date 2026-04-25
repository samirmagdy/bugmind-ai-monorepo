import json
import logging
import re
from typing import Dict, Any, Optional

from app.services.ai.openrouter_client import OpenRouterClient
from fastapi import HTTPException


logger = logging.getLogger(__name__)


class BugGenerator:
    def __init__(self, api_key: Optional[str] = None):
        self.ai_client = OpenRouterClient(api_key=api_key)

    def _sanitize_for_ai(self, text: str) -> str:
        if not text:
            return text

        sanitized = text
        sanitized = re.sub(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", "[REDACTED_EMAIL]", sanitized, flags=re.IGNORECASE)
        sanitized = re.sub(r"\b(?:Bearer\s+)?[A-Za-z0-9_\-]{20,}\b", "[REDACTED_TOKEN]", sanitized, flags=re.IGNORECASE)
        sanitized = re.sub(r"\b\d{7,}\b", "[REDACTED_NUMBER]", sanitized)
        sanitized = re.sub(r"([?&](?:token|access_token|refresh_token|api[_-]?key|apikey|auth|authorization)=)[^&\s]+", r"\1[REDACTED_TOKEN]", sanitized, flags=re.IGNORECASE)
        return sanitized

    def _get_message_content(self, response: Dict[str, Any]) -> str:
        choices = response.get("choices") or []
        if not choices:
            raise ValueError("The AI provider returned no choices.")

        message = choices[0].get("message") or {}
        content = message.get("content")

        if isinstance(content, str):
            return content.strip()

        # Some providers/models can return structured content parts instead of a plain string.
        if isinstance(content, list):
            text_parts = []
            for item in content:
                if isinstance(item, dict):
                    if isinstance(item.get("text"), str):
                        text_parts.append(item["text"])
                    elif item.get("type") == "text" and isinstance(item.get("content"), str):
                        text_parts.append(item["content"])
                elif isinstance(item, str):
                    text_parts.append(item)
            return "\n".join(part.strip() for part in text_parts if part and part.strip()).strip()

        return ""

    def _extract_json(self, content: str) -> Dict[str, Any]:
        """
        Robustly extracts JSON from AI response, handling markdown blocks or leading/trailing text.
        """
        if not content or not content.strip():
            raise ValueError("The AI provider returned an empty response.")

        content = content.strip()

        # 1. Try finding a JSON markdown block
        json_match = re.search(r"```json\s*([\s\S]*?)\s*```", content)
        if json_match:
            try:
                return json.loads(json_match.group(1).strip())
            except:
                pass

        # 1b. Try any fenced block if the model omitted the language tag
        fenced_match = re.search(r"```\s*([\s\S]*?)\s*```", content)
        if fenced_match:
            try:
                return json.loads(fenced_match.group(1).strip())
            except:
                pass
        
        # 2. Try finding the first { and last }
        brace_match = re.search(r"({[\s\S]*})", content)
        if brace_match:
            try:
                return json.loads(brace_match.group(1).strip())
            except:
                pass
        
        # 3. Last resort: raw parse
        return json.loads(content.strip())

    async def _generate_and_parse_json(self, system_prompt: str, user_prompt: str, model: str = None, expect_test_suite: bool = False) -> Dict[str, Any]:
        response = await self.ai_client.generate_completion(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            model=model
        )

        content = self._get_message_content(response)
        parsed = self._extract_json(content)

        if expect_test_suite:
            if not isinstance(parsed.get("test_cases"), list):
                raise ValueError("The AI provider did not return a valid test_cases array.")
            if "coverage_score" not in parsed:
                raise ValueError("The AI provider did not return a coverage_score.")

        return parsed

    def _clean_schema_for_ai(self, schema: list) -> list:
        """
        Aggressively filters and minifies the Jira schema to prevent AI prompt bloat.
        Prioritizes required fields and common smart-inference fields.
        """
        SMART_FIELDS = {
            "priority", "severity", "component", "components", "version", "versions", 
            "fixversion", "fixversions", "environment", "labels", "epic"
        }
        
        # 1. Filter: Keep Required OR Smart Fields
        filtered = []
        for field in schema:
            name_lower = str(field.get("name", "")).lower()
            is_smart = any(keyword in name_lower for keyword in SMART_FIELDS)
            if field.get("required") or is_smart:
                filtered.append(field)
                
        # 2. Minify and Sort
        cleaned = []
        # Sort so required fields are processed first (and kept if we hit the cap)
        filtered.sort(key=lambda x: x.get("required", False), reverse=True)
        
        for field in filtered[:40]: # Hard cap at 40 fields
            f = {
                "key": field.get("key"),
                "name": field.get("name"),
                "type": field.get("type"),
                "required": field.get("required")
            }
            
            if "allowed_values" in field:
                av = field["allowed_values"]
                if isinstance(av, list):
                    # Truncate to first 3 items (minified)
                    f["allowed_values"] = av[:3]
                    if len(av) > 3:
                        f["allowed_values"].append({"id": "...", "name": "..."})
            
            cleaned.append(f)
            
        return cleaned

    def _truncate_context(self, text: str, max_chars: int = 15000) -> str:
        """
        Truncates the story context to stay within token limits.
        """
        if len(text) > max_chars:
            return text[:max_chars] + "\n... (text truncated due to length) ..."
        return text
        
    async def generate_bug(self, context_text: str, current_fields_schema: list, model: str = None, user_description: str = None, custom_instructions: str = None) -> Dict[str, Any]:
        """
        AI-assisted bug drafting. If user_description is provided, it maps that to the context.
        """
        # 1. Optimize Schema FIRST to prevent prompt bloat
        optimized_schema = self._clean_schema_for_ai(current_fields_schema)
        schema_json = json.dumps(optimized_schema)
        
        logger.info(
            "Optimized Jira schema for AI prompt original_chars=%s optimized_chars=%s",
            len(json.dumps(current_fields_schema)),
            len(schema_json),
        )

        mode_instruction = ""
        if user_description:
            mode_instruction = f"""
            The user has manually described a bug they found: "{user_description}"
            Your primary goal is to structure this specific bug report using the story context below.
            Return exactly one bug in the bugs array.
            """
        else:
            mode_instruction = """
            Analyze the story context and identify multiple distinct quality gaps.
            Return 3 to 5 materially different bug candidates covering missing requirements, functional gaps, edge cases, and risks.
            Do not collapse all findings into one generic issue.
            """

        instruction_block = f"\nPERSONALITY & STYLE GUIDE: {custom_instructions}" if custom_instructions else ""

        system_prompt = f"""
        You are BugMind, a Senior QA Lead. 
        Your task is to synthesize a professional Jira bug report.
        {instruction_block}
        
        {mode_instruction}
        
        REQUIREMENTS:
        - Each bug's "summary" must be a high-quality headline.
        - Each bug's "steps" must be a clean list of reproduction steps. YOU MUST PROVIDE STEPS.
        - Each bug's "expected" result must align with the acceptance criteria in the story.
        - Each bug's "actual" result must detail the observed deviation.
        - Each bug's "description" must be a professional summary of the problem and its impact (Core Findings), EXCLUDING the detailed steps, expected, or actual result sections as these are captured separately.
        - Each bug's "custom_fields" dictionary: Scrutinize the schema below. If you can confidently predict a value for any of these fields (like Priority, Severity, or Component) based on the context, populate the key with the field ID and the value with the appropriate Jira object (e.g. {{"id": "..."}}).

        CRITICAL:
        - YOU MUST PROVIDE VALUES FOR ALL FIELDS FOR EVERY BUG.
        - If "steps" are missing, use logic to create them.
        - If "expected" or "actual" results are not explicitly provided by the user, you MUST infer them based on the context.
        - NEVER return null or empty strings for these core fields.
        - Each bug in the bugs array must represent a distinct issue, not a rewording of another bug.

        The current Jira project expects these fields:
        {schema_json}
        
        OUTPUT FORMAT (JSON ONLY):
        {{
            "bugs": [
                {{
                    "summary": "Concise Bug Title",
                    "description": "*Summary*\\nConcise explanation of the defect and where it occurs.",
                    "steps": ["Step 1", "Step 2"],
                    "expected": "Expected behavior per the ACs",
                    "actual": "Actual observed deviation",
                    "custom_fields": {{ "field_id": {{ "id": "value_id" }} or "string_value" }}
                }}
            ],
            "ac_coverage": 85.0,
        }}
        """

        try:
            truncated_context = self._truncate_context(self._sanitize_for_ai(context_text))
            user_prompt = f"Story Context:\n{truncated_context}"
            if user_description:
                user_prompt += f"\n\nUser's Bug Observation:\n{self._truncate_context(self._sanitize_for_ai(user_description), 2000)}"
            return await self._generate_and_parse_json(system_prompt, user_prompt, model=model)
        except HTTPException:
            raise
        except Exception as e:
            logger.exception("AI bug generation failed")
            raise HTTPException(status_code=500, detail=f"AI Bug Generation Failed: {str(e)}")

    async def generate_test_cases(self, context_text: str, model: str = None, custom_instructions: str = None) -> Dict[str, Any]:
        """
        Converts a Jira story context into a comprehensive test suite.
        """
        instruction_block = f"\nPERSONALITY & STYLE GUIDE: {custom_instructions}" if custom_instructions else ""

        system_prompt = f"""
        You are BugMind, a Lead QA Engineer. 
        Read the provided User Story and Acceptance Criteria.
        Generate a comprehensive set of test cases to verify this story.
        {instruction_block}
        
        OUTPUT FORMAT (JSON ONLY):
        {{
            "test_cases": [
                {{
                    "title": "Clear case title",
                    "steps": ["Step 1", "Step 2"],
                    "expected_result": "What should happen",
                    "priority": "High/Medium/Low"
                }}
            ],
            "coverage_score": 95.0
        }}
        """

        try:
            truncated_context = self._truncate_context(self._sanitize_for_ai(context_text))
            user_prompt = f"Story Context:\n{truncated_context}"
            try:
                return await self._generate_and_parse_json(
                    system_prompt,
                    user_prompt,
                    model=model,
                    expect_test_suite=True
                )
            except HTTPException:
                raise
            except Exception:
                retry_prompt = system_prompt + """

                CRITICAL RETRY INSTRUCTION:
                Return a valid JSON object only.
                Do not include markdown fences.
                Do not include prose before or after the JSON.
                """
                return await self._generate_and_parse_json(
                    retry_prompt,
                    user_prompt,
                    model=model,
                    expect_test_suite=True
                )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"AI Test Suite Generation Failed: {str(e)}")
