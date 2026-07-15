from __future__ import annotations

from pydantic import BaseModel

from ..config import Settings
from . import ServiceSpec


class GenerateRequest(BaseModel):
    task_id: int
    prompt: str


def build_finished(req: BaseModel, settings: Settings) -> dict:
    assert isinstance(req, GenerateRequest)
    return {
        "status": "FINISHED",
        "object_key": settings.mock_code_video_object_key,
    }


SPEC = ServiceSpec(
    name="code_video",
    exchange="zhiying.code_video",
    queue="zhiying.code_video.generate",
    routing_key="generate",
    callback_method="PATCH",
    callback_path_template="/internal/code-videos/{task_id}",
    api_key_attr="code_video_api_key",
    request_model=GenerateRequest,
    build_finished_payload=build_finished,
)
