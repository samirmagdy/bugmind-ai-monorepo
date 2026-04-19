import httpx
from typing import Dict, Any, Optional
from app.core.config import settings

class OpenRouterClient:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or settings.OPENROUTER_API_KEY
        self.base_url = "https://openrouter.ai/api/v1/chat/completions"
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://bugmind.ai",
            "X-Title": "BugMind AI Platform"
        }

    async def generate_completion(self, system_prompt: str, user_prompt: str, model: str = None) -> Dict[str, Any]:
        target_model = model or settings.OPENROUTER_MODEL
        payload = {
            "model": target_model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ]
        }

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self.base_url, 
                    headers=self.headers, 
                    json=payload, 
                    timeout=90.0  # Increased to handle complex test suite generation
                )
                response.raise_for_status()
                return response.json()
        except httpx.TimeoutException:
            raise Exception("The AI Engine timed out. This often happens with very long stories. Try a faster model or a shorter description.")
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 402:
                raise Exception("AI Quota Exceeded: Your AI credit limit has been reached. Please check your OpenRouter settings.")
            if e.response.status_code == 429:
                raise Exception("AI Rate Limit: Too many requests at once. Please wait a moment and try again.")
            raise Exception(f"AI Service Error: {e.response.status_code} - {e.response.text}")
        except Exception as e:
            raise Exception(f"AI Connection Failed: {str(e)}")
