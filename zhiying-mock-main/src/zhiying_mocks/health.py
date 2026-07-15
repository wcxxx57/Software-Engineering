"""Minimal stdlib HTTP server exposing a single /health endpoint.

Using stdlib asyncio rather than pulling in aiohttp/starlette: mocks only
needs to answer 200 OK once consumers are wired up, so readiness is signalled
by simply starting the server *after* all queue subscriptions are live.
"""

from __future__ import annotations

import asyncio


async def _handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        # Read just the request line + headers; we don't care about the body.
        await reader.readuntil(b"\r\n\r\n")
    except (asyncio.IncompleteReadError, ConnectionError):
        writer.close()
        return

    body = b'{"status":"ok"}'
    response = (
        b"HTTP/1.1 200 OK\r\n"
        b"content-type: application/json\r\n"
        b"content-length: " + str(len(body)).encode() + b"\r\n"
        b"connection: close\r\n"
        b"\r\n"
    ) + body
    writer.write(response)
    try:
        await writer.drain()
    finally:
        writer.close()


async def serve(host: str, port: int) -> asyncio.base_events.Server:
    return await asyncio.start_server(_handle, host=host, port=port)
