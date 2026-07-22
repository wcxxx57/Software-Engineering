from __future__ import annotations

import asyncio
import hashlib
import importlib.util
import json
from functools import lru_cache
from pathlib import Path
from types import ModuleType

from .adaptive import select_explanation_length, select_pretest_problem_count
from .config import Settings
from .llm import LlmClient, LlmError
from .models import (
    AcquiredCurriculumPayload,
    CurriculumAcquisitionRequest,
    CurriculumSelectionPayload,
    ExplanationPayload,
    KnowledgeExplanationRequest,
    PlanPayload,
    PlanRequest,
    PretestRequest,
    ProblemsPayload,
    QuizRequest,
)
from .web_search import TavilyWebSearchProvider

PROBLEM_SYSTEM = """你是严谨的中文教育测评专家。只返回合法 JSON，不要返回 Markdown。
每道题必须有四个互不相同的选项，answer 只能为 A、B、C、D，explanation 要说明答案理由。
题目必须围绕用户主题，避免歧义、冷僻事实和无法验证的答案。"""

_WEB_ACQUISITION_LOCK = asyncio.Lock()
_WEB_ACQUISITION_TASKS: dict[str, asyncio.Task[dict]] = {}
_WEB_ACQUISITION_RESULTS: dict[str, dict] = {}


def _skill_directory() -> Path:
    source_tree = Path(__file__).resolve().parents[2] / "skills" / "generate-course-plan"
    return source_tree if source_tree.exists() else Path("/app/skills/generate-course-plan")


@lru_cache(maxsize=1)
def _load_plan_skill_runner() -> ModuleType:
    runner_path = _skill_directory() / "scripts" / "runner.py"
    spec = importlib.util.spec_from_file_location("generate_course_plan_runner", runner_path)
    if spec is None or spec.loader is None:
        raise LlmError("generate-course-plan runner is unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def generate_pretest(client: LlmClient, settings: Settings, request: PretestRequest) -> dict:
    sizing = await select_pretest_problem_count(client, settings, request)
    user = f"""为以下学习目标生成 {sizing.problem_count} 道课前诊断选择题。
主题：{request.prompt}
目标：{request.target}
学习语言：{request.language}
计划阶段数：{request.total_stages}
学习者画像：{json.dumps(request.learner_profile.model_dump(), ensure_ascii=False)}
权威课程大纲：{json.dumps(request.authoritative_outline.model_dump(), ensure_ascii=False)}
覆盖从基础概念到应用能力的不同层级。
题目数量已根据画像和知识点动态规划，必须恰好生成 {sizing.problem_count} 道，避免同质重复。
每道题必须绑定权威大纲中一个真实的 knowledge_node_key，不得发明节点。
返回对象格式：{{"problems":[{{"content":"...","choice_a":"...","choice_b":"...","choice_c":"...","choice_d":"...","answer":"A","explanation":"...","knowledge_node_key":"..."}}]}}"""
    valid_keys = {node.node_key for node in request.authoritative_outline.nodes}
    last_error = ""
    result: ProblemsPayload | None = None
    for _ in range(settings.llm_max_retries):
        retry_feedback = (
            f"\n上一次输出不合格：{last_error}。请完整重新生成。" if last_error else ""
        )
        generated = await client.generate(
            system=PROBLEM_SYSTEM,
            user=user + retry_feedback,
            schema=ProblemsPayload,
        )
        assert isinstance(generated, ProblemsPayload)
        if len(generated.problems) != sizing.problem_count:
            last_error = f"题目数应为{sizing.problem_count}，实际为{len(generated.problems)}"
            continue
        if any(problem.knowledge_node_key not in valid_keys for problem in generated.problems):
            last_error = "存在未知或空的knowledge_node_key"
            continue
        result = generated
        break
    if result is None:
        raise LlmError(f"pretest validation failed after retries: {last_error}")
    return {
        "status": "FINISHED",
        "problems": [p.model_dump() for p in result.problems],
        "adaptation": {
            "problem_count": sizing.problem_count,
            "source": sizing.source,
            "reason": sizing.reason,
        },
    }


async def generate_plan(client: LlmClient, settings: Settings, request: PlanRequest) -> dict:
    skill_path = _skill_directory() / "SKILL.md"
    skill_instructions = skill_path.read_text(encoding="utf-8")
    runner = _load_plan_skill_runner()
    request_data = request.model_dump()
    user = runner.assemble_plan_prompt(
        skill_instructions,
        request_data,
        settings.plan_tasks_per_stage,
    )
    valid_keys = {node.node_key for node in request.authoritative_outline.nodes}
    result: PlanPayload | None = None
    last_error = ""
    for _ in range(settings.llm_max_retries):
        retry_feedback = (
            f"\n上一次输出不合格：{last_error}。请完整重新生成。" if last_error else ""
        )
        generated = await client.generate(
            system="你是个性化学习路径设计专家。只返回合法 JSON，不要返回 Markdown。",
            user=user + retry_feedback,
            schema=PlanPayload,
        )
        assert isinstance(generated, PlanPayload)
        try:
            runner.validate_plan_payload(
                generated.model_dump(),
                valid_keys,
                request.total_stages,
                settings.plan_tasks_per_stage,
            )
        except ValueError as exc:
            last_error = str(exc)
            continue
        result = generated
        break
    if result is None:
        raise LlmError(f"plan validation failed after retries: {last_error}")
    return {"status": "FINISHED", "stages": [s.model_dump() for s in result.stages]}


async def generate_curriculum_acquisition(
    client: LlmClient, settings: Settings, request: CurriculumAcquisitionRequest
) -> dict:
    templates = [template.model_dump() for template in request.available_templates]
    selection = await client.generate(
        system=(
            "你是课程目录检索器。根据课程名称、别名和知识点摘要做语义选择。"
            "如果现有模板足以支撑用户目标，返回其 template_id；"
            "确实没有合适模板才返回 null。只返回JSON。"
        ),
        user=f"""用户主题：{request.prompt}
学习语言：{request.language}
学习目标：{request.target}
当前已发布课程模板：{json.dumps(templates, ensure_ascii=False)}
返回：{{"existing_template_id":123或null,"reason":"..."}}""",
        schema=CurriculumSelectionPayload,
    )
    assert isinstance(selection, CurriculumSelectionPayload)
    if selection.existing_template_id is not None:
        valid_ids = {template.template_id for template in request.available_templates}
        if selection.existing_template_id not in valid_ids:
            raise LlmError("curriculum selector returned an unknown template id")
        return {"status": "FINISHED", "existing_template_id": selection.existing_template_id}

    cache_key = json.dumps(
        [request.prompt.strip().casefold(), request.language, request.target.strip().casefold()],
        ensure_ascii=False,
    )
    async with _WEB_ACQUISITION_LOCK:
        cached = _WEB_ACQUISITION_RESULTS.get(cache_key)
        if cached is not None:
            return dict(cached)
        task = _WEB_ACQUISITION_TASKS.get(cache_key)
        if task is None:
            task = asyncio.create_task(_acquire_curriculum_from_web(client, settings, request))
            _WEB_ACQUISITION_TASKS[cache_key] = task
    try:
        result = await asyncio.shield(task)
    except Exception:
        async with _WEB_ACQUISITION_LOCK:
            if _WEB_ACQUISITION_TASKS.get(cache_key) is task:
                _WEB_ACQUISITION_TASKS.pop(cache_key, None)
        raise
    async with _WEB_ACQUISITION_LOCK:
        _WEB_ACQUISITION_TASKS.pop(cache_key, None)
        _WEB_ACQUISITION_RESULTS[cache_key] = result
        while len(_WEB_ACQUISITION_RESULTS) > 128:
            _WEB_ACQUISITION_RESULTS.pop(next(iter(_WEB_ACQUISITION_RESULTS)))
    return dict(result)


async def _acquire_curriculum_from_web(
    client: LlmClient, settings: Settings, request: CurriculumAcquisitionRequest
) -> dict:

    if not settings.tavily_api_key:
        raise LlmError("TAVILY_API_KEY is required when no curriculum template matches")
    query = f"{request.prompt} {request.target} 课程大纲 授课大纲"
    provider = TavilyWebSearchProvider(settings.tavily_api_key)
    search_results = await provider.search(
        query,
        include_domains=settings.curriculum_domains,
        max_results=settings.curriculum_search_max_results,
        timeout_s=settings.llm_timeout_s,
    )
    candidates = [
        {"url": item.url, "title": item.title, "content": item.content}
        for item in search_results
    ]
    if not candidates:
        raise LlmError("no curriculum pages found in allowed domains")

    extracted = await client.generate(
        system=(
            "你是严谨的课程大纲结构化专家。只从给定候选网页提取课程信息，不补写网页没有的章节。"
            "只有网页明确含课程大纲、授课大纲、教学大纲或syllabus章节时才可选用，raw_outline必须保留该标题。"
            "节点必须构成一棵树：一个depth=0根节点，至少五个下级知识节点；node_key使用简短小写英文和连字符。"
            "match_score表示网页课程与用户主题的一致度。只返回JSON。"
        ),
        user=f"""用户主题：{request.prompt}
学习语言：{request.language}
学习目标：{request.target}
候选网页：{json.dumps(candidates, ensure_ascii=False)}
返回课程名称、slug、语言、别名、平台、学校、教师、所选source_url、原始大纲文本、match_score和nodes。""",
        schema=AcquiredCurriculumPayload,
    )
    assert isinstance(extracted, AcquiredCurriculumPayload)
    candidate_by_url = {candidate["url"]: candidate for candidate in candidates}
    chosen = candidate_by_url.get(extracted.source_url)
    if chosen is None:
        raise LlmError("curriculum extractor returned a URL outside search results")
    result = extracted.model_dump()
    result["content_hash"] = hashlib.sha256(chosen["content"].encode("utf-8")).hexdigest()
    result["raw_outline"] = extracted.raw_outline[:30_000]
    return {"status": "FINISHED", "curriculum": result}


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
    sizing = await select_explanation_length(client, settings, request)
    lower_chars = round(sizing.target_chars * 0.85)
    upper_chars = round(sizing.target_chars * 1.15)
    learning_context = request.learning_context.model_dump() if request.learning_context else {}
    user = f"""为以下学习任务编写一份可直接展示给学生的个性化解析：
{request.prompt}

学习者画像：{json.dumps(request.learner_profile.model_dump(), ensure_ascii=False)}
学习上下文：{json.dumps(learning_context, ensure_ascii=False)}
篇幅规划：目标约 {sizing.target_chars} 个中文字符，可接受范围 {lower_chars}-{upper_chars} 字。
讲解深度：{sizing.detail_level}。

内容必须使用 Markdown，并至少包含：
1. 概述：解释本任务解决什么问题；
2. 核心概念：分点解释必要知识；
3. 逐步讲解：从基础到应用给出清晰步骤；
4. 示例：结合具体代码或场景；
5. 常见错误：列出易错点和纠正方法；
6. 实践建议：给出学生可以立即完成的练习；
7. 小结：总结关键结论。

根据画像调整术语解释、推导步幅和示例密度；基础较好时避免重复解释已知常识，基础较弱时补足必要前置概念。
语言清晰、准确。代码必须放在 Markdown 代码块中，不得通过重复表述填充篇幅。
返回 JSON 对象：{{"content":"完整 Markdown 内容"}}"""
    system = "你是严谨的编程教育专家。只返回合法 JSON，不要在 JSON 外输出内容。"
    best_result: ExplanationPayload | None = None
    best_distance: int | None = None
    retry_feedback = ""
    for _ in range(settings.explanation_length_max_attempts):
        result = await client.generate(
            system=system,
            user=user + retry_feedback,
            schema=ExplanationPayload,
        )
        assert isinstance(result, ExplanationPayload)
        actual_chars = len(result.content)
        distance = abs(actual_chars - sizing.target_chars)
        if best_distance is None or distance < best_distance:
            best_result = result
            best_distance = distance
        if lower_chars <= actual_chars <= upper_chars:
            break
        retry_feedback = (
            f"\n上一次正文约 {actual_chars} 字，超出 {lower_chars}-{upper_chars} 字范围。"
            "请保留知识完整性并重新组织篇幅后生成完整正文。"
        )
    assert best_result is not None
    return {
        "status": "FINISHED",
        "content": best_result.content,
        "adaptation": {
            "target_chars": sizing.target_chars,
            "detail_level": sizing.detail_level,
            "source": sizing.source,
            "reason": sizing.reason,
            "actual_chars": len(best_result.content),
        },
    }
