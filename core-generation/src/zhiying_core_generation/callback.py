from __future__ import annotations

import asyncio

import httpx

from .config import Settings


class CallbackClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.client = httpx.AsyncClient(timeout=settings.callback_timeout_s)

    async def close(self) -> None:
        await self.client.aclose()

    async def send(self, *, method: str, path: str, api_key: str, payload: dict) -> None:
        url = f"{self.settings.backend_base_url.rstrip('/')}{path}"
        last_error: Exception | None = None
        for attempt in range(1, self.settings.callback_max_retries + 1):
            try:
                response = await self.client.request(
                    method,
                    url,
                    headers={"Authorization": f"Bearer {api_key}"},
                    json=payload,
                )
                response.raise_for_status()
                return
            except httpx.HTTPError as exc:
                last_error = exc
                if attempt < self.settings.callback_max_retries:
                    await asyncio.sleep(min(2 ** (attempt - 1), 8))
        raise RuntimeError(f"backend callback failed after retries: {last_error}")
