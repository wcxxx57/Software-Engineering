import json
from types import SimpleNamespace

import pytest

from src.pedagogy import (
    TEACHING_SCHEMA_VERSION,
    body_section_count_range,
    parse_stage5_evaluation,
    resolve_duration,
    validate_outline,
    validate_requested_duration,
    validate_storyboard,
)
from src.audio_steps import paginate_highlight_groups


def _outline(minutes=5):
    outline = {
        "teaching_schema_version": TEACHING_SCHEMA_VERSION,
        "topic": "二分搜索",
        "target_audience": "有循环基础的学生",
        "factuality_anchor_checklist": ["题目条件", "标准答案代码"],
        "scaffold_map": [{
            "section_id": "section_0_intro",
            "prior_knowledge": "会顺序查找",
            "target_concept": "理解折半排除",
            "bridge_strategy": "从逐个查找的瓶颈引出折半",
        }],
        "sections": [{
            "id": "section_0_intro",
            "title": "从顺序查找到折半",
            "content": "用有序数组引出二分",
            "learning_objective": "能解释每轮为何排除一半",
            "prior_knowledge_activation": "回忆顺序查找",
            "new_concept": "折半排除",
            "misconception_check": "有序是使用前提",
            "bridge_to_next": "接着追踪边界变化",
            "estimated_duration": minutes * 15,
            "evidence_basis": [{
                "claim": "数组有序",
                "source_type": "题目条件",
                "anchor": "problem_description",
            }],
        }],
    }
    base_section = outline["sections"][0]
    outline["sections"] = [
        {**base_section, "id": f"section_{index}", "estimated_duration": minutes * 15}
        for index in range(4)
    ]
    outline["sections"][0]["id"] = "section_0_intro"
    base_scaffold = outline["scaffold_map"][0]
    outline["scaffold_map"] = [
        {**base_scaffold, "section_id": section["id"]}
        for section in outline["sections"]
    ]
    return outline


def _storyboard(solution_code, minutes=5):
    storyboard = {
        "teaching_schema_version": TEACHING_SCHEMA_VERSION,
        "sections": [{
            "id": "section_0_intro",
            "title": "边界如何收缩",
            "estimated_duration": minutes * 15,
            "lecture_lines": ["先回忆顺序查找。", "有序让我们排除一半。"],
            "animations": ["展示数组", "收缩搜索区间"],
            "layout_mode": "with_code",
            "highlight_groups": [[0], [1]],
            "evidence_lines_indices": [1],
            "zpd_check_line_index": 0,
            "bridge_line_index": 1,
            "new_terms_introduced": ["折半排除"],
            "code_snippets": [solution_code],
        }],
    }
    base_section = storyboard["sections"][0]
    storyboard["sections"] = [
        {**base_section, "id": f"section_{index}", "estimated_duration": minutes * 15}
        for index in range(4)
    ]
    storyboard["sections"][0]["id"] = "section_0_intro"
    return storyboard


@pytest.mark.parametrize("minutes, expected", [(5, (4, 6)), (7, (6, 8)), (10, (8, 10))])
def test_body_section_count_range_tracks_duration(minutes, expected):
    assert body_section_count_range(minutes) == expected


def test_manual_duration_skips_ai_and_bounds_are_strict():
    calls = []
    value, source = resolve_duration(
        7,
        lambda *args, **kwargs: calls.append((args, kwargs)),
        topic="二分搜索",
        learner_profile={},
        minimum=5,
        maximum=15,
        fallback=10,
    )
    assert (value, source) == (7, "manual")
    assert calls == []
    with pytest.raises(ValueError):
        validate_requested_duration(4, 5, 15)


def test_ai_duration_retries_then_falls_back():
    calls = []

    def invalid_api(*args, **kwargs):
        calls.append(1)
        return "not-json"

    value, source = resolve_duration(
        None,
        invalid_api,
        topic="复杂题目",
        learner_profile={},
        minimum=5,
        maximum=15,
        fallback=10,
    )
    assert (value, source) == (10, "fallback")
    assert len(calls) == 3


def test_outline_and_storyboard_schema_and_code_authority():
    solution = "while left <= right:\n    mid = (left + right) // 2"
    outline = _outline()
    _, outline_errors = validate_outline(
        outline,
        target_minutes=5,
        evidence_types={"题目条件", "标准答案代码", "算法定义", "不变量", "执行追踪", "复杂度推导", "边界案例"},
    )
    assert outline_errors == []
    storyboard = _storyboard(solution)
    _, storyboard_errors = validate_storyboard(
        storyboard,
        outline_sections=outline["sections"],
        target_minutes=5,
        max_new_terms=2,
        solution_code=solution,
    )
    assert storyboard_errors == []
    storyboard["sections"][0]["code_snippets"] = ["mid = left"]
    _, errors = validate_storyboard(
        storyboard,
        outline_sections=outline["sections"],
        target_minutes=5,
        max_new_terms=2,
        solution_code=solution,
    )
    assert any("逐字连续片段" in error for error in errors)


def test_line_length_group_coverage_and_stage5_failure_are_blocking():
    solution = "return left"
    outline = _outline()
    storyboard = _storyboard(solution)
    storyboard["sections"][0]["lecture_lines"][0] = "这是一条明显超过二十个字符并且应该被结构校验拒绝的中文长句。"
    storyboard["sections"][0]["highlight_groups"] = [[0]]
    _, errors = validate_storyboard(
        storyboard,
        outline_sections=outline["sections"],
        target_minutes=5,
        max_new_terms=2,
        solution_code=solution,
    )
    assert any("超过 20 字" in error for error in errors)
    assert any("恰好覆盖" in error for error in errors)
    with pytest.raises(ValueError):
        parse_stage5_evaluation("not-json")


def test_stage5_threshold_and_hard_blocker():
    payload = {
        name: {"score": 15, "feedback": "可复核"}
        for name in ("element_layout", "attractiveness", "logic_flow", "accuracy_depth", "learner_fit_zpd", "visual_consistency")
    }
    payload["accuracy_depth"]["unsupported_claim_count"] = 0
    payload.update({
        "overall_score": 90,
        "is_good_enough": True,
        "hard_blockers": ["代码与标准答案不一致"],
        "critical_failures": [],
        "improvements": [],
    })
    parsed = parse_stage5_evaluation(json.dumps(payload, ensure_ascii=False))
    assert parsed["is_good_enough"] is False
    assert parsed["improvements"]


def test_highlight_group_is_atomic_across_four_line_pages():
    section = SimpleNamespace(
        lecture_lines=["一", "二", "三", "四", "五"],
        highlight_groups=[[0, 1], [2, 3], [4]],
        layout_mode="with_code",
    )
    pages = paginate_highlight_groups(section)
    assert [[group["highlight_indices"] for group in page] for page in pages] == [
        [[0, 1], [2, 3]],
        [[4]],
    ]
