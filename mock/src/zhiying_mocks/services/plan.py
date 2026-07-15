from __future__ import annotations

from pydantic import BaseModel

from ..config import Settings
from . import ServiceSpec


class PretestResult(BaseModel):
    problem_id: int
    content: str
    choice_a: str
    choice_b: str
    choice_c: str
    choice_d: str
    answer: str
    chosen_answer: str | None = None
    confidence: str | None = None


class GenerateRequest(BaseModel):
    task_id: int
    prompt: str
    total_stages: int
    language: str
    target: str
    pretest_results: list[PretestResult]


def build_finished(req: BaseModel, settings: Settings) -> dict:
    assert isinstance(req, GenerateRequest)
    tasks_per_stage = max(1, settings.mock_plan_tasks_per_stage)
    stages = []
    for si in range(req.total_stages):
        tasks = [
            {
                "title": f"任务 {si + 1}.{ti + 1}：{req.prompt} 第 {si + 1} 阶段任务 {ti + 1}",
                "description": (
                    f"[mock] 围绕「{req.prompt}」第 {si + 1} 阶段的第 {ti + 1} 个学习任务，"
                    f"目标语言 {req.language}，整体目标：{req.target}。"
                ),
            }
            for ti in range(tasks_per_stage)
        ]
        stages.append(
            {
                "title": f"第 {si + 1} 阶段：{req.prompt} 进阶 {si + 1}",
                "description": (
                    f"[mock] 第 {si + 1} 阶段的学习目标，覆盖 {tasks_per_stage} 个任务。"
                ),
                "tasks": tasks,
            }
        )
    return {
        "status": "FINISHED",
        "stages": stages,
    }


SPEC = ServiceSpec(
    name="plan",
    exchange="zhiying.plan",
    queue="zhiying.plan.generate",
    routing_key="generate",
    callback_method="POST",
    callback_path_template="/internal/study-subjects/{task_id}",
    api_key_attr="plan_api_key",
    request_model=GenerateRequest,
    build_finished_payload=build_finished,
)
