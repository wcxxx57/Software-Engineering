from __future__ import annotations

from pydantic import BaseModel

from ..config import Settings
from . import ServiceSpec
from ._problems import make_problem


class GenerateRequest(BaseModel):
    task_id: int
    prompt: str
    total_stages: int
    language: str
    target: str


def build_finished(req: BaseModel, settings: Settings) -> dict:
    assert isinstance(req, GenerateRequest)
    count = settings.mock_pretest_problem_count
    problems = [make_problem(i, req.prompt) for i in range(count)]
    return {
        "status": "FINISHED",
        "problems": problems,
    }


SPEC = ServiceSpec(
    name="pretest",
    exchange="zhiying.pretest",
    queue="zhiying.pretest.generate",
    routing_key="generate",
    callback_method="POST",
    callback_path_template="/internal/study-subjects/{task_id}",
    api_key_attr="pretest_api_key",
    request_model=GenerateRequest,
    build_finished_payload=build_finished,
)
