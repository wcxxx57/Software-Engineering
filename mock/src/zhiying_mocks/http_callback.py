from __future__ import annotations

import httpx

from .config import Settings
from .log import get_logger

log = get_logger("http_callback")


class CallbackClient:
    """Thin wrapper around httpx.AsyncClient that adds the bearer header."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = httpx.AsyncClient(
            base_url=settings.backend_base_url,
            timeout=settings.callback_timeout_s,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def send(
        self,
        *,
        method: str,
        path: str,
        api_key: str,
        json: dict,
        service: str,
        task_id: int,
    ) -> None:
        try:
            response = await self._client.request(
                method,
                path,
                json=json,
                headers={"Authorization": f"Bearer {api_key}"},
            )
        except httpx.HTTPError as exc:
            log.error(
                "callback_failed",
                service=service,
                task_id=task_id,
                method=method,
                path=path,
                error=str(exc),
            )
            return

        if response.status_code >= 400:
            log.warning(
                "callback_non_2xx",
                service=service,
                task_id=task_id,
                method=method,
                path=path,
                status=response.status_code,
                body=_truncate(response.text),
            )
        else:
            log.info(
                "callback_ok",
                service=service,
                task_id=task_id,
                method=method,
                path=path,
                status=response.status_code,
                payload_status=json.get("status"),
            )


def _truncate(text: str, limit: int = 500) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + "..."
