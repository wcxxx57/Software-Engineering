from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlparse

import httpx


@dataclass(frozen=True)
class SearchCandidate:
    url: str
    title: str
    content: str


class WebSearchProvider(Protocol):
    async def search(
        self,
        query: str,
        *,
        include_domains: list[str],
        max_results: int,
        timeout_s: float,
    ) -> list[SearchCandidate]: ...


class TavilyWebSearchProvider:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key

    async def search(
        self,
        query: str,
        *,
        include_domains: list[str],
        max_results: int,
        timeout_s: float,
    ) -> list[SearchCandidate]:
        async with httpx.AsyncClient(timeout=timeout_s, follow_redirects=False) as http:
            response = await http.post(
                "https://api.tavily.com/search",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "query": query,
                    "include_domains": include_domains,
                    "max_results": max_results,
                    "include_raw_content": "markdown",
                    "include_answer": False,
                    "include_images": False,
                },
            )
            response.raise_for_status()
            payload = response.json()

        candidates = []
        for item in payload.get("results", [])[:max_results]:
            url = str(item.get("url") or "")
            content = str(item.get("raw_content") or item.get("content") or "")[:30_000]
            parsed = urlparse(url)
            host = (parsed.hostname or "").lower()
            allowed = any(
                host == domain or host.endswith(f".{domain}") for domain in include_domains
            )
            if parsed.scheme == "https" and allowed and content:
                candidates.append(
                    SearchCandidate(
                        url=url,
                        title=str(item.get("title") or ""),
                        content=content,
                    )
                )
        return candidates
