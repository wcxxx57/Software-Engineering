import unittest

from pydantic import ValidationError

from zhiying_core_generation.llm import _strip_code_fence
from zhiying_core_generation.models import Problem


class ModelTests(unittest.TestCase):
    def test_problem_accepts_valid_choices(self) -> None:
        problem = Problem(
            content="以下哪项是正确的？",
            choice_a="选项一",
            choice_b="选项二",
            choice_c="选项三",
            choice_d="选项四",
            answer="A",
            explanation="选项一符合定义。",
        )
        self.assertEqual(problem.answer, "A")

    def test_problem_rejects_duplicate_choices(self) -> None:
        with self.assertRaises(ValidationError):
            Problem(
                content="以下哪项是正确的？",
                choice_a="重复",
                choice_b="重复",
                choice_c="选项三",
                choice_d="选项四",
                answer="A",
                explanation="说明。",
            )

    def test_strip_json_fence(self) -> None:
        self.assertEqual(_strip_code_fence('```json\n{"ok":true}\n```'), '{"ok":true}')


if __name__ == "__main__":
    unittest.main()
