import unittest

from zhiying_core_generation.adaptive import (
    select_explanation_length,
    select_pretest_problem_count,
)
from zhiying_core_generation.config import Settings
from zhiying_core_generation.generators import (
    generate_curriculum_acquisition,
    generate_knowledge_explanation,
    generate_plan,
    generate_pretest,
)
from zhiying_core_generation.models import (
    CurriculumAcquisitionRequest,
    CurriculumNode,
    CurriculumOutline,
    CurriculumSelectionPayload,
    CurriculumSource,
    CurriculumTemplateSummary,
    ExplanationPayload,
    ExplanationSizingPayload,
    GeneratedCurriculumPayload,
    KnowledgeExplanationRequest,
    LearnerProfile,
    PlanPayload,
    PlanRequest,
    PlanStage,
    PlanTask,
    PretestRequest,
    PretestSizingPayload,
    Problem,
    ProblemsPayload,
)


def settings(**overrides: object) -> Settings:
    values = {
        "llm_api_key": "test-key",
        "pretest_api_key": "sk-pretest-test",
        "plan_api_key": "sk-plan-test",
        "curriculum_api_key": "sk-curriculum-test",
        "quiz_api_key": "sk-quiz-test",
        "knowledge_explanation_api_key": "sk-explanation-test",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def outline() -> CurriculumOutline:
    return CurriculumOutline(
        template_id=1,
        canonical_name="Rust 语言基础",
        version=1,
        sources=[
            CurriculumSource(
                platform="MOOC",
                institution="示例高校",
                source_url="https://www.icourse163.org/course/example",
            )
        ],
        nodes=[
            CurriculumNode(
                node_key="root",
                title="Rust 语言基础",
                depth=0,
                sort_order=0,
            )
        ],
    )


class FakeClient:
    def __init__(self, *responses: object) -> None:
        self.responses = list(responses)
        self.calls: list[dict[str, object]] = []

    async def generate(self, **kwargs: object) -> object:
        self.calls.append(kwargs)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def problems(count: int) -> ProblemsPayload:
    return ProblemsPayload(
        problems=[
            Problem(
                content=f"第 {index + 1} 题考查什么？",
                choice_a=f"正确选项 {index}",
                choice_b=f"干扰选项 B{index}",
                choice_c=f"干扰选项 C{index}",
                choice_d=f"干扰选项 D{index}",
                answer="A",
                explanation="用于诊断对应知识层级。",
                knowledge_node_key="root",
            )
            for index in range(count)
        ]
    )


class AdaptiveSizingTests(unittest.IsolatedAsyncioTestCase):
    async def test_plan_skill_runner_enforces_authoritative_node_mapping(self) -> None:
        client = FakeClient(
            PlanPayload(
                stages=[
                    PlanStage(
                        title="基础阶段",
                        description="掌握核心概念",
                        tasks=[
                            PlanTask(
                                title=f"任务 {index}",
                                description="完成概念学习和练习",
                                knowledge_node_key="root",
                                day_index=index + 1,
                            )
                            for index in range(3)
                        ],
                    )
                ]
            )
        )
        request = PlanRequest(
            task_id=2,
            prompt="Rust 基础",
            total_stages=1,
            language="RUST",
            target="掌握所有权",
            pretest_results=[],
            authoritative_outline=outline(),
        )

        result = await generate_plan(
            client,
            settings(plan_model="gpt-5.5"),
            request,
        )  # type: ignore[arg-type]

        self.assertEqual(result["stages"][0]["tasks"][0]["knowledge_node_key"], "root")
        self.assertIn("权威课程大纲", client.calls[0]["user"])
        self.assertEqual(client.calls[0]["model"], "gpt-5.5")

    async def test_curriculum_ai_selects_from_current_database_without_web_search(self) -> None:
        client = FakeClient(
            CurriculumSelectionPayload(
                existing_template_id=17,
                reason="知识点与 Python 基础模板一致",
            )
        )
        request = CurriculumAcquisitionRequest(
            task_id=1,
            prompt="Python basics",
            language="PYTHON",
            target="从零掌握语法和函数",
            available_templates=[
                CurriculumTemplateSummary(
                    template_id=17,
                    canonical_name="Python 语言基础",
                    version=1,
                    language="PYTHON",
                    aliases=["Python基础", "Python basics"],
                    knowledge_points=["变量、类型与运算", "函数与模块"],
                )
            ],
        )

        result = await generate_curriculum_acquisition(client, settings(), request)  # type: ignore[arg-type]

        self.assertEqual(result["existing_template_id"], 17)
        self.assertEqual(len(client.calls), 1)

    async def test_curriculum_ai_generates_outline_when_database_has_no_match(self) -> None:
        nodes = [
            CurriculumNode(
                node_key="root",
                title="分布式系统课程",
                description="完整课程知识结构",
                depth=0,
                sort_order=0,
            ),
            *[
                CurriculumNode(
                    node_key=f"topic-{index}",
                    parent_node_key="root",
                    title=f"知识模块 {index}",
                    description=f"掌握第 {index} 个核心知识模块",
                    depth=1,
                    sort_order=index,
                )
                for index in range(1, 6)
            ],
        ]
        client = FakeClient(
            CurriculumSelectionPayload(existing_template_id=None, reason="数据库无匹配模板"),
            GeneratedCurriculumPayload(
                canonical_name="分布式系统基础",
                slug="distributed-systems-basics",
                language="GENERAL",
                aliases=["分布式系统"],
                raw_outline=(
                    "课程大纲\n本课程从分布式系统基础概念开始，依次覆盖节点通信、时间与顺序、"
                    "复制与一致性、故障检测与容错、分布式存储，以及完整的工程设计与实践。"
                ),
                nodes=nodes,
            ),
        )
        request = CurriculumAcquisitionRequest(
            task_id=2,
            prompt="分布式系统",
            language="GENERAL",
            target="掌握一致性与容错设计",
            available_templates=[],
        )

        result = await generate_curriculum_acquisition(
            client, settings(), request  # type: ignore[arg-type]
        )

        self.assertEqual(result["status"], "FINISHED")
        self.assertEqual(result["curriculum"]["source_url"], "ai://generated")
        self.assertEqual(result["curriculum"]["platform"], "AI_GENERATED")
        self.assertEqual(len(result["curriculum"]["content_hash"]), 64)
        self.assertEqual(len(client.calls), 2)

    async def test_pretest_uses_ai_selected_count_in_generation(self) -> None:
        client = FakeClient(
            PretestSizingPayload(problem_count=8, reason="学习目标聚焦但需要覆盖基础与应用"),
            problems(8),
        )
        request = PretestRequest(
            task_id=1,
            prompt="Rust 所有权",
            total_stages=3,
            language="RUST",
            target="能够解释借用检查",
            learner_profile=LearnerProfile(introduction="有 C 语言基础"),
            authoritative_outline=outline(),
        )

        result = await generate_pretest(client, settings(), request)  # type: ignore[arg-type]

        self.assertEqual(len(result["problems"]), 8)
        self.assertEqual(result["adaptation"]["problem_count"], 8)
        self.assertEqual(result["adaptation"]["source"], "ai")
        self.assertIn("恰好生成 8 道", client.calls[1]["user"])

    async def test_pretest_selector_falls_back_when_ai_fails(self) -> None:
        decision = await select_pretest_problem_count(  # type: ignore[arg-type]
            FakeClient(RuntimeError("unavailable")),
            settings(pretest_problem_count=9),
            PretestRequest(
                task_id=1,
                prompt="二分搜索",
                total_stages=3,
                language="PYTHON",
                target="掌握边界处理",
                authoritative_outline=outline(),
            ),
        )

        self.assertEqual(decision.problem_count, 9)
        self.assertEqual(decision.source, "fallback")

    async def test_explanation_selector_accepts_bounded_ai_budget(self) -> None:
        decision = await select_explanation_length(  # type: ignore[arg-type]
            FakeClient(
                ExplanationSizingPayload(
                    target_chars=3600,
                    detail_level="deep",
                    reason="需要补足状态定义和转移推导",
                )
            ),
            settings(),
            KnowledgeExplanationRequest(
                task_id=2,
                prompt="动态规划状态转移",
                learner_profile=LearnerProfile(introduction="刚学完递归"),
            ),
        )

        self.assertEqual(decision.target_chars, 3600)
        self.assertEqual(decision.detail_level, "deep")
        self.assertEqual(decision.source, "ai")

    async def test_explanation_retries_to_meet_selected_length_range(self) -> None:
        client = FakeClient(
            ExplanationSizingPayload(
                target_chars=1200,
                detail_level="standard",
                reason="需要适量前置说明",
            ),
            ExplanationPayload(content="短" * 500),
            ExplanationPayload(content="合" * 1200),
        )

        result = await generate_knowledge_explanation(  # type: ignore[arg-type]
            client,
            settings(),
            KnowledgeExplanationRequest(task_id=3, prompt="哈希冲突处理"),
        )

        self.assertEqual(result["adaptation"]["actual_chars"], 1200)
        self.assertEqual(len(client.calls), 3)
        self.assertIn("上一次正文约 500 字", client.calls[2]["user"])


if __name__ == "__main__":
    unittest.main()
