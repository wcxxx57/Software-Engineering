from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import aio_pika
from aio_pika.abc import AbstractIncomingMessage, AbstractRobustConnection
from pydantic import BaseModel, ValidationError

from .callback import CallbackClient
from .config import Settings
from .llm import LlmClient
from .models import KnowledgeExplanationRequest, PlanRequest, PretestRequest, QuizRequest

log = logging.getLogger(__name__)
Generator = Callable[[LlmClient, Settings, BaseModel], Awaitable[dict]]


@dataclass(frozen=True)
class WorkerSpec:
    name: str
    exchange: str
    queue: str
    request_model: type[BaseModel]
    callback_method: str
    callback_path: str
    api_key_attr: str
    generator: Generator


async def start_worker(
    connection: AbstractRobustConnection,
    settings: Settings,
    llm: LlmClient,
    callbacks: CallbackClient,
    spec: WorkerSpec,
) -> aio_pika.abc.AbstractChannel:
    channel = await connection.channel()
    await channel.set_qos(prefetch_count=settings.worker_prefetch)
    exchange = await channel.declare_exchange(
        spec.exchange, aio_pika.ExchangeType.DIRECT, durable=True
    )
    queue = await channel.declare_queue(spec.queue, durable=True)
    await queue.bind(exchange, routing_key="generate")

    async def consume(message: AbstractIncomingMessage) -> None:
        async with message.process(requeue=False):
            task_id: int | None = None
            try:
                raw = json.loads(message.body.decode("utf-8"))
                request = spec.request_model.model_validate(raw)
                task_id = request.task_id  # type: ignore[attr-defined]
                path = spec.callback_path.format(task_id=task_id)
                key = getattr(settings, spec.api_key_attr)
                await callbacks.send(
                    method=spec.callback_method,
                    path=path,
                    api_key=key,
                    payload={"status": "GENERATING"},
                )
                result = await spec.generator(llm, settings, request)
                await callbacks.send(
                    method=spec.callback_method,
                    path=path,
                    api_key=key,
                    payload=result,
                )
                log.info("task finished service=%s task_id=%s", spec.name, task_id)
            except (UnicodeDecodeError, json.JSONDecodeError, ValidationError) as exc:
                log.error("invalid message service=%s error=%s", spec.name, exc)
            except Exception:
                log.exception("task failed service=%s task_id=%s", spec.name, task_id)
                if task_id is not None:
                    try:
                        await callbacks.send(
                            method=spec.callback_method,
                            path=spec.callback_path.format(task_id=task_id),
                            api_key=getattr(settings, spec.api_key_attr),
                            payload={"status": "FAILED"},
                        )
                    except Exception:
                        log.exception(
                            "failed to report FAILED service=%s task_id=%s", spec.name, task_id
                        )

    await queue.consume(consume)
    log.info("consumer ready service=%s queue=%s", spec.name, spec.queue)
    return channel


def specs() -> list[WorkerSpec]:
    from .generators import (
        generate_knowledge_explanation,
        generate_plan,
        generate_pretest,
        generate_quiz,
    )

    return [
        WorkerSpec(
            name="pretest",
            exchange="zhiying.pretest",
            queue="zhiying.pretest.generate",
            request_model=PretestRequest,
            callback_method="POST",
            callback_path="/internal/study-subjects/{task_id}",
            api_key_attr="pretest_api_key",
            generator=generate_pretest,
        ),
        WorkerSpec(
            name="plan",
            exchange="zhiying.plan",
            queue="zhiying.plan.generate",
            request_model=PlanRequest,
            callback_method="POST",
            callback_path="/internal/study-subjects/{task_id}",
            api_key_attr="plan_api_key",
            generator=generate_plan,
        ),
        WorkerSpec(
            name="quiz",
            exchange="zhiying.quiz",
            queue="zhiying.quiz.generate",
            request_model=QuizRequest,
            callback_method="POST",
            callback_path="/internal/study-quizzes/{task_id}",
            api_key_attr="quiz_api_key",
            generator=generate_quiz,
        ),
        WorkerSpec(
            name="knowledge_explanation",
            exchange="zhiying.knowledge_explanation",
            queue="zhiying.knowledge_explanation.generate",
            request_model=KnowledgeExplanationRequest,
            callback_method="PATCH",
            callback_path="/internal/knowledge-explanations/{task_id}",
            api_key_attr="knowledge_explanation_api_key",
            generator=generate_knowledge_explanation,
        ),
    ]
