import json
import re
from typing import Dict, Any, Optional
from app.services.ai.openrouter_client import OpenRouterClient
from fastapi import HTTPException

class BugGenerator:
    def __init__(self, api_key: Optional[str] = None):
        self.ai_client = OpenRouterClient(api_key=api_key)

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
        Strips massive allowed_values from the schema to save tokens.
        AI only needs to know the field exists and its type.
        """
        cleaned = []
        for field in schema:
            f = field.copy()
            if "allowed_values" in f:
                # Truncate to first 5 items to give the AI some context of the format
                # without blowing up the token count.
                av = f["allowed_values"]
                if isinstance(av, list) and len(av) > 5:
                    f["allowed_values"] = av[:5] + [{"id": "...", "name": f"... (and {len(av)-5} more)"}]
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
        mode_instruction = ""
        if user_description:
            mode_instruction = f"""
            The user has manually described a bug they found: "{user_description}"
            Your primary goal is to structure this specific bug report using the story context below.
            """
        else:
            mode_instruction = """
            Take the initiative to predict the most likely bug that could occur based on this story context.
            """

        instruction_block = f"\nPERSONALITY & STYLE GUIDE: {custom_instructions}" if custom_instructions else ""

        system_prompt = f"""
        You are BugMind, a Senior QA Lead. 
        Your task is to synthesize a professional Jira bug report.
        {instruction_block}
        
        {mode_instruction}
        
        REQUIREMENTS:
        - The "summary" must be a high-quality headline.
        - The "steps" must be a clean list of reproduction steps. YOU MUST PROVIDE STEPS.
        - The "expected" result must align with the acceptance criteria in the story.
        - The "actual" result must detail the observed deviation.
        - The "description" must be a professional summary of the problem and its impact (Core Findings), EXCLUDING the detailed steps, expected, or actual result sections as these are captured separately.
        - The "custom_fields" dictionary: Scrutinize the schema below. If you can confidently predict a value for any of these fields (like Priority, Severity, or Component) based on the context, populate the key with the field ID and the value with the appropriate Jira object (e.g. {{"id": "..."}}).

        CRITICAL: YOU MUST PROVIDE VALUES FOR ALL FIELDS. 
        If "steps" are missing, use logic to create them. 
        If "expected" or "actual" results are not explicitly provided by the user, you MUST infer them based on the context. 
        NEVER return null or empty strings for these core fields.

        The current Jira project expects these fields:
        {json.dumps(current_fields_schema)}
        
        OUTPUT FORMAT (JSON ONLY):
        {{
            "summary": "Concise Bug Title",
            "description": "*Summary*\\nConcise explanation of the defect and where it occurs.",
            "steps": ["Step 1", "Step 2"],
            "expected": "Expected behavior per the ACs",
            "actual": "Actual observed deviation",
            "ac_coverage": 85.0,
            "custom_fields": {{ "field_id": {{ "id": "value_id" }} or "string_value" }}
        }}
        """

        try:
            optimized_schema = self._clean_schema_for_ai(current_fields_schema)
            print(f"[BugMind-AI] Optimized Schema Size: {len(json.dumps(optimized_schema))} chars (Original: {len(json.dumps(current_fields_schema))})")
            
            system_prompt = system_prompt.replace(json.dumps(current_fields_schema), json.dumps(optimized_schema))
            
            truncated_context = self._truncate_context(context_text)
            user_prompt = f"Story Context:\n{truncated_context}"
            if user_description:
                user_prompt += f"\n\nUser's Bug Observation:\n{self._truncate_context(user_description, 2000)}"
            return await self._generate_and_parse_json(system_prompt, user_prompt, model=model)
        except Exception as e:
            import traceback
            print(f"[BugMind-AI] Generation Error Traceback:")
            print(traceback.format_exc())
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
            truncated_context = self._truncate_context(context_text)
            user_prompt = f"Story Context:\n{truncated_context}"
            try:
                return await self._generate_and_parse_json(
                    system_prompt,
                    user_prompt,
                    model=model,
                    expect_test_suite=True
                )
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
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"AI Test Suite Generation Failed: {str(e)}")
