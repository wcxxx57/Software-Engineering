import unittest

from zhiying_core_generation.adaptive import (
    select_explanation_length,
    select_pretest_problem_count,
)
from zhiying_core_generation.config import Settings
from zhiying_core_generation.generators import generate_knowledge_explanation, generate_pretest
from zhiying_core_generation.models import (
    ExplanationPayload,
    ExplanationSizingPayload,
    KnowledgeExplanationRequest,
    LearnerProfile,
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
        "quiz_api_key": "sk-quiz-test",
        "knowledge_explanation_api_key": "sk-explanation-test",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


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
            )
            for index in range(count)
        ]
    )


class AdaptiveSizingTests(unittest.IsolatedAsyncioTestCase):
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
