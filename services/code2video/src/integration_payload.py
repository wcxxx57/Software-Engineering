"""Translate Zhiying code-video messages into the native Code2Video request."""

from __future__ import annotations

import os
import re
from typing import Any


FENCED_CODE_RE = re.compile(
    r"```(?P<language>[^\r\n`]*)\r?\n(?P<code>.*?)\r?\n```",
    re.DOTALL,
)


def split_problem_and_solution(prompt: str) -> tuple[str, str, str | None]:
    """Split the frontend's ``题目 + fenced code`` prompt without altering code."""

    normalized = prompt.strip()
    if not normalized:
        raise ValueError("code_video prompt is empty")

    matches = list(FENCED_CODE_RE.finditer(normalized))
    if not matches:
        raise ValueError("code_video prompt must contain a fenced solution code block")

    match = matches[-1]
    solution_code = match.group("code")
    if not solution_code.strip():
        raise ValueError("code_video solution code is empty")

    problem_description = (normalized[: match.start()] + normalized[match.end() :]).strip()
    problem_description = re.sub(
        r"(?im)^\s*#{1,6}\s*(题目|题目描述|核心代码|答案|标准答案)\s*$",
        "",
        problem_description,
    ).strip()
    if not problem_description:
        raise ValueError("code_video problem description is empty")

    language_hint = match.group("language").strip() or None
    return problem_description, solution_code, language_hint


def _infer_language(solution_code: str) -> str | None:
    checks = (
        (r"(?m)^\s*#include\s*[<\"]|\bstd::|\bint\s+main\s*\(", "C++"),
        (r"\bpublic\s+(?:final\s+)?class\b|\bstatic\s+void\s+main\s*\(", "Java"),
        (r"(?m)^\s*package\s+main\b|\bfunc\s+\w+\s*\(", "Go"),
        (r"\bfn\s+main\s*\(|\blet\s+mut\b|\bimpl\s+\w+", "Rust"),
        (r"\bfunction\s+\w+\s*\(|\b(?:const|let|var)\s+\w+\s*=|=>", "JavaScript"),
        (r"(?m)^\s*(?:async\s+)?def\s+\w+\s*\(|^\s*class\s+\w+\s*[:(]", "Python"),
    )
    for pattern, language in checks:
        if re.search(pattern, solution_code):
            return language
    return None


def _normalize_language(value: Any, solution_code: str) -> str:
    language = str(
        value or _infer_language(solution_code) or os.getenv("C2V_DEFAULT_LANGUAGE", "Python")
    ).strip()
    return {
        "PY": "Python",
        "PYTHON": "Python",
        "JAVA": "Java",
        "CPP": "C++",
        "C++": "C++",
        "C": "C",
        "JS": "JavaScript",
        "JAVASCRIPT": "JavaScript",
        "TS": "TypeScript",
        "TYPESCRIPT": "TypeScript",
        "GO": "Go",
        "RUST": "Rust",
    }.get(language.upper(), language)


def request_data(message: dict[str, Any]) -> dict[str, Any]:
    task_id = message.get("task_id")
    prompt = str(message.get("prompt") or "")
    if not isinstance(task_id, int) or task_id <= 0:
        raise ValueError("invalid code_video task_id")

    problem_description, solution_code, language_hint = split_problem_and_solution(prompt)
    return {
        "problem_description": problem_description,
        "solution_code": solution_code,
        "age": message.get("age"),
        "gender": message.get("gender"),
        "language": _normalize_language(message.get("language") or language_hint, solution_code),
        "duration": message.get("duration"),
        "render_profile": "1080p30",
        "difficulty": message.get("difficulty")
        or os.getenv("C2V_DEFAULT_DIFFICULTY", "medium"),
        "extra_info": message.get("extra_info"),
        "use_feedback": message.get("use_feedback", True),
        "use_assets": message.get("use_assets", True),
        "api_model": message.get("api_model") or os.getenv("DEFAULT_API", "gpt-5"),
    }
