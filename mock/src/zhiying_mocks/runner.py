from __future__ import annotations

import asyncio
import json
import random

import aio_pika
from aio_pika.abc import AbstractIncomingMessage
from pydantic import ValidationError

from .config import Settings
from .http_callback import CallbackClient
from .log import get_logger
from .services import ServiceSpec

log = get_logger("runner")


class ServiceRunner:
    def __init__(
        self,
        spec: ServiceSpec,
        settings: Settings,
        callback: CallbackClient,
    ) -> None:
        self.spec = spec
        self.settings = settings
        self.callback = callback
        self._inflight: set[asyncio.Task[None]] = set()

    async def on_message(self, message: AbstractIncomingMessage) -> None:
        # ack immediately — mocks do not retry, and we don't want poison loops.
        async with message.process(requeue=False, ignore_processed=True):
            try:
                body = json.loads(message.body.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                log.warning(
                    "decode_failed",
                    service=self.spec.name,
                    error=str(exc),
                    raw=message.body[:200],
                )
                return

            try:
                req = self.spec.request_model.model_validate(body)
            except ValidationError as exc:
                log.warning(
                    "schema_invalid",
                    service=self.spec.name,
                    body=body,
                    errors=exc.errors(),
                )
                return

            task_id = req.task_id  # type: ignore[attr-defined]
            log.info("received", service=self.spec.name, task_id=task_id)

            task = asyncio.create_task(self._handle(req, task_id))
            self._inflight.add(task)
            task.add_done_callback(self._inflight.discard)

    async def _handle(self, req, task_id: int) -> None:
        gen_delay = self.settings.generating_delay_ms(self.spec.name) / 1000.0
        fin_delay = self.settings.finished_delay_ms(self.spec.name) / 1000.0
        failure_rate = self.settings.failure_rate(self.spec.name)
        api_key = self.spec.api_key(self.settings)
        path = self.spec.callback_path(task_id)

        await asyncio.sleep(gen_delay)
        await self.callback.send(
            method=self.spec.callback_method,
            path=path,
            api_key=api_key,
            json={"status": "GENERATING"},
            service=self.spec.name,
            task_id=task_id,
        )

        await asyncio.sleep(fin_delay)
        if random.random() < failure_rate:
            payload: dict = {"status": "FAILED"}
        else:
            payload = self.spec.build_finished_payload(req, self.settings)

        await self.callback.send(
            method=self.spec.callback_method,
            path=path,
            api_key=api_key,
            json=payload,
            service=self.spec.name,
            task_id=task_id,
        )

    async def stop(self) -> None:
        if not self._inflight:
            return
        log.info("waiting_inflight", service=self.spec.name, count=len(self._inflight))
        await asyncio.gather(*self._inflight, return_exceptions=True)


async def declare_and_consume(
    spec: ServiceSpec,
    settings: Settings,
    connection: aio_pika.abc.AbstractRobustConnection,
    callback: CallbackClient,
) -> ServiceRunner:
    channel = await connection.channel()
    await channel.set_qos(prefetch_count=settings.mock_prefetch)

    exchange = await channel.declare_exchange(
        spec.exchange,
        aio_pika.ExchangeType.DIRECT,
        durable=True,
    )
    queue = await channel.declare_queue(spec.queue, durable=True)
    await queue.bind(exchange, routing_key=spec.routing_key)

    runner = ServiceRunner(spec, settings, callback)
    await queue.consume(runner.on_message)
    log.info(
        "consuming",
        service=spec.name,
        exchange=spec.exchange,
        queue=spec.queue,
        routing_key=spec.routing_key,
    )
    return runner
