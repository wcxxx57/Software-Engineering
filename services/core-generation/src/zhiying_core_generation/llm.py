from __future__ import annotations

import asyncio
import json
import re

import httpx
from pydantic import BaseModel, ValidationError

from .config import Settings


class LlmError(RuntimeError):
    pass


class LlmClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.client = httpx.AsyncClient(timeout=settings.llm_timeout_s)

    async def close(self) -> None:
        await self.client.aclose()

    async def generate(
        self,
        *,
        system: str,
        user: str,
        schema: type[BaseModel],
        model: str | None = None,
    ) -> BaseModel:
        endpoint = f"{self.settings.llm_base_url.rstrip('/')}/chat/completions"
        request = {
            "model": model or self.settings.llm_model,
            "temperature": self.settings.llm_temperature,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        last_error: Exception | None = None
        for attempt in range(1, self.settings.llm_max_retries + 1):
            try:
                response = await self.client.post(
                    endpoint,
                    headers={
                        "Authorization": f"Bearer {self.settings.llm_api_key}",
                        "Content-Type": "application/json",
                    },
                    json=request,
                )
                response.raise_for_status()
                body = response.json()
                content = body["choices"][0]["message"]["content"]
                parsed = json.loads(_strip_code_fence(content))
                return schema.model_validate(parsed)
            except (
                httpx.HTTPError,
                KeyError,
                IndexError,
                TypeError,
                json.JSONDecodeError,
                ValidationError,
            ) as exc:
                last_error = exc
                if attempt < self.settings.llm_max_retries:
                    await asyncio.sleep(min(2 ** (attempt - 1), 8))
        raise LlmError(f"LLM generation failed after retries: {last_error}")


def _strip_code_fence(value: str) -> str:
    value = value.strip()
    match = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", value, flags=re.DOTALL | re.IGNORECASE)
    return match.group(1) if match else value
