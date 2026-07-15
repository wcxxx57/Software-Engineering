"""Service registry: contract metadata + payload builders for the seven mocks."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel

from ..config import Settings

CallbackMethod = Literal["PATCH", "POST"]
PayloadBuilder = Callable[[BaseModel, Settings], dict]


@dataclass(frozen=True)
class ServiceSpec:
    name: str
    exchange: str
    queue: str
    routing_key: str
    callback_method: CallbackMethod
    callback_path_template: str  # e.g. "/internal/knowledge-videos/{task_id}"
    api_key_attr: str  # attribute name on Settings, e.g. "knowledge_video_api_key"
    request_model: type[BaseModel]
    build_finished_payload: PayloadBuilder

    def callback_path(self, task_id: int) -> str:
        return self.callback_path_template.format(task_id=task_id)

    def api_key(self, settings: Settings) -> str:
        return getattr(settings, self.api_key_attr)


def all_services() -> list[ServiceSpec]:
    from . import (
        code_video,
        interactive_html,
        knowledge_explanation,
        knowledge_video,
        plan,
        pretest,
        quiz,
    )

    return [
        knowledge_video.SPEC,
        code_video.SPEC,
        interactive_html.SPEC,
        knowledge_explanation.SPEC,
        pretest.SPEC,
        plan.SPEC,
        quiz.SPEC,
    ]


__all__ = ["ServiceSpec", "all_services"]
