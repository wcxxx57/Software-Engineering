import json
import time
from functools import partial
from pathlib import Path

from prompts.user_profile import create_profile_from_text
from src.agent import RunConfig, Section, TeachingVideoAgent
from src.gpt_request import request_gpt5_token
from src.pedagogy import normalize_grouped_lecture_lines


PROBLEM_DESCRIPTION = """接雨水（Trapping Rain Water）

给定一个非负整数数组 height，其中 height[i] 表示第 i 个柱子的高度。想象为柱子围成的地形，每根柱子宽度为 1，计算在这些柱子之间能接住的总量（可容纳的闲置容量）。

输入: height = [0,1,0,2,1,0,1,3,2,1,2,1]
输出: 6

输入: height = [4,2,0,3,2,5]
输出: 9

要求：
1. 先讲清楚“为什么会积水”。
2. 结合经济管理背景（库存波动、库存高低导致的闲置能力）帮助理解。
3. 讲清双指针算法的边界含义：左侧最高与右侧最高决定当前柱子的可蓄水量。
4. 讲清边界条件与循环推进。
5. 面向非计算机背景的同学，语言自然、通俗但算法严谨。"""


SOLUTION_CODE = """from typing import List

class Solution:
    def trap(self, height: List[int]) -> int:
        # 双指针 + 两侧最高边界，O(n) 时间 O(1) 空间
        if not height:
            return 0

        left, right = 0, len(height) - 1
        left_max, right_max = 0, 0
        water = 0

        while left < right:
            if height[left] <= height[right]:
                if height[left] >= left_max:
                    left_max = height[left]
                else:
                    water += left_max - height[left]
                left += 1
            else:
                if height[right] >= right_max:
                    right_max = height[right]
                else:
                    water += right_max - height[right]
                right -= 1

        return water"""


def _load_sections(agent: TeachingVideoAgent) -> None:
    outline = json.loads((agent.output_dir / "outline.json").read_text(encoding="utf-8"))
    agent.outline = type("OutlineProxy", (), {"topic": outline["topic"]})()
    storyboard = json.loads((agent.output_dir / "storyboard.json").read_text(encoding="utf-8"))
    sections = [
        Section(
            id="section_cover",
            title=outline["topic"],
            lecture_lines=["本视频将讲解：接雨水"],
            animations=[],
            estimated_duration=10,
        ),
        Section(
            id="section_overview",
            title="解题导览",
            lecture_lines=[],
            animations=[],
            estimated_duration=20,
        ),
    ]
    for data in storyboard["sections"]:
        lecture_lines = normalize_grouped_lecture_lines(
            data.get("lecture_lines", []),
            data.get("highlight_groups"),
        )
        sections.append(
            Section(
                id=data["id"],
                title=data["title"],
                lecture_lines=lecture_lines,
                animations=data.get("animations", []),
                estimated_duration=data.get("estimated_duration"),
                highlight_groups=data.get("highlight_groups"),
                evidence_lines_indices=data.get("evidence_lines_indices"),
                zpd_check_line_index=data.get("zpd_check_line_index"),
                bridge_line_index=data.get("bridge_line_index"),
                new_terms_introduced=data.get("new_terms_introduced"),
                layout_mode=data.get("layout_mode", "no_code"),
                code_snippets=data.get("code_snippets", []),
            )
        )
    agent.sections = sections


def _latest_with_audio(output_dir: Path, section_id: str) -> str | None:
    root = output_dir / "audio_remux" / "1080p30" / section_id
    if not root.exists():
        return None
    candidates = sorted(
        root.rglob(f"{section_id}_with_audio.mp4"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    return str(candidates[0]) if candidates else None


def main() -> None:
    started = time.time()
    output_parent = Path("/app/src/CASES/API_gpt-5/88a1b127-fb1b-462e-9d73-e8ac51fdb87b")
    profile = create_profile_from_text(
        "我是经济管理专业学生，有一定 Python 基础，正在跨学科学习数据结构与算法，内容难度偏简单入门。"
    )
    cfg = RunConfig(
        api=partial(request_gpt5_token, max_retries=1),
        use_feedback=False,
        use_assets=False,
        duration=10,
        render_profile="4k30",
        preview_render_profile="1080p30",
        user_profile=profile,
        forced_difficulty_level="simple",
    )
    agent = TeachingVideoAgent(
        idx=0,
        folder=output_parent,
        cfg=cfg,
        problem_description=PROBLEM_DESCRIPTION,
        solution_code=SOLUTION_CODE,
    )
    agent.actual_render_profile = agent.preview_render_profile
    _load_sections(agent)

    target_missing = {"section_3", "section_5", "section_7"}
    section_status = {}
    render_errors = {}

    for section in agent.sections:
        existing = _latest_with_audio(agent.output_dir, section.id)
        if existing:
            agent.section_videos[section.id] = existing
            section_status[section.id] = "reuse"

    for section in agent.sections:
        if section.id not in target_missing or section.id in agent.section_videos:
            continue
        agent.section_steps[section.id] = json.loads(
            (agent.output_dir / f"{section.id}_steps.json").read_text(encoding="utf-8")
        )
        agent._install_fallback_code(section, "finalize missing section with deterministic fallback template")
        success, error = agent.debug_and_fix_code(
            section.id,
            max_fix_attempts=1,
            render_profile=agent.preview_render_profile,
            force_render=True,
            allow_code_repair=False,
        )
        if success:
            section_status[section.id] = "fallback"
        else:
            render_errors[section.id] = error

    for section in agent.sections:
        if section.id not in agent.section_videos:
            existing = _latest_with_audio(agent.output_dir, section.id)
            if existing:
                agent.section_videos[section.id] = existing
                section_status.setdefault(section.id, "reuse")

    final_video = None
    if len(agent.section_videos) == len(agent.sections):
        final_video = agent.merge_videos("接雨水_1080p30_final.mp4")

    summary = {
        "final_video": final_video,
        "section_status": section_status,
        "render_errors": render_errors,
        "warnings": agent.warnings,
        "stage_timings": agent.stage_timings,
        "actual_render_profile": agent.actual_render_profile.name,
        "requested_render_profile": agent.render_profile.name,
        "actual_duration_seconds": agent.actual_duration_seconds,
        "media_metadata": agent.media_metadata,
        "elapsed_seconds": time.time() - started,
    }
    (agent.output_dir / "finalize_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
