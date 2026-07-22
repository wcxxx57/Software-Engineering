"""
Cover Scene Generator — 视频封面模板

在视频最开头生成一个确定性的封面 Section，展示题目短名 + 副标题。

视觉设计：
- 135° 对角线渐变背景（#fff6db → #f9ebe4 → #fbd9c4）
- 大标题：题目短名（如"二分搜索"），深棕色加粗大字
- 副标题：完整题目名称或解题主题，稍小字体
- 上下两条装饰线，Create 动画从中心展开
- 有旁白 TTS：播放题目讲解开场语音频

本模块不依赖 LLM，确定性模板保证 100% 成功率。
"""

from __future__ import annotations

import json


def generate_cover_manim_code(topic: str, short_title: str, section_steps: list) -> str:
    """
    生成封面 section 的完整 Manim 代码（确定性模板，不依赖 LLM）。

    视觉设计：
    1. 全屏 135° 渐变背景矩形（#fff6db → #f9ebe4 → #fbd9c4）
    2. 上装饰线从中心向两侧 Create 展开
    3. 大标题（短名称）居中 FadeIn
    4. 副标题（完整名称）在大标题下方 FadeIn
    5. 下装饰线从中心向两侧 Create 展开
    6. 播放介绍旁白，停留展示
    7. 淡出

    Args:
        topic: 完整题目名称或解题主题（副标题）
        short_title: 题目短名（大标题，如"二分搜索"）
        section_steps: 已构建的 section steps（含 audio_path, audio_duration）

    Returns:
        完整的 Python/Manim 代码字符串
    """
    safe_topic = topic.replace('"', '\\"').replace("'", "\\'")
    safe_short_title = short_title.replace('"', '\\"').replace("'", "\\'")

    code = f'''from manim import *
import numpy as np

{_get_base_class_import()}

class CoverScene(TeachingScene):
    def construct(self):
        steps = {json.dumps(section_steps, ensure_ascii=False)}

        # ── 渐变背景（135°，左上到右下）──
        self.camera.background_color = "#f9ebe4"

        bg = Rectangle(
            width=20, height=12,
            fill_opacity=1.0,
            stroke_width=0,
        )
        bg.set_fill(color=["#fff6db", "#f9ebe4", "#fbd9c4"])
        bg.set_sheen_direction(DR)
        bg.move_to(ORIGIN)
        bg.set_z_index(0)
        self.add(bg)

        # ── 大标题（短名称，居中）──
        title = Text(
            "{safe_short_title}",
            font="Noto Sans CJK SC",
            font_size=60,
            color="#7B4B2A",
            weight="BOLD",
        )
        if title.width > 12.2:
            title.scale_to_fit_width(12.2)
        title.set_z_index(5)
        title.move_to(UP * 0.5)

        # ── 副标题（完整名称）──
        subtitle = Text(
            "{safe_topic}",
            font="Noto Sans CJK SC",
            font_size=28,
            color="#8B5E3C",
        )
        if subtitle.width > 12.2:
            subtitle.scale_to_fit_width(12.2)
        subtitle.set_z_index(5)
        subtitle.next_to(title, DOWN, buff=0.5)

        # ── 装饰线 ──
        line_width = min(max(title.width, subtitle.width) + 1.5, 13.2)
        line_width = max(line_width, 5.0)
        half_width = line_width / 2

        upper_line = Line(
            start=LEFT * half_width,
            end=RIGHT * half_width,
            color="#e4c8a6",
            stroke_width=2.5,
        )
        upper_line.next_to(title, UP, buff=0.6)

        lower_line = Line(
            start=LEFT * half_width,
            end=RIGHT * half_width,
            color="#e4c8a6",
            stroke_width=2.5,
        )
        lower_line.next_to(subtitle, DOWN, buff=0.6)

        # 第 0 秒就是完整封面；旁白期间不隐藏、不重新播放入场动画。
        if not steps:
            raise ValueError("Cover narration step is required")
        self.add(upper_line, title, subtitle, lower_line)
        self.play_narrated_step(steps[0]["audio_path"], steps[0]["audio_duration"])
'''

    return code


def _get_base_class_import() -> str:
    """返回空字符串，让 agent.py 的 replace_base_class 统一处理。"""
    return ""
