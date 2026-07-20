import json
from types import SimpleNamespace

import pytest

from src.pedagogy import (
    TEACHING_SCHEMA_VERSION,
    body_section_count_range,
    normalize_grouped_lecture_lines,
    parse_stage5_evaluation,
    resolve_duration,
    validate_outline,
    validate_requested_duration,
    validate_storyboard,
    wrap_storyboard_lecture_lines,
)
from src.audio_steps import paginate_highlight_groups


def _outline(minutes=5):
    outline = {
        "teaching_schema_version": TEACHING_SCHEMA_VERSION,
        "topic": "二分搜索",
        "target_audience": "有循环基础的学生",
        "factuality_anchor_checklist": ["有序性", "区间不变量"],
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
                "claim": "每轮排除一半",
                "source_type": "不变量",
                "anchor": "目标始终位于当前闭区间",
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


def _storyboard(minutes=5):
    storyboard = {
        "teaching_schema_version": TEACHING_SCHEMA_VERSION,
        "sections": [{
            "id": "section_0_intro",
            "title": "边界如何收缩",
            "estimated_duration": minutes * 15,
            "lecture_lines": ["先回忆顺序查找。", "有序让我们排除一半。"],
            "animations": ["展示数组", "收缩搜索区间"],
            "layout_mode": "no_code",
            "highlight_groups": [[0], [1]],
            "evidence_lines_indices": [1],
            "zpd_check_line_index": 0,
            "bridge_line_index": 1,
            "new_terms_introduced": ["折半排除"],
            "code_snippets": [],
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
        maximum=12,
        fallback=8,
    )
    assert (value, source) == (7, "manual")
    assert calls == []
    with pytest.raises(ValueError):
        validate_requested_duration(13, 5, 12)


def test_ai_duration_retries_then_falls_back():
    calls = []

    def invalid_api(*args, **kwargs):
        calls.append(1)
        return "not-json"

    value, source = resolve_duration(
        None,
        invalid_api,
        topic="复杂知识点",
        learner_profile={},
        minimum=5,
        maximum=12,
        fallback=8,
    )
    assert (value, source) == (8, "fallback")
    assert len(calls) == 3


def test_schema_line_limit_group_coverage_and_stage5_blocker():
    outline = _outline()
    _, errors = validate_outline(
        outline,
        target_minutes=5,
        evidence_types={"算法定义", "不变量", "执行追踪", "复杂度推导", "边界案例"},
    )
    assert errors == []
    storyboard = _storyboard()
    _, errors = validate_storyboard(
        storyboard,
        outline_sections=outline["sections"],
        target_minutes=5,
        max_new_terms=2,
    )
    assert errors == []
    storyboard["sections"][0]["lecture_lines"][0] = "这是一条明显超过二十个字符并且应该被结构校验拒绝的中文长句。"
    storyboard["sections"][0]["highlight_groups"] = [[0]]
    _, errors = validate_storyboard(
        storyboard,
        outline_sections=outline["sections"],
        target_minutes=5,
        max_new_terms=2,
    )
    assert any("超过 20 字" in error for error in errors)
    assert any("恰好覆盖" in error for error in errors)

    payload = {
        name: {"score": 15, "feedback": "可复核"}
        for name in ("element_layout", "attractiveness", "logic_flow", "accuracy_depth", "learner_fit_zpd", "visual_consistency")
    }
    payload["accuracy_depth"]["unsupported_claim_count"] = 0
    payload.update({
        "overall_score": 90,
        "is_good_enough": True,
        "hard_blockers": ["脚手架断裂"],
        "critical_failures": [],
        "improvements": [],
    })
    parsed = parse_stage5_evaluation(json.dumps(payload, ensure_ascii=False))
    assert parsed["is_good_enough"] is False
    with pytest.raises(ValueError):
        parse_stage5_evaluation("not-json")


def test_highlight_group_is_atomic_across_eight_line_pages():
    section = SimpleNamespace(
        lecture_lines=[str(index) for index in range(10)],
        highlight_groups=[[0, 1, 2], [3, 4, 5], [6, 7, 8], [9]],
        layout_mode="no_code",
    )
    pages = paginate_highlight_groups(section)
    assert [[group["highlight_indices"] for group in page] for page in pages] == [
        [[0, 1, 2], [3, 4, 5]],
        [[6, 7, 8], [9]],
    ]


def test_semantic_group_punctuation_keeps_singletons_and_content_density():
    original = [
        "先到先处理用普通队列。",
        "持续完整名次用排序列表。",
        "只取下一项用优先队列。",
    ]
    normalized = normalize_grouped_lecture_lines(original, [[0, 1], [2]])
    assert normalized == [
        "先到先处理用普通队列，",
        "持续完整名次用排序列表。",
        "只取下一项用优先队列。",
    ]
    assert [len(item.rstrip("，。？！?!")) for item in normalized] == [
        len(item.rstrip("，。？！?!")) for item in original
    ]


def test_visual_line_wrapping_preserves_semantic_group_and_indices():
    storyboard = _storyboard()
    section = storyboard["sections"][0]
    section["lecture_lines"] = [
        "先回忆顺序查找。",
        "这是一条超过二十个字但不能删掉任何信息的完整讲解文字。",
    ]
    section["highlight_groups"] = [[0], [1]]
    section["evidence_lines_indices"] = [1]
    section["bridge_line_index"] = 1
    wrapped = wrap_storyboard_lecture_lines(storyboard)
    result = wrapped["sections"][0]
    assert all(len(line) <= 20 for line in result["lecture_lines"])
    assert "".join(result["lecture_lines"][1:]) == section["lecture_lines"][1]
    assert result["highlight_groups"][0] == [0]
    assert result["highlight_groups"][1] == list(range(1, len(result["lecture_lines"])))
    assert result["evidence_lines_indices"] == result["highlight_groups"][1]
    assert result["bridge_line_index"] == len(result["lecture_lines"]) - 1
