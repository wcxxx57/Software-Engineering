from __future__ import annotations

import json

from .config import Settings
from .llm import LlmClient, LlmError
from .models import (
    ExplanationPayload,
    KnowledgeExplanationRequest,
    PlanPayload,
    PlanRequest,
    PretestRequest,
    ProblemsPayload,
    QuizRequest,
)

PROBLEM_SYSTEM = """你是严谨的中文教育测评专家。只返回合法 JSON，不要返回 Markdown。
每道题必须有四个互不相同的选项，answer 只能为 A、B、C、D，explanation 要说明答案理由。
题目必须围绕用户主题，避免歧义、冷僻事实和无法验证的答案。"""


async def generate_pretest(client: LlmClient, settings: Settings, request: PretestRequest) -> dict:
    user = f"""为以下学习目标生成 {settings.pretest_problem_count} 道课前诊断选择题。
主题：{request.prompt}
目标：{request.target}
学习语言：{request.language}
计划阶段数：{request.total_stages}
覆盖从基础概念到应用能力的不同层级。
返回对象格式：{{"problems":[{{"content":"...","choice_a":"...","choice_b":"...","choice_c":"...","choice_d":"...","answer":"A","explanation":"..."}}]}}"""
    result = await client.generate(system=PROBLEM_SYSTEM, user=user, schema=ProblemsPayload)
    assert isinstance(result, ProblemsPayload)
    if len(result.problems) != settings.pretest_problem_count:
        actual_count = len(result.problems)
        raise LlmError(
            f"pretest expected {settings.pretest_problem_count} problems, got {actual_count}"
        )
    return {"status": "FINISHED", "problems": [p.model_dump() for p in result.problems]}


async def generate_plan(client: LlmClient, settings: Settings, request: PlanRequest) -> dict:
    results = [result.model_dump() for result in request.pretest_results]
    user = f"""根据用户的学习目标和课前测试结果生成个性化学习计划。
主题：{request.prompt}
目标：{request.target}
学习语言：{request.language}
必须生成恰好 {request.total_stages} 个阶段。
每个阶段必须包含恰好 {settings.plan_tasks_per_stage} 个可执行任务。
阶段应循序渐进；重点补足答错、未作答或低信心的知识点。
课前测试结果：{json.dumps(results, ensure_ascii=False)}
只返回对象：{{"stages":[{{"title":"...","description":"...","tasks":[{{"title":"...","description":"..."}}]}}]}}"""
    result = await client.generate(
        system="你是个性化学习路径设计专家。只返回合法 JSON，不要返回 Markdown。",
        user=user,
        schema=PlanPayload,
    )
    assert isinstance(result, PlanPayload)
    if len(result.stages) != request.total_stages:
        raise LlmError(f"plan expected {request.total_stages} stages, got {len(result.stages)}")
    if any(len(stage.tasks) != settings.plan_tasks_per_stage for stage in result.stages):
        raise LlmError("plan returned an unexpected number of tasks in a stage")
    return {"status": "FINISHED", "stages": [s.model_dump() for s in result.stages]}


async def generate_quiz(client: LlmClient, settings: Settings, request: QuizRequest) -> dict:
    user = f"""围绕以下学习任务生成 {settings.quiz_problem_count} 道课后检验选择题：
{request.prompt}
题目应检验理解与应用，避免简单复述。
返回对象格式：{{"problems":[{{"content":"...","choice_a":"...","choice_b":"...","choice_c":"...","choice_d":"...","answer":"A","explanation":"..."}}]}}"""
    result = await client.generate(system=PROBLEM_SYSTEM, user=user, schema=ProblemsPayload)
    assert isinstance(result, ProblemsPayload)
    if len(result.problems) != settings.quiz_problem_count:
        raise LlmError(
            f"quiz expected {settings.quiz_problem_count} problems, got {len(result.problems)}"
        )
    return {"status": "FINISHED", "problems": [p.model_dump() for p in result.problems]}


async def generate_knowledge_explanation(
    client: LlmClient,
    settings: Settings,
    request: KnowledgeExplanationRequest,
) -> dict:
    user = f"""为以下学习任务编写一份可直接展示给学生的深度解析：
{request.prompt}

内容必须使用 Markdown，并至少包含：
1. 概述：解释本任务解决什么问题；
2. 核心概念：分点解释必要知识；
3. 逐步讲解：从基础到应用给出清晰步骤；
4. 示例：结合具体代码或场景；
5. 常见错误：列出易错点和纠正方法；
6. 实践建议：给出学生可以立即完成的练习；
7. 小结：总结关键结论。

语言清晰、准确、面向初学者。代码必须放在 Markdown 代码块中。
返回 JSON 对象：{{"content":"完整 Markdown 内容"}}"""
    result = await client.generate(
        system="你是严谨的编程教育专家。只返回合法 JSON，不要在 JSON 外输出内容。",
        user=user,
        schema=ExplanationPayload,
    )
    assert isinstance(result, ExplanationPayload)
    return {"status": "FINISHED", "content": result.content}
