import json
import logging
import re
from typing import Any, Dict, Optional

from fastapi import HTTPException

from app.services.ai.openrouter_client import OpenRouterClient


logger = logging.getLogger(__name__)


class BaseAIGenerator:
    def __init__(self, api_key: Optional[str] = None):
        self.ai_client = OpenRouterClient(api_key=api_key)

    def _sanitize_for_ai(self, text: str) -> str:
        if not text:
            return text

        sanitized = text
        # 1. Emails
        sanitized = re.sub(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", "[REDACTED_EMAIL]", sanitized, flags=re.IGNORECASE)
        
        # 2. JWT-like strings (MUST come before tokens)
        sanitized = re.sub(r"\beyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*\b", "[REDACTED_JWT]", sanitized)
        
        # 3. Bearer tokens and general high-entropy strings (tokens/keys)
        sanitized = re.sub(r"\b(?:Bearer\s+)?[A-Za-z0-9_\-]{32,}\b", "[REDACTED_TOKEN]", sanitized)
        
        # 4. Long numeric identifiers (Credit cards, IBANs, National IDs - often 12+ digits)
        sanitized = re.sub(r"\b\d{12,}\b", "[REDACTED_ID]", sanitized)
        
        # 5. Phone numbers (generic international format)
        sanitized = re.sub(r"\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b", "[REDACTED_PHONE]", sanitized)
        
        # 6. Sensitive query parameters and auth headers
        sanitized = re.sub(
            r"([?&](?:token|access_token|refresh_token|api[_-]?key|apikey|auth|authorization|session[_-]?id|sid)=)[^&\s]+", 
            r"\1[REDACTED_CREDENTIAL]", 
            sanitized, 
            flags=re.IGNORECASE
        )
        sanitized = re.sub(r"(Authorization:\s*)(?:Bearer\s+)?[^\s\n]+", r"\1[REDACTED_AUTH]", sanitized, flags=re.IGNORECASE)
        sanitized = re.sub(r"(Cookie:\s*)[^\n]+", r"\1[REDACTED_COOKIE]", sanitized, flags=re.IGNORECASE)

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

        json_match = re.search(r"```json\s*([\s\S]*?)\s*```", content)
        if json_match:
            try:
                return json.loads(json_match.group(1).strip())
            except Exception:
                pass

        fenced_match = re.search(r"```\s*([\s\S]*?)\s*```", content)
        if fenced_match:
            try:
                return json.loads(fenced_match.group(1).strip())
            except Exception:
                pass

        brace_match = re.search(r"({[\s\S]*})", content)
        if brace_match:
            try:
                return json.loads(brace_match.group(1).strip())
            except Exception:
                pass

        return json.loads(content.strip())

    async def _generate_and_parse_json(
        self,
        system_prompt: str,
        user_prompt: str,
        model: Optional[str] = None,
        expect_test_suite: bool = False,
    ) -> Dict[str, Any]:
        response = await self.ai_client.generate_completion(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            model=model,
        )

        content = self._get_message_content(response)
        parsed = self._extract_json(content)

        if expect_test_suite:
            if not isinstance(parsed.get("test_cases"), list):
                raise ValueError("The AI provider did not return a valid test_cases array.")
            if "coverage_score" not in parsed:
                raise ValueError("The AI provider did not return a coverage_score.")

        return parsed

    async def _generate_with_json_retry(
        self,
        system_prompt: str,
        user_prompt: str,
        model: Optional[str] = None,
        expect_test_suite: bool = False,
    ) -> Dict[str, Any]:
        try:
            return await self._generate_and_parse_json(
                system_prompt,
                user_prompt,
                model=model,
                expect_test_suite=expect_test_suite,
            )
        except HTTPException:
            raise
        except Exception as exc:
            logger.warning("AI JSON parse failed on first attempt: %s", exc)
            retry_prompt = system_prompt + """

            CRITICAL RETRY INSTRUCTION:
            Return one valid JSON object only.
            Do not include markdown fences.
            Do not include prose before or after the JSON.
            Do not leave any field empty.
            """
            try:
                return await self._generate_and_parse_json(
                    retry_prompt,
                    user_prompt,
                    model=model,
                    expect_test_suite=expect_test_suite,
                )
            except HTTPException:
                raise
            except Exception as retry_exc:
                logger.exception("AI JSON parse failed after retry")
                raise HTTPException(
                    status_code=502,
                    detail="AI returned an unreadable response. Please try again.",
                ) from retry_exc

    def _truncate_context(self, text: str, max_chars: int = 15000) -> str:
        """
        Truncates context to stay within token limits.
        """
        if len(text) > max_chars:
            return text[:max_chars] + "\n... (text truncated due to length) ..."
        return text
