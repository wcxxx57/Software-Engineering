"""Pure RabbitMQ-to-Knowledge2Video request mapping helpers."""

from __future__ import annotations

import os
from typing import Any


def _mapping(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _non_negative_int(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


def _gender_text(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    normalized = value.strip()
    return {
        "MALE": "男",
        "FEMALE": "女",
    }.get(normalized.upper(), normalized)


def build_profile_text(message: dict[str, Any]) -> str:
    profile = _mapping(message.get("learner_profile"))
    context = _mapping(message.get("learning_context"))
    parts: list[str] = []

    introduction = str(profile.get("introduction") or "").strip()
    if introduction:
        parts.append(f"用户自我介绍：{introduction}")

    experience_points = _non_negative_int(profile.get("experience_points"))
    total_checkins = _non_negative_int(profile.get("total_checkins"))
    streak_checkins = _non_negative_int(profile.get("streak_checkins"))
    if experience_points is not None:
        parts.append(f"平台经验值：{experience_points}（仅作为学习积累的弱信号）")
    if total_checkins is not None or streak_checkins is not None:
        parts.append(
            "学习活跃度：累计打卡 "
            f"{total_checkins or 0} 次，连续打卡 {streak_checkins or 0} 次"
            "（仅作为投入度的弱信号）"
        )

    subject = str(context.get("subject") or "").strip()
    target = str(context.get("target") or message.get("extra_info") or "").strip()
    if subject:
        parts.append(f"当前学习主题：{subject}")
    if target:
        parts.append(f"当前学习目标：{target}")

    total_stages = _non_negative_int(context.get("total_stages"))
    finished_stages = _non_negative_int(context.get("finished_stages"))
    stage_total_tasks = _non_negative_int(context.get("stage_total_tasks"))
    stage_finished_tasks = _non_negative_int(context.get("stage_finished_tasks"))
    if total_stages is not None:
        parts.append(
            f"总体学习进度：已完成 {finished_stages or 0}/{total_stages} 个阶段"
        )
    if stage_total_tasks is not None:
        parts.append(
            "当前阶段进度：已完成 "
            f"{stage_finished_tasks or 0}/{stage_total_tasks} 个任务"
        )

    pretest_total = _non_negative_int(context.get("pretest_total_problems"))
    pretest_answered = _non_negative_int(context.get("pretest_answered_problems"))
    pretest_correct = _non_negative_int(context.get("pretest_correct_problems"))
    if pretest_total:
        parts.append(
            "课前测表现：共 "
            f"{pretest_total} 题，已答 {pretest_answered or 0} 题，"
            f"答对 {pretest_correct or 0} 题"
        )

    task_title = str(context.get("task_title") or "").strip()
    task_description = str(context.get("task_description") or "").strip()
    if task_title:
        parts.append(f"当前任务：{task_title}")
    if task_description:
        parts.append(f"任务说明：{task_description}")

    legacy_extra_info = str(message.get("extra_info") or "").strip()
    if legacy_extra_info and not target:
        parts.append(f"补充信息：{legacy_extra_info}")
    return "\n".join(parts)


def request_data(message: dict[str, Any]) -> dict[str, Any]:
    task_id = message.get("task_id")
    prompt = str(message.get("prompt") or "").strip()
    if not isinstance(task_id, int) or task_id <= 0 or not prompt:
        raise ValueError("invalid knowledge_video message")

    profile = _mapping(message.get("learner_profile"))
    context = _mapping(message.get("learning_context"))
    language = str(
        message.get("language")
        or context.get("language")
        or os.getenv("K2V_DEFAULT_LANGUAGE", "Python")
    )
    language = {
        "PYTHON": "Python",
        "JAVA": "Java",
        "CPP": "C++",
        "GO": "Go",
        "RUST": "Rust",
    }.get(language.upper(), language)

    age = _non_negative_int(profile.get("age"))
    return {
        "knowledge_point": prompt,
        "age": age,
        "gender": _gender_text(profile.get("gender")),
        "language": language,
        "difficulty": message.get("difficulty")
        or os.getenv("K2V_DEFAULT_DIFFICULTY", "medium"),
        "duration": message.get("duration"),
        "render_profile": message.get("render_profile")
        or os.getenv("K2V_RENDER_PROFILE", "1080p30"),
        "extra_info": build_profile_text(message),
        "learner_profile": profile,
        "learning_context": context,
        "use_feedback": True,
        "use_assets": True,
        "api_model": message.get("api_model"),
    }
