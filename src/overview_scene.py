"""
Overview Scene Generator — 视频概述/解题导览模板

在视频最开始生成一个确定性的概述 Section，快速预览本题将讲些什么。

设计理念参考：
- 教学视频开头展示解题导览
- 简要预览整体讲解路径
- 先行组织者理论：先建立结构，再进入细节

本模块不依赖 LLM 生成 Manim 代码，而是用确定性模板保证 100% 成功率。
旁白文本仍走正常 TTS 管线（expand → TTS → 物理测时）。

Section titles 合并精简由 AI 完成（_merge_section_titles_with_ai），
保证 overview 简洁有效，每页最多 6 条。
"""

from __future__ import annotations

import json
import re
from typing import Callable, List


BULLETS_PER_PAGE = 6

_CIRCLED_NUMBERS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"

_ORDINAL_WORDS = [
    "第一", "第二", "第三", "第四", "第五",
    "第六", "第七", "第八", "第九", "第十",
    "第十一", "第十二", "第十三", "第十四", "第十五",
    "第十六", "第十七", "第十八", "第十九", "第二十",
]

OVERVIEW_INTRO_LINE = "本题将分为以下几个部分进行讲解"
OVERVIEW_ENDING_LINE = "好的，接下来让我们正式开始具体题目的讲解吧"


def _circled(n: int) -> str:
    if 1 <= n <= len(_CIRCLED_NUMBERS):
        return _CIRCLED_NUMBERS[n - 1]
    return f"({n})"


def _ordinal(n: int) -> str:
    if 1 <= n <= len(_ORDINAL_WORDS):
        return _ORDINAL_WORDS[n - 1]
    return f"第{n}"


def _merge_section_titles_with_ai(
    section_titles: List[str],
    topic: str,
    api_func: Callable,
    max_retries: int = 3,
) -> List[str]:
    titles_json = json.dumps(section_titles, ensure_ascii=False)

    prompt = f"""你是编程题讲解视频大纲精简器。

任务：将以下章节标题列表合并精简为适合"解题导览"页面的概要列表。

规则：
1. 将内容相似或连续的章节合并为一条高层概要
   例如："执行追踪（一）：xxx"和"执行追踪（二）：yyy"合并为"执行追踪"
   例如："完整源代码（第1部分）"、"完整源代码（第2部分）"、"完整源代码（第3部分）"合并为"完整源代码"
2. 如果原标题是“前缀 - 后缀”或“前缀：后缀”结构，优先保留“前缀 ： 关键限定后缀”
   例如："思路分析 - 为什么用前缀预处理" 应保留为 "思路分析：为什么用前缀预处理"
   例如："算法核心思想 - 搜索空间收缩" 应保留为 "算法核心思想：搜索空间收缩"
3. 但如果后缀只是收尾性质或泛化概括，不要强行保留后缀
   例如："完整源代码"、"完整代码回顾"、"进阶思考与总结回顾" 这类标题应简化为更自然的高层标题
4. 最终条目数控制在 5-12 条
5. 每条尽量控制在 15 个中文字符以内
6. 不引入新内容，只能合并/简化原标题
7. 如果某条标题与视频主题"{topic}"完全相同或高度重复，则删除该条
8. 去掉原始编号，直接输出标题文本
9. 输出格式：JSON 字符串数组，例如 ["标题1", "标题2", ...]

章节标题列表：
{titles_json}

请直接输出 JSON 数组，不要添加任何其他文字："""

    for attempt in range(1, max_retries + 1):
        try:
            response = api_func(prompt, max_tokens=500)
            try:
                content = response.candidates[0].content.parts[0].text
            except Exception:
                try:
                    content = response.choices[0].message.content
                except Exception:
                    content = str(response)

            content = content.strip()
            if content.startswith("```"):
                content = re.sub(r"^```[a-zA-Z0-9_-]*\s*", "", content)
                content = re.sub(r"\s*```$", "", content)
            content = content.strip()

            merged = json.loads(content)
            if isinstance(merged, list) and len(merged) >= 3:
                return [str(t) for t in merged]
        except Exception as e:
            print(f"⚠️ AI 合并 section titles 第 {attempt} 次失败: {e}")
            if attempt >= max_retries:
                break

    return _merge_section_titles_fallback(section_titles, topic)


def _merge_section_titles_fallback(
    section_titles: List[str],
    topic: str,
) -> List[str]:
    """
    规则兜底：将连续相同前缀的标题合并。

    合并逻辑：
    - 取冒号/括号前的前缀，连续相同前缀的条目合并为一条
    - 跳过与 topic 重复的条目
    """
    import re as _re

    def _get_prefix(title: str) -> str:
        # 取冒号前的部分作为前缀
        for sep in ["：", ":"]:
            if sep in title:
                prefix = title.split(sep)[0]
                # 去掉括号内容
                prefix = _re.sub(r"[（(][^）)]*[）)]", "", prefix).strip()
                return prefix
        return title.strip()

    merged = []
    prev_prefix = None

    for title in section_titles:
        # 跳过与 topic 重复的
        if title.strip() == topic.strip():
            continue

        prefix = _get_prefix(title)
        if prefix == prev_prefix and merged:
            # 相同前缀，跳过（已经有了）
            continue
        else:
            # 使用精简的前缀作为标题
            if prefix != title:
                merged.append(prefix)
            else:
                merged.append(title)
            prev_prefix = prefix

    return merged if merged else section_titles


def build_overview_lecture_lines(
    section_titles: List[str],
) -> List[str]:
    lines: List[str] = []
    lines.append(OVERVIEW_INTRO_LINE)

    for idx, title in enumerate(section_titles, start=1):
        lines.append(f"{_ordinal(idx)}部分，{title}")

    lines.append(OVERVIEW_ENDING_LINE)
    return lines


def generate_overview_manim_code(
    section_titles: List[str],
    section_steps: List[dict],
) -> str:
    all_bullet_texts = []
    for idx, title in enumerate(section_titles, start=1):
        all_bullet_texts.append(f"{_circled(idx)} {title}")

    num_steps = len(section_steps)
    num_bullets = len(all_bullet_texts)

    pages: List[List[int]] = []
    for start in range(0, num_bullets, BULLETS_PER_PAGE):
        end = min(start + BULLETS_PER_PAGE, num_bullets)
        pages.append(list(range(start, end)))

    num_pages = len(pages)

    bullet_creation_lines = []
    for i, bt in enumerate(all_bullet_texts):
        safe_bt = bt.replace('"', '\\"').replace("'", "\\'")
        bullet_creation_lines.append(
            f'        bullet_{i} = Text("{safe_bt}", font="Noto Sans CJK SC", font_size=22, color="#2C1608")'
        )
    bullet_creation_code = "\n".join(bullet_creation_lines)

    page_animation_blocks = []
    for page_idx, page_bullet_indices in enumerate(pages):
        block_lines = []

        if page_idx == 0:
            page_bullet_names = [f"bullet_{i}" for i in page_bullet_indices]
            block_lines.append(f"        # ── 第 {page_idx + 1} 页（共 {num_pages} 页）──")
            block_lines.append(f"        bullets = VGroup({', '.join(page_bullet_names)}).arrange(DOWN, center=True, buff=0.35)")
            block_lines.append(f"        bullets.next_to(underline, DOWN, buff=0.5)")
            block_lines.append(f"        if bullets.get_bottom()[1] < -3.5:")
            block_lines.append(f"            bullets.scale_to_fit_height(5.0)")
            block_lines.append(f"            bullets.next_to(underline, DOWN, buff=0.5)")
            block_lines.append(f"        self.lecture = bullets")
        else:
            page_bullet_names = [f"bullet_{i}" for i in page_bullet_indices]
            block_lines.append(f"\n        # ── 第 {page_idx + 1} 页（共 {num_pages} 页）──")
            block_lines.append(f"        self.remove(*bullets)")
            block_lines.append(f"        bullets = VGroup({', '.join(page_bullet_names)}).arrange(DOWN, center=True, buff=0.35)")
            block_lines.append(f"        bullets.next_to(underline, DOWN, buff=0.5)")
            block_lines.append(f"        if bullets.get_bottom()[1] < -3.5:")
            block_lines.append(f"            bullets.scale_to_fit_height(5.0)")
            block_lines.append(f"            bullets.next_to(underline, DOWN, buff=0.5)")
            block_lines.append(f"        self.lecture = bullets")

        block_lines.append(
            f"        self.current_lecture_line_indices = list(range({len(page_bullet_indices)}))"
        )

        for local_idx, bullet_global_idx in enumerate(page_bullet_indices):
            step_idx = bullet_global_idx + 1
            block_lines.append(f"\n        # 第 {bullet_global_idx + 1} 个要点")
            block_lines.append(f"        self.play_synced_step(")
            block_lines.append(f"            {local_idx},")
            block_lines.append(f"            steps[{step_idx}][\"audio_path\"],")
            block_lines.append(f"            steps[{step_idx}][\"audio_duration\"],")
            block_lines.append(f"            FadeIn(bullet_{bullet_global_idx}, shift=RIGHT * 0.3),")
            block_lines.append(f"        )")

        page_animation_blocks.append("\n".join(block_lines))

    page_animation_code = "\n".join(page_animation_blocks)
    last_step_idx = num_steps - 1

    code = f'''from manim import *
import numpy as np

{_get_base_class_import()}

class SectionOverviewScene(TeachingScene):
    def construct(self):
        steps = {json.dumps(section_steps, ensure_ascii=False)}

        # ── 背景色 ──
        self.camera.background_color = "#FFFDF4"

        # ── 标题 ──
        page_title = Text("解题导览", font="Noto Sans CJK SC", font_size=28, color="#BE8944", weight="BOLD")
        page_title.to_edge(UP, buff=0.5)

        # ── 副标题 "本题内容" ──
        subtitle = Text("本题内容", font="Noto Sans CJK SC", font_size=24, color="#7B4B2A", weight="BOLD")
        subtitle.move_to([0, 2.0, 0])

        # 下划线装饰
        underline = Line(
            start=subtitle.get_left() + DOWN * 0.2,
            end=subtitle.get_right() + DOWN * 0.2,
            color="#e4c8a6",
            stroke_width=2,
        )

        # 创建全部 bullet Text 对象
{bullet_creation_code}

        # 标题是结构性画面文字，不是字幕；先稳定显示，再播放完整导览旁白。
        self.add(page_title, subtitle, underline)
        self.play_narrated_step(steps[0]["audio_path"], steps[0]["audio_duration"])

        # ── 分页展示全部章节 ──
{page_animation_code}

        # ── 结束语旁白（不显示文字，只播放声音）──
        self.play_narrated_step(
            steps[{last_step_idx}]["audio_path"],
            steps[{last_step_idx}]["audio_duration"],
        )
'''

    return code


def _get_base_class_import() -> str:
    return ""
