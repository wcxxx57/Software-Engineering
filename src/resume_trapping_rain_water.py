import json
import time
from functools import partial
from pathlib import Path

from prompts.user_profile import create_profile_from_text
from src.agent import RunConfig, TeachingVideoAgent
from src.gpt_request import request_gpt5_token


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


def main() -> None:
    started = time.time()
    output_parent = Path("/app/src/CASES/API_gpt-5/88a1b127-fb1b-462e-9d73-e8ac51fdb87b")
    profile = create_profile_from_text(
        "我是经济管理专业学生，有一定 Python 基础，正在跨学科学习数据结构与算法，内容难度偏简单入门。"
    )
    cfg = RunConfig(
        api=partial(request_gpt5_token, max_retries=1),
        use_feedback=True,
        use_assets=False,
        max_code_token_length=10000,
        max_fix_bug_tries=3,
        max_regenerate_tries=3,
        max_feedback_gen_code_tries=1,
        max_mllm_fix_bugs_tries=1,
        feedback_rounds=2,
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
    final_video = agent.GENERATE_VIDEO()
    summary = {
        "final_video": final_video,
        "stage_timings": agent.stage_timings,
        "warnings": agent.warnings,
        "retry_summary": agent.retry_summary,
        "section_fallbacks": agent.section_fallbacks,
        "visual_quality_results": agent.visual_quality_results,
        "actual_render_profile": agent.actual_render_profile.name,
        "requested_render_profile": agent.render_profile.name,
        "actual_duration_seconds": agent.actual_duration_seconds,
        "media_metadata": agent.media_metadata,
        "elapsed_seconds": time.time() - started,
    }
    summary_path = agent.output_dir / "resume_summary.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
