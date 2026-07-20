"""中文教学结构、时长和分镜的确定性校验工具。"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import copy
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple


TEACHING_SCHEMA_VERSION = "zh-cn-pedagogy-v2"
LECTURE_LINE_MAX_CHARS = 20
_TRAILING_PUNCTUATION = re.compile(r"[，,。；;：:！？!?]+$")


def validate_requested_duration(value: Optional[int], minimum: int, maximum: int) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError("duration 必须是整数或 null")
    if not minimum <= value <= maximum:
        raise ValueError(f"duration 必须在 {minimum}-{maximum} 分钟之间")
    return value


def body_section_count_range(target_minutes: int) -> Tuple[int, int]:
    """Return the recommended number of outline/body sections for a video.

    Cover and overview scenes are produced outside the outline, so they are not
    included in this count.  Longer values are supported for compatibility with
    callers that allow videos beyond the current K2V 12-minute range.
    """
    if isinstance(target_minutes, bool) or not isinstance(target_minutes, int) or target_minutes <= 0:
        raise ValueError("target_minutes 必须是正整数")
    if target_minutes <= 6:
        return 4, 6
    if target_minutes <= 9:
        return 6, 8
    if target_minutes <= 12:
        return 8, 10
    return 10, 12


def normalize_grouped_lecture_lines(lines: List[str], groups: Any) -> List[str]:
    """Format visual lines as semantic sentences without changing their density.

    A singleton group remains a valid singleton.  Multi-line groups use commas
    between visual line wraps and one sentence-ending mark on the final line.
    """
    normalized = [str(line).strip() for line in lines]
    if not isinstance(groups, list):
        groups = [[index] for index in range(len(normalized))]
    for group in groups:
        if not isinstance(group, list) or not group:
            continue
        valid = [index for index in group if isinstance(index, int) and 0 <= index < len(normalized)]
        for position, index in enumerate(valid):
            original = normalized[index]
            ending = original[-1:] if original[-1:] in "。？！!?" else "。"
            stem = _TRAILING_PUNCTUATION.sub("", original).strip()
            if not stem:
                continue
            normalized[index] = stem + (ending if position == len(valid) - 1 else "，")
    return normalized


def wrap_storyboard_lecture_lines(data: Any, max_chars: int = LECTURE_LINE_MAX_CHARS) -> Any:
    """只改变画面换行，保留 AI 选择的语义组和全部信息。"""
    if not isinstance(data, dict) or not isinstance(data.get("sections"), list):
        return data
    wrapped = copy.deepcopy(data)

    def split_line(text: str) -> List[str]:
        remaining = text.strip()
        chunks: List[str] = []
        while len(remaining) > max_chars:
            window = remaining[:max_chars]
            candidates = [
                index + 1
                for index, char in enumerate(window)
                if char in "，。；：、！？,.;:!? " and index + 1 >= max_chars // 2
            ]
            cut = candidates[-1] if candidates else max_chars
            chunks.append(remaining[:cut].strip())
            remaining = remaining[cut:].strip()
        if remaining:
            chunks.append(remaining)
        return chunks

    for section in wrapped["sections"]:
        if not isinstance(section, dict):
            continue
        lines = section.get("lecture_lines")
        groups = section.get("highlight_groups")
        if not isinstance(lines, list) or not all(isinstance(line, str) and line.strip() for line in lines):
            continue
        if not (
            isinstance(groups, list)
            and groups
            and all(
                isinstance(group, list)
                and group
                and all(isinstance(index, int) and not isinstance(index, bool) and 0 <= index < len(lines) for index in group)
                for group in groups
            )
        ):
            continue

        new_lines: List[str] = []
        mapping: Dict[int, List[int]] = {}
        for old_index, line in enumerate(lines):
            parts = split_line(line)
            mapping[old_index] = list(range(len(new_lines), len(new_lines) + len(parts)))
            new_lines.extend(parts)
        if len(new_lines) == len(lines):
            continue

        section["lecture_lines"] = new_lines
        section["highlight_groups"] = [
            [new_index for old_index in group for new_index in mapping[old_index]]
            for group in groups
        ]
        evidence = section.get("evidence_lines_indices")
        if (
            isinstance(evidence, list)
            and all(isinstance(index, int) and not isinstance(index, bool) and index in mapping for index in evidence)
        ):
            section["evidence_lines_indices"] = [
                new_index
                for old_index in evidence
                for new_index in mapping[old_index]
            ]
        zpd = section.get("zpd_check_line_index")
        if isinstance(zpd, int) and zpd in mapping:
            section["zpd_check_line_index"] = mapping[zpd][0]
        bridge = section.get("bridge_line_index")
        if isinstance(bridge, int) and bridge in mapping:
            section["bridge_line_index"] = mapping[bridge][-1]
    return wrapped


def extract_response_text(response: Any) -> str:
    if response is None:
        return ""
    try:
        return response.candidates[0].content.parts[0].text
    except Exception:
        try:
            return response.choices[0].message.content
        except Exception:
            return str(response)


def select_duration_with_ai(
    api_call: Callable[..., Any],
    *,
    topic: str,
    learner_profile: Dict[str, Any],
    minimum: int,
    maximum: int,
    fallback: int,
    problem_description: str = "",
    attempts: int = 3,
) -> Tuple[int, str]:
    summary = learner_profile.get("user_summary", {}) if isinstance(learner_profile, dict) else {}
    known_concepts = summary.get("known_concepts") or summary.get("background") or "未说明"
    knowledge_gaps = summary.get("knowledge_gaps") or "未说明"
    learning_goal = summary.get("learning_goal") or summary.get("zpd_learning_target") or "掌握核心概念与应用"
    difficulty_preference = summary.get("difficulty_preference") or "中等"

    def _log_value(value: Any) -> str:
        if isinstance(value, (list, tuple, set)):
            return "、".join(str(item) for item in value) or "未说明"
        if isinstance(value, dict):
            return "、".join(f"{key}={item}" for key, item in value.items()) or "未说明"
        return str(value).strip() or "未说明"

    print("🧠 AI 时长决策依据（来自用户画像）")
    print(f"   主题：{topic}")
    print(f"   已有知识：{_log_value(known_concepts)}")
    print(f"   待补知识：{_log_value(knowledge_gaps)}")
    print(f"   学习目标：{_log_value(learning_goal)}")
    print(f"   难度偏好：{_log_value(difficulty_preference)}")
    print(f"   允许范围：{minimum}-{maximum} 分钟")
    prompt = f"""
你是中文教学视频的时长规划员。请综合内容复杂度、学生已有知识、待补缺口、难度和讲解深度，选择合适的成片目标时长。

主题：{topic}
题目描述：{problem_description or '无，按知识点本身判断'}
学生已有知识：{known_concepts}
待补知识：{knowledge_gaps}
学习目标：{learning_goal}
难度偏好：{difficulty_preference}

约束：
- 只能选择 {minimum} 到 {maximum} 之间的整数分钟。
- 基础弱、概念多、推导或执行追踪复杂时取更长；基础强、主题单一时取更短。
- 不得为了填满时间重复内容。
- 选择“覆盖当前学习目标所需的最短充分时长”，不要把一个知识点按完整课程估时。
- 参考标尺：
  - 5 分钟：单一核心概念，学习者已有所需语言基础，只需一次主流程追踪和简短检查。
  - 6 分钟：单一算法，需要一次成功追踪、一次失败或边界说明，并联系一个熟悉场景。
  - 7-8 分钟：需要两种实现方式、多个大型案例，或较完整的复杂度解释。
  - 9-12 分钟：包含递归与迭代对比、严格推导、多个算法变体或多个相互依赖的新概念。
- 若用户明确不需要递归、证明和算法变体，不得仅因“没有系统计算机专业背景”自动选择 9-12 分钟。

只输出 JSON：{{"duration": 整数, "reason": "一句中文理由"}}
""".strip()

    for _ in range(attempts):
        try:
            response = api_call(prompt, max_tokens=120)
            text = extract_response_text(response).strip()
            match = re.search(r"\{.*\}", text, flags=re.DOTALL)
            payload = json.loads(match.group(0) if match else text)
            value = payload.get("duration")
            if isinstance(value, int) and not isinstance(value, bool) and minimum <= value <= maximum:
                reason = str(payload.get("reason") or "模型未提供文字理由").strip()
                print(f"✅ AI 时长决策结果：{value} 分钟；模型理由：{reason}")
                return value, "ai"
        except Exception:
            continue
    print(f"⚠️ AI 时长决策未返回有效结果，采用兜底值：{fallback} 分钟")
    return fallback, "fallback"


def resolve_duration(
    manual_duration: Optional[int],
    api_call: Callable[..., Any],
    **selection_kwargs: Any,
) -> Tuple[int, str]:
    minimum = int(selection_kwargs["minimum"])
    maximum = int(selection_kwargs["maximum"])
    manual = validate_requested_duration(manual_duration, minimum, maximum)
    if manual is not None:
        return manual, "manual"
    return select_duration_with_ai(api_call, **selection_kwargs)


def _non_empty_string(value: Any, path: str, errors: List[str]) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    errors.append(f"{path} 必须是非空字符串")
    return ""


def _string_list(value: Any, path: str, errors: List[str], *, allow_empty: bool = False) -> List[str]:
    if not isinstance(value, list) or (not value and not allow_empty):
        errors.append(f"{path} 必须是{'可为空的' if allow_empty else '非空'}字符串数组")
        return []
    result: List[str] = []
    for index, item in enumerate(value):
        if isinstance(item, str) and item.strip():
            result.append(item.strip())
        else:
            errors.append(f"{path}[{index}] 必须是非空字符串")
    return result


def validate_outline(
    data: Any,
    *,
    target_minutes: int,
    evidence_types: Iterable[str],
) -> Tuple[Dict[str, Any], List[str]]:
    errors: List[str] = []
    if not isinstance(data, dict):
        return {}, ["大纲顶层必须是 JSON 对象"]
    if data.get("teaching_schema_version") != TEACHING_SCHEMA_VERSION:
        errors.append(f"teaching_schema_version 必须等于 {TEACHING_SCHEMA_VERSION}")

    _non_empty_string(data.get("topic"), "topic", errors)
    _non_empty_string(data.get("target_audience"), "target_audience", errors)
    _string_list(data.get("factuality_anchor_checklist"), "factuality_anchor_checklist", errors)

    sections = data.get("sections")
    if not isinstance(sections, list) or not sections:
        errors.append("sections 必须是非空数组")
        sections = []
    min_sections, max_sections = body_section_count_range(target_minutes)
    if sections and not min_sections <= len(sections) <= max_sections:
        errors.append(
            f"{target_minutes} 分钟视频的 sections 必须为 {min_sections}-{max_sections} 个"
            f"（封面和导览不计入），当前为 {len(sections)} 个"
        )
    section_ids: List[str] = []
    total_seconds = 0.0
    allowed = set(evidence_types)
    required = (
        "id", "title", "content", "learning_objective", "prior_knowledge_activation",
        "new_concept", "misconception_check", "bridge_to_next",
    )
    for index, section in enumerate(sections):
        path = f"sections[{index}]"
        if not isinstance(section, dict):
            errors.append(f"{path} 必须是对象")
            continue
        for field in required:
            _non_empty_string(section.get(field), f"{path}.{field}", errors)
        section_id = str(section.get("id") or "")
        if section_id in section_ids:
            errors.append(f"{path}.id 重复：{section_id}")
        section_ids.append(section_id)
        duration = section.get("estimated_duration")
        if isinstance(duration, (int, float)) and not isinstance(duration, bool) and duration > 0:
            total_seconds += float(duration)
        else:
            errors.append(f"{path}.estimated_duration 必须是正数秒")

        evidence = section.get("evidence_basis")
        if not isinstance(evidence, list) or not evidence:
            errors.append(f"{path}.evidence_basis 必须是非空数组")
        else:
            for evidence_index, item in enumerate(evidence):
                ep = f"{path}.evidence_basis[{evidence_index}]"
                if not isinstance(item, dict):
                    errors.append(f"{ep} 必须是对象")
                    continue
                _non_empty_string(item.get("claim"), f"{ep}.claim", errors)
                source_type = _non_empty_string(item.get("source_type"), f"{ep}.source_type", errors)
                _non_empty_string(item.get("anchor"), f"{ep}.anchor", errors)
                if source_type and source_type not in allowed:
                    errors.append(f"{ep}.source_type 不在允许范围：{sorted(allowed)}")

    scaffold = data.get("scaffold_map")
    if not isinstance(scaffold, list) or not scaffold:
        errors.append("scaffold_map 必须是非空数组")
    else:
        mapped_ids = []
        for index, item in enumerate(scaffold):
            path = f"scaffold_map[{index}]"
            if not isinstance(item, dict):
                errors.append(f"{path} 必须是对象")
                continue
            mapped_ids.append(_non_empty_string(item.get("section_id"), f"{path}.section_id", errors))
            for field in ("prior_knowledge", "target_concept", "bridge_strategy"):
                _non_empty_string(item.get(field), f"{path}.{field}", errors)
        if [item for item in mapped_ids if item] != [item for item in section_ids if item]:
            errors.append("scaffold_map 的 section_id 与 sections 顺序不一致")

    target_seconds = target_minutes * 60
    if sections and not (target_seconds * 0.9 <= total_seconds <= target_seconds * 1.1):
        errors.append(f"大纲预计总时长 {total_seconds:.0f} 秒，应在目标 {target_seconds} 秒的 90%-110% 内")
    return data, errors


def _validate_highlight_groups(groups: Any, line_count: int, page_limit: int, path: str, errors: List[str]) -> List[List[int]]:
    if not isinstance(groups, list) or not groups:
        errors.append(f"{path} 必须是非空索引数组")
        return []
    seen: List[int] = []
    result: List[List[int]] = []
    for group_index, group in enumerate(groups):
        if not isinstance(group, list) or not group:
            errors.append(f"{path}[{group_index}] 必须是非空索引数组")
            continue
        if len(group) > page_limit:
            errors.append(f"{path}[{group_index}] 有 {len(group)} 行，超过单页 {page_limit} 行且不可跨页")
        normalized: List[int] = []
        for raw_index in group:
            if not isinstance(raw_index, int) or isinstance(raw_index, bool) or not 0 <= raw_index < line_count:
                errors.append(f"{path}[{group_index}] 含越界或非整数索引：{raw_index!r}")
                continue
            normalized.append(raw_index)
            seen.append(raw_index)
        result.append(normalized)
    if seen != list(range(line_count)):
        errors.append(f"{path} 必须按顺序且恰好覆盖全部讲解行")
    return result


def validate_storyboard(
    data: Any,
    *,
    outline_sections: List[Dict[str, Any]],
    target_minutes: int,
    max_new_terms: int,
    solution_code: str = "",
) -> Tuple[Dict[str, Any], List[str]]:
    errors: List[str] = []
    if not isinstance(data, dict):
        return {}, ["分镜顶层必须是 JSON 对象"]
    if data.get("teaching_schema_version") != TEACHING_SCHEMA_VERSION:
        errors.append(f"teaching_schema_version 必须等于 {TEACHING_SCHEMA_VERSION}")
    sections = data.get("sections")
    if not isinstance(sections, list):
        return data, errors + ["sections 必须是数组"]
    expected_ids = [str(section.get("id") or "") for section in outline_sections]
    actual_ids = [str(section.get("id") or "") for section in sections if isinstance(section, dict)]
    if actual_ids != expected_ids:
        errors.append("分镜 sections 的 id 与大纲不一致")

    total_seconds = 0.0
    for index, section in enumerate(sections):
        path = f"sections[{index}]"
        if not isinstance(section, dict):
            errors.append(f"{path} 必须是对象")
            continue
        _non_empty_string(section.get("id"), f"{path}.id", errors)
        _non_empty_string(section.get("title"), f"{path}.title", errors)
        animations = section.get("animations")
        if not isinstance(animations, list) or not animations:
            errors.append(f"{path}.animations 必须是非空数组")
        duration = section.get("estimated_duration")
        if isinstance(duration, (int, float)) and not isinstance(duration, bool) and duration > 0:
            total_seconds += float(duration)
        else:
            errors.append(f"{path}.estimated_duration 必须是正数秒")

        lines = section.get("lecture_lines")
        if not isinstance(lines, list) or not lines:
            errors.append(f"{path}.lecture_lines 必须是非空数组")
            lines = []
        for line_index, line in enumerate(lines):
            if not isinstance(line, str) or not line.strip():
                errors.append(f"{path}.lecture_lines[{line_index}] 必须是非空字符串")
            elif len(line.strip()) > LECTURE_LINE_MAX_CHARS:
                errors.append(f"{path}.lecture_lines[{line_index}] 超过 {LECTURE_LINE_MAX_CHARS} 字")

        layout_mode = section.get("layout_mode")
        if layout_mode not in {"no_code", "with_code", "full_code"}:
            errors.append(f"{path}.layout_mode 必须是 no_code、with_code 或 full_code")
        page_limit = 4 if layout_mode in {"with_code", "full_code"} else 8
        _validate_highlight_groups(section.get("highlight_groups"), len(lines), page_limit, f"{path}.highlight_groups", errors)

        evidence_indices = section.get("evidence_lines_indices")
        if not isinstance(evidence_indices, list) or not evidence_indices:
            errors.append(f"{path}.evidence_lines_indices 必须是非空索引数组")
        else:
            for raw_index in evidence_indices:
                if not isinstance(raw_index, int) or isinstance(raw_index, bool) or not 0 <= raw_index < len(lines):
                    errors.append(f"{path}.evidence_lines_indices 含无效索引：{raw_index!r}")
        for field in ("zpd_check_line_index", "bridge_line_index"):
            raw_index = section.get(field)
            if not isinstance(raw_index, int) or isinstance(raw_index, bool) or not 0 <= raw_index < len(lines):
                errors.append(f"{path}.{field} 必须是有效讲解行索引")
        if lines and section.get("zpd_check_line_index") != 0:
            errors.append(f"{path}.zpd_check_line_index 必须指向首行")
        if lines and isinstance(section.get("bridge_line_index"), int) and section["bridge_line_index"] < max(0, len(lines) - 2):
            errors.append(f"{path}.bridge_line_index 必须位于最后两行")

        terms = _string_list(section.get("new_terms_introduced"), f"{path}.new_terms_introduced", errors, allow_empty=True)
        if len(terms) > max_new_terms:
            errors.append(f"{path}.new_terms_introduced 超过每节 {max_new_terms} 个上限")

        snippets = section.get("code_snippets", [])
        if not isinstance(snippets, list):
            errors.append(f"{path}.code_snippets 必须是数组")
            snippets = []
        if layout_mode in {"with_code", "full_code"} and not snippets:
            errors.append(f"{path}.code_snippets 在代码布局下不能为空")
        if solution_code:
            for snippet_index, snippet in enumerate(snippets):
                if not isinstance(snippet, str) or not snippet:
                    errors.append(f"{path}.code_snippets[{snippet_index}] 必须是非空字符串")
                elif snippet not in solution_code:
                    errors.append(f"{path}.code_snippets[{snippet_index}] 不是标准答案的逐字连续片段")

    target_seconds = target_minutes * 60
    if sections and not (target_seconds * 0.9 <= total_seconds <= target_seconds * 1.1):
        errors.append(f"分镜预计总时长 {total_seconds:.0f} 秒，应在目标 {target_seconds} 秒的 90%-110% 内")
    return data, errors


def max_new_terms_from_profile(profile: Any) -> int:
    parsed = getattr(profile, "parsed_profile", None) or {}
    guidance = parsed.get("stage2_storyboard_guidance", {}) if isinstance(parsed, dict) else {}
    value = guidance.get("max_new_terms_per_section", 2)
    return value if isinstance(value, int) and 1 <= value <= 5 else 2


def parse_stage5_evaluation(text: str) -> Dict[str, Any]:
    try:
        payload = json.loads(text)
    except Exception as exc:
        raise ValueError(f"教学评价 JSON 解析失败：{exc}") from exc
    dimensions = (
        "element_layout", "attractiveness", "logic_flow", "accuracy_depth",
        "learner_fit_zpd", "visual_consistency",
    )
    scores: Dict[str, float] = {}
    for name in dimensions:
        value = (payload.get(name) or {}).get("score")
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not 0 <= float(value) <= 20:
            raise ValueError(f"教学评价缺少有效分数：{name}")
        scores[name] = float(value)
    overall = payload.get("overall_score")
    if not isinstance(overall, (int, float)) or isinstance(overall, bool) or not 0 <= float(overall) <= 120:
        raise ValueError("教学评价缺少有效 overall_score")
    scores["overall_score"] = float(overall)
    unsupported = (payload.get("accuracy_depth") or {}).get("unsupported_claim_count")
    if not isinstance(unsupported, (int, float)) or isinstance(unsupported, bool) or unsupported < 0:
        raise ValueError("教学评价缺少有效 unsupported_claim_count")
    scores["unsupported_claim_count"] = float(unsupported)
    blockers = [str(item).strip() for item in (payload.get("hard_blockers") or []) if str(item).strip()]
    critical = [str(item).strip() for item in (payload.get("critical_failures") or []) if str(item).strip()]
    improvements = [str(item).strip() for item in (payload.get("improvements") or []) if str(item).strip()]
    if scores["element_layout"] < 12:
        improvements.append("[教学评价] 修复遮挡、重叠、出界、拥挤或旧元素残留。")
    if scores["logic_flow"] < 13:
        improvements.append("[教学评价] 加强已有知识激活、逐节桥接和认知检查。")
    if scores["accuracy_depth"] < 13 or unsupported:
        improvements.append("[教学评价] 删除无依据结论，使用定义、不变量、执行追踪或边界案例支撑。")
    if scores["learner_fit_zpd"] < 13:
        improvements.append("[教学评价] 先解释术语，降低单节新概念负荷并匹配学生基础。")
    if scores["overall_score"] < 76:
        improvements.append("[教学评价] 总分低于 76/120，请优先修复最低分维度。")
    improvements.extend(f"[硬阻断] {item}" for item in blockers + critical)
    meets_threshold = (
        scores["element_layout"] >= 12
        and scores["logic_flow"] >= 13
        and scores["accuracy_depth"] >= 13
        and scores["learner_fit_zpd"] >= 13
        and scores["overall_score"] >= 76
        and scores["unsupported_claim_count"] == 0
    )
    return {
        "is_good_enough": meets_threshold and not blockers and not critical,
        "reason": str(payload.get("good_enough_reason") or "").strip() or None,
        "scores": scores,
        "blockers": blockers + critical,
        "improvements": improvements,
    }


def measure_video_duration(video_path: str | Path) -> float:
    path = Path(video_path).resolve()
    if not path.exists():
        raise FileNotFoundError(path)
    ffprobe_exe = shutil.which("ffprobe")
    if not ffprobe_exe:
        raise RuntimeError("ffprobe is required for physical video duration validation")
    result = subprocess.run(
        [ffprobe_exe, "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe 测时失败：{result.stderr.strip()}")
    duration = float(result.stdout.strip())
    if duration <= 0:
        raise RuntimeError(f"无效视频时长：{duration}")
    return duration
