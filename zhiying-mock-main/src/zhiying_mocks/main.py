from __future__ import annotations

import asyncio
import signal

import aio_pika

from .config import Settings
from .health import serve as serve_health
from .http_callback import CallbackClient
from .log import configure_logging, get_logger
from .runner import declare_and_consume
from .services import all_services

log = get_logger("main")


async def _main() -> None:
    configure_logging()
    settings = Settings()

    log.info(
        "starting",
        rabbitmq_url=_redact(settings.rabbitmq_url),
        backend=settings.backend_base_url,
        generating_delay_ms=settings.mock_generating_delay_ms,
        finished_delay_ms=settings.mock_finished_delay_ms,
        failure_rate=settings.mock_failure_rate,
    )

    connection = await aio_pika.connect_robust(settings.rabbitmq_url)
    callback = CallbackClient(settings)

    runners = []
    health_server = None
    try:
        for spec in all_services():
            runner = await declare_and_consume(spec, settings, connection, callback)
            runners.append(runner)

        # Only start the health endpoint *after* all consumers are wired up,
        # so a 200 from /health truly means "ready to handle messages".
        health_server = await serve_health(settings.health_host, settings.health_port)

        stop_event = asyncio.Event()
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, stop_event.set)
            except NotImplementedError:
                # Windows fallback — Ctrl+C raises KeyboardInterrupt instead.
                pass

        log.info("ready", services=len(runners), health_port=settings.health_port)
        await stop_event.wait()
        log.info("shutting_down")
    finally:
        if health_server is not None:
            health_server.close()
            await health_server.wait_closed()
        for runner in runners:
            await runner.stop()
        await callback.aclose()
        await connection.close()
        log.info("stopped")


def _redact(url: str) -> str:
    # Drop credentials for log output.
    if "@" in url:
        scheme, rest = url.split("://", 1)
        _, host = rest.rsplit("@", 1)
        return f"{scheme}://***@{host}"
    return url


def run() -> None:
    try:
        asyncio.run(_main())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    run()
