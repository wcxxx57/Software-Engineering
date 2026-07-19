from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Literal

from .config import Settings
from .llm import LlmClient
from .models import (
    ExplanationSizingPayload,
    KnowledgeExplanationRequest,
    PretestRequest,
    PretestSizingPayload,
)

AdaptiveSource = Literal["ai", "fallback"]


@dataclass(frozen=True)
class PretestSizingDecision:
    problem_count: int
    source: AdaptiveSource
    reason: str


@dataclass(frozen=True)
class ExplanationSizingDecision:
    target_chars: int
    detail_level: Literal["concise", "standard", "deep"]
    source: AdaptiveSource
    reason: str


def _json(value: object) -> str:
    if hasattr(value, "model_dump"):
        value = value.model_dump()  # type: ignore[union-attr]
    return json.dumps(value, ensure_ascii=False)


async def select_pretest_problem_count(
    client: LlmClient,
    settings: Settings,
    request: PretestRequest,
) -> PretestSizingDecision:
    minimum = settings.pretest_problem_count_min
    maximum = settings.pretest_problem_count_max
    fallback = settings.pretest_problem_count
    prompt = f"""你是课前诊断测评的长度规划员。请根据学习者画像和知识点范围，决定本次课前小测题数。

知识点：{request.prompt}
学习目标：{request.target or "未说明"}
学习语言：{request.language}
计划阶段数：{request.total_stages}
学习者画像：{_json(request.learner_profile)}

约束：
- 只能选择 {minimum} 到 {maximum} 之间的整数题数。
- 基础薄弱、目标跨度大、知识点包含多个子概念时增加题数，以覆盖概念理解、辨析和应用。
- 基础较好、目标聚焦、知识点单一时减少题数，避免重复测试。
- 经验值和打卡数据只能作为弱信号，必须结合自我介绍、学习目标和知识点复杂度判断。
- 题数应足以形成可靠诊断，但不得为了达到上限而堆叠同质题。

只返回 JSON：{{"problem_count": 整数, "reason": "一句中文理由"}}"""
    try:
        result = await client.generate(
            system="你是严谨的自适应教育测评规划专家。只返回合法 JSON。",
            user=prompt,
            schema=PretestSizingPayload,
        )
        assert isinstance(result, PretestSizingPayload)
        if minimum <= result.problem_count <= maximum:
            return PretestSizingDecision(result.problem_count, "ai", result.reason)
    except Exception:
        pass
    return PretestSizingDecision(fallback, "fallback", "AI 题数规划不可用，使用配置兜底值")


async def select_explanation_length(
    client: LlmClient,
    settings: Settings,
    request: KnowledgeExplanationRequest,
) -> ExplanationSizingDecision:
    minimum = settings.explanation_target_chars_min
    maximum = settings.explanation_target_chars_max
    fallback = settings.explanation_target_chars
    context = request.learning_context.model_dump() if request.learning_context else {}
    prompt = f"""你是中文教学材料的篇幅规划员。
请根据学习者画像、当前学习进度和知识点复杂度，决定文字讲解的目标长度。

知识点或任务：{request.prompt}
学习上下文：{_json(context)}
学习者画像：{_json(request.learner_profile)}

约束：
- target_chars 只能选择 {minimum} 到 {maximum} 之间的整数，表示 Markdown 正文的目标中文字符数。
- 基础薄弱、知识点抽象、前置概念多或需要推导/代码追踪时，选择更长、更深入的讲解。
- 基础较好、进度靠后、任务单一明确时，选择更短、更聚焦的讲解。
- 不能通过重复表述、无关背景或冗余示例填充篇幅。
- detail_level 只能是 concise、standard、deep 之一。
- 经验值和打卡数据只能作为弱信号。

只返回 JSON：
{{"target_chars": 整数, "detail_level": "concise|standard|deep",
  "reason": "一句中文理由"}}"""
    try:
        result = await client.generate(
            system="你是严谨的自适应教学内容规划专家。只返回合法 JSON。",
            user=prompt,
            schema=ExplanationSizingPayload,
        )
        assert isinstance(result, ExplanationSizingPayload)
        if minimum <= result.target_chars <= maximum:
            return ExplanationSizingDecision(
                result.target_chars,
                result.detail_level,
                "ai",
                result.reason,
            )
    except Exception:
        pass
    return ExplanationSizingDecision(
        fallback,
        "standard",
        "fallback",
        "AI 篇幅规划不可用，使用配置兜底值",
    )
