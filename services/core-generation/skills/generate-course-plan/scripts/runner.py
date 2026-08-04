"""Runtime helpers for the curriculum-backed course-plan skill."""

from __future__ import annotations

import json
from typing import Any


def assemble_plan_prompt(
    skill_instructions: str,
    request: dict[str, Any],
    _tasks_per_stage: int,
) -> str:
    return f"""{skill_instructions}

Create exactly {request['total_stages']} stages from the authoritative outline.
Tasks per stage may vary according to the learner's pretest and history. A stage may be empty when all of its outline nodes are already mastered; the backend will create a fixed-node review task for that stage.
Each task must reference exactly one outline node via knowledge_node_key. Do not invent a task title: the backend uses the canonical outline title.
day_index is a positive logical learning day and may vary by learner.
Topic: {request['prompt']}
Goal: {request['target']}
Language: {request['language']}
Pretest: {json.dumps(request['pretest_results'], ensure_ascii=False)}
Learner profile: {json.dumps(request['learner_profile'], ensure_ascii=False)}
History: {json.dumps(request['learner_history'], ensure_ascii=False)}
Authoritative outline (权威课程大纲): {json.dumps(request['authoritative_outline'], ensure_ascii=False)}
Return only JSON: {{"stages":[{{"title":"...","description":"...","tasks":[{{"description":"...","knowledge_node_key":"...","day_index":1}}]}}]}}"""


def validate_plan_payload(
    payload: dict[str, Any], valid_node_keys: set[str], stage_count: int
) -> None:
    stages = payload.get("stages", [])
    if len(stages) != stage_count:
        raise ValueError(f"expected {stage_count} stages, got {len(stages)}")
    for stage in stages:
        tasks = stage.get("tasks", [])
        for task in tasks:
            if task.get("knowledge_node_key") not in valid_node_keys:
                raise ValueError("task references an unknown curriculum node")
            if not isinstance(task.get("day_index"), int) or task["day_index"] < 1:
                raise ValueError("task day_index must be positive")
