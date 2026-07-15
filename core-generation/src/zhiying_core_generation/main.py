from __future__ import annotations

import asyncio
import json
import logging
import signal

import aio_pika

from .callback import CallbackClient
from .config import Settings
from .llm import LlmClient
from .worker import specs, start_worker


async def health_handler(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        await reader.read(4096)
        body = json.dumps({"status": "ok"}).encode()
        writer.write(
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "
            + str(len(body)).encode()
            + b"\r\nConnection: close\r\n\r\n"
            + body
        )
        await writer.drain()
    finally:
        writer.close()
        await writer.wait_closed()


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = Settings()
    connection = await aio_pika.connect_robust(settings.rabbitmq_url)
    llm = LlmClient(settings)
    callbacks = CallbackClient(settings)
    channels = []
    health_server = None
    try:
        for spec in specs():
            channels.append(await start_worker(connection, settings, llm, callbacks, spec))
        health_server = await asyncio.start_server(
            health_handler, settings.health_host, settings.health_port
        )
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, stop.set)
            except NotImplementedError:
                pass
        logging.info("core generation service ready workers=%s", len(channels))
        await stop.wait()
    finally:
        if health_server is not None:
            health_server.close()
            await health_server.wait_closed()
        for channel in channels:
            await channel.close()
        await callbacks.close()
        await llm.close()
        await connection.close()


def run() -> None:
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
