import pytest

from src.integration_payload import request_data, split_problem_and_solution


def test_split_problem_and_solution_preserves_authoritative_code() -> None:
    code = "def search(nums, target):\n    return nums.index(target)"
    problem, solution, language = split_problem_and_solution(
        f"# 题目\n在数组中查找目标值。\n\n# 核心代码\n```python\n{code}\n```"
    )

    assert problem == "在数组中查找目标值。"
    assert solution == code
    assert language == "python"


def test_request_data_maps_frontend_prompt() -> None:
    result = request_data(
        {
            "task_id": 42,
            "prompt": "# 题目\n实现二分搜索。\n\n# 核心代码\n```\n#include <vector>\nint search() { return 0; }\n```",
        }
    )

    assert result["problem_description"] == "实现二分搜索。"
    assert result["solution_code"] == "#include <vector>\nint search() { return 0; }"
    assert result["language"] == "C++"
    assert result["render_profile"] == "1080p30"


def test_request_data_forces_1080p_when_message_requests_4k() -> None:
    result = request_data(
        {
            "task_id": 43,
            "prompt": "题目\n```python\nreturn 1\n```",
            "render_profile": "4k60",
        }
    )
    assert result["render_profile"] == "1080p30"


def test_request_data_rejects_prompt_without_solution_code() -> None:
    with pytest.raises(ValueError, match="fenced solution code"):
        request_data({"task_id": 1, "prompt": "只有题目，没有答案代码"})
