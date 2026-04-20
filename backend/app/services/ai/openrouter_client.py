import asyncio
import logging
from typing import Dict, Any, Optional

import httpx
from fastapi import HTTPException

from app.core.config import settings


logger = logging.getLogger(__name__)

class OpenRouterClient:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = (api_key or settings.OPENROUTER_API_KEY or "").strip()
        self.base_url = "https://openrouter.ai/api/v1/chat/completions"
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://bugmind.ai",
            "X-Title": "BugMind AI Platform"
        }
        self.timeout = httpx.Timeout(
            connect=settings.OPENROUTER_CONNECT_TIMEOUT_SECONDS,
            read=settings.OPENROUTER_READ_TIMEOUT_SECONDS,
            write=settings.OPENROUTER_WRITE_TIMEOUT_SECONDS,
            pool=settings.OPENROUTER_POOL_TIMEOUT_SECONDS,
        )

    async def generate_completion(self, system_prompt: str, user_prompt: str, model: str = None) -> Dict[str, Any]:
        if not self.api_key:
            raise HTTPException(
                status_code=503,
                detail="AI Service is not configured. Set OPENROUTER_API_KEY or a custom AI key before generating content."
            )

        target_model = model or settings.OPENROUTER_MODEL
        fallback_model = settings.OPENROUTER_MODEL
        attempted_models = [target_model]
        if fallback_model and fallback_model != target_model:
            attempted_models.append(fallback_model)

        attempts = max(settings.OPENROUTER_RETRIES, 1)
        last_timeout: Optional[httpx.TimeoutException] = None
        last_transport_error: Optional[httpx.TransportError] = None

        async with httpx.AsyncClient(trust_env=False, timeout=self.timeout) as client:
            for model_index, candidate_model in enumerate(attempted_models):
                for attempt in range(1, attempts + 1):
                    payload = {
                        "model": candidate_model,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt}
                        ],
                        "max_tokens": settings.OPENROUTER_MAX_TOKENS,
                    }

                    try:
                        response = await client.post(
                            self.base_url,
                            headers=self.headers,
                            json=payload,
                        )
                        response.raise_for_status()
                        return response.json()
                    except httpx.TimeoutException as exc:
                        last_timeout = exc
                        logger.warning(
                            "OpenRouter timeout on model=%s attempt=%s/%s",
                            candidate_model,
                            attempt,
                            attempts,
                        )
                        if attempt < attempts:
                            await asyncio.sleep(min(1.5, 0.5 * attempt))
                            continue
                        break
                    except httpx.HTTPStatusError as exc:
                        status_code = exc.response.status_code
                        if status_code == 402:
                            raise HTTPException(
                                status_code=402,
                                detail="AI Quota Exceeded: Your AI credit limit has been reached. Please check your OpenRouter settings."
                            )
                        if status_code == 429:
                            raise HTTPException(
                                status_code=429,
                                detail="AI Rate Limit: Too many requests at once. Please wait a moment and try again."
                            )
                        if status_code in {502, 503, 504} and attempt < attempts:
                            logger.warning(
                                "OpenRouter transient upstream error status=%s model=%s attempt=%s/%s",
                                status_code,
                                candidate_model,
                                attempt,
                                attempts,
                            )
                            await asyncio.sleep(min(1.5, 0.5 * attempt))
                            continue
                        raise HTTPException(
                            status_code=502,
                            detail=f"AI Service Error: upstream provider returned {status_code}"
                        )
                    except httpx.TransportError as exc:
                        last_transport_error = exc
                        logger.warning(
                            "OpenRouter transport error on model=%s attempt=%s/%s: %s",
                            candidate_model,
                            attempt,
                            attempts,
                            exc.__class__.__name__,
                        )
                        if attempt < attempts:
                            await asyncio.sleep(min(1.5, 0.5 * attempt))
                            continue
                        break

                if model_index < len(attempted_models) - 1:
                    logger.warning(
                        "Switching OpenRouter generation from model=%s to fallback model=%s after repeated transient failures",
                        candidate_model,
                        attempted_models[model_index + 1],
                    )

        if last_timeout is not None:
            raise HTTPException(
                status_code=504,
                detail="The AI Engine timed out. Try again, use a shorter description, or switch to a faster model."
            )

        if last_transport_error is not None:
            raise HTTPException(status_code=502, detail="AI Connection Failed")

        raise HTTPException(status_code=502, detail="AI Service Error")
