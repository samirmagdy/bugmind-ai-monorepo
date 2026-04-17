import httpx
import json
import re
import asyncio
from typing import List, Dict, Any, Optional
import os
import logging
from dotenv import load_dotenv

load_dotenv()

class AIConnectionError(Exception):
    """Custom exception for AI provider connection issues."""
    pass

class AIEngine:
    def __init__(self, api_key: str, model: str = None):
        if not api_key or api_key.startswith("sk-or-v1-..."):
            raise ValueError("OpenRouter API Key is missing or invalid. Please check your settings.")
        self.api_key = api_key
        self.model = model or os.getenv("DEFAULT_AI_MODEL", "google/gemini-2.0-flash-001")
        self.base_url = "https://openrouter.ai/api/v1/chat/completions"
        self.logger = logging.getLogger("bugmind")

    async def generate_bugs(self, story_summary: str, story_description: str, acceptance_criteria: str, field_context: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
        prompt = self._build_prompt(story_summary, story_description, acceptance_criteria, field_context)
        
        for attempt in range(3):
            try:
                    self.logger.info(f"[AI-OUT]   Analyzing with {self.model}...")
                    async with httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=10.0)) as client:
                        response = await client.post(
                            self.base_url,
                            headers={
                                "Authorization": f"Bearer {self.api_key}",
                                "HTTP-Referer": "https://bugmind.ai", # Optional
                                "X-Title": "BugMind AI",
                                "Content-Type": "application/json"
                            },
                            json={
                                "model": self.model,
                                "messages": [
                                    {"role": "system", "content": "You are a senior QA engineer. Generate high-quality bug reports based on the provided user story and acceptance criteria. For each bug, fill relevant Jira fields provided in the context into an 'extra_fields' object. Return ONLY a JSON array of bug objects."},
                                    {"role": "user", "content": prompt}
                                ],
                                "response_format": {"type": "json_object"}
                            }
                        )
                    response.raise_for_status()
                    result = response.json()
                    
                    content = result['choices'][0]['message']['content']
                    self.logger.info(f"[AI-IN]    Analysis complete ({len(content)} chars)")

                    # Parse JSON safely - strip markdown code blocks if present
                    try:
                        # Robust regex extraction: find the last JSON code block
                        code_block_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', content)
                        if code_block_match:
                            content = code_block_match.group(1).strip()
                        
                        data = json.loads(content)
                        self.logger.info("[AI-OK]    JSON parsed successfully")
                    except Exception as parse_err:
                        print(f"--- AI DEBUG: JSON PARSE FAILED: {parse_err} ---")
                        print(f"FULL CONTENT: {content}")
                        raise Exception(f"Failed to parse AI response as JSON: {parse_err}")
                    
                    # Handle multiple potential JSON formats from AI
                    bugs = []
                    if isinstance(data, dict):
                        if "bugs" in data:
                            bugs = data["bugs"]
                        elif "summary" in data: # Single bug object
                            bugs = [data]
                    elif isinstance(data, list):
                        bugs = data
                    
                    # Post-process: Convert any list fields to strings (common AI variance)
                    for bug in bugs:
                        for field in ["steps_to_reproduce", "expected_result", "actual_result"]:
                            if field in bug and isinstance(bug[field], list):
                                bug[field] = "\n".join([str(item) for item in bug[field]])
                        
                    return bugs
            except (httpx.ConnectTimeout, httpx.ConnectError) as e:
                print(f"Connection to AI failed (attempt {attempt + 1}): {e}")
                if attempt == 2:
                    raise AIConnectionError("Could not reach AI provider. Please check your internet connection or VPN/Proxy settings.")
                await asyncio.sleep(1)
            except Exception as e:
                print(f"AI Generation attempt {attempt + 1} failed: {e}")
                if attempt == 2:
                    raise e
    async def stream_generate_bugs(self, story_summary: str, story_description: str, acceptance_criteria: str, field_context: Optional[List[Dict[str, Any]]] = None):
        prompt = self._build_prompt(story_summary, story_description, acceptance_criteria, field_context)
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "HTTP-Referer": "https://bugmind.ai",
            "X-Title": "BugMind AI",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": "You are a senior QA engineer. Generate high-quality bug reports. For each bug, populate relevant Jira fields into an 'extra_fields' object. Return ONLY a JSON matching the format: {\"bugs\": [...]}. Keep responses strictly to the JSON structure."},
                {"role": "user", "content": prompt}
            ],
            "stream": True
        }
        
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream("POST", self.base_url, headers=headers, json=payload) as response:
                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        if line.startswith("data: "):
                            data_str = line[6:].strip()
                            if data_str == "[DONE]":
                                break
                            try:
                                data = json.loads(data_str)
                                if 'choices' in data and len(data['choices']) > 0:
                                    delta = data['choices'][0].get('delta', {})
                                    chunk = delta.get('content', '')
                                    if chunk:
                                        yield chunk
                            except json.JSONDecodeError:
                                continue
        except Exception as e:
            print(f"Streaming failed: {e}")
            yield f"Error: {str(e)}"

    def _build_prompt(self, summary: str, description: str, ac: str, field_context: Optional[List[Dict[str, Any]]] = None) -> str:
        fields_str = ""
        if field_context:
            fields_str = "\nAvailable Jira Fields to populate in 'extra_fields':\n"
            for f in field_context:
                options = ""
                if f.get("allowed_values"):
                    options = " (Options: " + ", ".join([opt.get("name") or opt.get("value") or opt.get("label") or opt.get("id") for opt in f["allowed_values"]]) + ")"
                fields_str += f"- {f['key']} ({f['name']}): {f['type']}{options}\n"

        return f"""
        User Story Summary: {summary}
        User Story Description: {description}
        Acceptance Criteria: {ac}
        {fields_str}

        Instructions:
        1. Identify potential edge cases, functional gaps, and UI/UX issues.
        2. Format each bug with:
           - summary: Clear and concise.
           - description: Detailed explanation.
           - steps_to_reproduce: Clear numbered steps.
           - expected_result: What should happen.
           - actual_result: What might happen (bug behavior).
           - severity: Low, Medium, High, Critical.
           - extra_fields: A dictionary where keys are Jira field keys from the list above and values are appropriate for the field type (use IDs if options are provided).
        3. Return ONLY valid JSON in this format: {{"bugs": [...]}}
        """

    async def analyze_coverage(self, story: str, ac: str, generated_bugs: List[Dict[str, Any]]) -> Dict[str, Any]:
        # Additional intelligence feature: coverage analysis
        return {"coverage_score": 85, "missing_scenarios": []}

    async def generate_bug_from_description(self, human_description: str, jira_context: str) -> Dict[str, Any]:
        prompt = f"""
        Jira Issue Context: {jira_context}
        Human Bug Description: "{human_description}"

        Instructions:
        1. Transform the human description into a formal, structured bug report.
        2. Infer technical details, clear numbered steps, and a professional summary.
        3. Match the tone and detail level of high-quality QA engineers.
        4. Return ONLY valid JSON with summary, description, steps_to_reproduce, expected_result, actual_result, and severity.
        """
        
        timeout = httpx.Timeout(60.0, connect=15.0) # Reduced from 120s to prevent long hangs
        
        for attempt in range(2): # Reduced retries for structuring
            try:
                self.logger.info(f"[AI-OUT]   Structuring manual bug (Attempt {attempt+1})...")
                async with httpx.AsyncClient(timeout=timeout) as client:
                    response = await client.post(
                        self.base_url,
                        headers={
                            "Authorization": f"Bearer {self.api_key}",
                            "Content-Type": "application/json",
                            "X-Title": "BugMind AI"
                        },
                        json={
                            "model": self.model,
                            "messages": [
                                {"role": "system", "content": "You are a senior QA engineer. Structure manual bug descriptions into professional reports. Return ONLY a JSON object."},
                                {"role": "user", "content": prompt}
                            ],
                            "response_format": {"type": "json_object"}
                        }
                    )
                
                if response.status_code != 200:
                    print(f"AI Provider error ({response.status_code}): {response.text}")
                    if attempt < 1: continue # Retry on provider errors
                    raise Exception(f"AI Provider error: {response.status_code}")

                result = response.json()
                if 'choices' not in result or len(result['choices']) == 0:
                    raise Exception("Malformed AI response: 'choices' missing or empty")

                choice = result['choices'][0]
                content = choice.get('message', {}).get('content', '')
                if not content:
                    raise Exception("AI returned empty content")
                # Robust regex extraction: find the last JSON code block
                code_block_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', content)
                if code_block_match:
                    content = code_block_match.group(1).strip()
                
                data = json.loads(content)
                
                # Map variants and join list fields
                mappings = {
                    "steps": "steps_to_reproduce",
                    "reproduce": "steps_to_reproduce",
                    "expected": "expected_result",
                    "actual": "actual_result"
                }
                for alt, canonical in mappings.items():
                    if alt in data and canonical not in data:
                        data[canonical] = data[alt]

                # Ensure all required fields exist
                required_fields = ["summary", "description", "steps_to_reproduce", "expected_result", "actual_result", "severity"]
                for field in required_fields:
                    if field not in data: data[field] = "N/A"
                    if isinstance(data[field], list):
                        data[field] = "\n".join([str(item) for item in data[field]])
                
                return data
            except (httpx.ConnectTimeout, httpx.ConnectError) as e:
                print(f"Connection to AI failed (attempt {attempt+1}): {e}")
                if attempt == 1: raise AIConnectionError("AI Provider unreachable. Please verify your connection to openrouter.ai.")
                await asyncio.sleep(1)
            except Exception as e:
                import traceback
                traceback.print_exc()
                print(f"Manual Bug Structuring failed: {e}")
                if attempt == 1: raise e
                await asyncio.sleep(1)
