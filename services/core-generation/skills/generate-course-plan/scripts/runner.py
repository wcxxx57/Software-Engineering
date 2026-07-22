"""Runtime helpers for the generate-course-plan skill."""

from __future__ import annotations

import json
from typing import Any


def assemble_plan_prompt(
    skill_instructions: str,
    request: dict[str, Any],
    tasks_per_stage: int,
) -> str:
    return f"""{skill_instructions}

根据用户的学习目标和课前测试结果生成个性化学习计划。
主题：{request['prompt']}
目标：{request['target']}
学习语言：{request['language']}
必须生成恰好 {request['total_stages']} 个阶段。
每个阶段必须包含恰好 {tasks_per_stage} 个可执行任务。
阶段应循序渐进；重点补足答错、未作答或低信心的知识点。
课前测试结果：{json.dumps(request['pretest_results'], ensure_ascii=False)}
学习者画像：{json.dumps(request['learner_profile'], ensure_ascii=False)}
历史学习摘要：{json.dumps(request['learner_history'], ensure_ascii=False)}
权威课程大纲：{json.dumps(request['authoritative_outline'], ensure_ascii=False)}
只返回对象：{{"stages":[{{"title":"...","description":"...","tasks":[{{"title":"...","description":"...","knowledge_node_keys":["..."]}}]}}]}}"""


def validate_plan_payload(
    payload: dict[str, Any],
    valid_node_keys: set[str],
    stage_count: int,
    tasks_per_stage: int,
) -> None:
    stages = payload.get("stages", [])
    if len(stages) != stage_count:
        raise ValueError(f"expected {stage_count} stages, got {len(stages)}")
    for stage in stages:
        tasks = stage.get("tasks", [])
        if len(tasks) != tasks_per_stage:
            raise ValueError("unexpected number of tasks in a stage")
        for task in tasks:
            keys = task.get("knowledge_node_keys", [])
            if not keys or any(key not in valid_node_keys for key in keys):
                raise ValueError("task references an unknown curriculum node")
