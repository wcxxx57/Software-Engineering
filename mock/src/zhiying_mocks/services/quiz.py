from __future__ import annotations

from pydantic import BaseModel

from ..config import Settings
from . import ServiceSpec
from ._problems import make_problem


class GenerateRequest(BaseModel):
    task_id: int
    prompt: str


def build_finished(req: BaseModel, settings: Settings) -> dict:
    assert isinstance(req, GenerateRequest)
    count = settings.mock_quiz_problem_count
    problems = [make_problem(i, req.prompt) for i in range(count)]
    return {
        "status": "FINISHED",
        "problems": problems,
    }


SPEC = ServiceSpec(
    name="quiz",
    exchange="zhiying.quiz",
    queue="zhiying.quiz.generate",
    routing_key="generate",
    callback_method="POST",
    callback_path_template="/internal/study-quizzes/{task_id}",
    api_key_attr="quiz_api_key",
    request_model=GenerateRequest,
    build_finished_payload=build_finished,
)
