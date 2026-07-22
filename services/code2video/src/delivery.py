"""Success-first delivery helpers shared by the video pipeline."""

from __future__ import annotations

import ast
import json
import re
import time
from typing import Any


STYLE_TOKENS = {
    "GOLD": "#BE8944",
    "GOLD_COLOR": "#BE8944",
    "PRIMARY_COLOR": "#BE8944",
    "ACCENT_COLOR": "#C35101",
    "ORANGE": "#F28C28",
    "GREEN": "#478211",
    "RED": "#C84A2B",
    "BLUE": "#1A7F99",
    "YELLOW": "#D6A72C",
    "PURPLE": "#A98BD4",
    "MUTED_COLOR": "#8B6F5A",
    "TEXT_COLOR": "#2C1608",
    "BACKGROUND_COLOR": "#FFFDF5",
    "BG_COLOR": "#FFFDF5",
    "IMPORTANT_COLOR": "#C35101",
    "LIGHT_GOLD": "#E7C98F",
}

SCENE_METHOD_ALIASES = {
    "keep_in_right_area": "fit_right_area",
    "fit_in_right_region": "fit_right_area",
}


def _resolve_semantic_color(name: str) -> str | None:
    """Map model-invented semantic color names onto the fixed design system."""
    if name in STYLE_TOKENS:
        return STYLE_TOKENS[name]
    if not (name.endswith("_COLOR") or any(color in name for color in STYLE_TOKENS)):
        return None
    if any(word in name for word in ("BACKGROUND", "BG_")):
        return STYLE_TOKENS["BACKGROUND_COLOR"]
    if any(word in name for word in ("ERROR", "DANGER", "FAIL", "RED")):
        return STYLE_TOKENS["RED"]
    if any(word in name for word in ("SUCCESS", "GREEN")):
        return STYLE_TOKENS["GREEN"]
    if "PURPLE" in name:
        return STYLE_TOKENS["PURPLE"]
    if any(word in name for word in ("BLUE", "INFO")):
        return STYLE_TOKENS["BLUE"]
    if any(word in name for word in ("MUTED", "GRAY", "GREY", "DISABLED")):
        return STYLE_TOKENS["MUTED_COLOR"]
    if any(word in name for word in ("TEXT", "FOREGROUND")):
        return STYLE_TOKENS["TEXT_COLOR"]
    if any(word in name for word in ("GOLD", "YELLOW")):
        return STYLE_TOKENS["GOLD"]
    return STYLE_TOKENS["ACCENT_COLOR"]


def find_scene_class_name(code: str) -> str:
    """Return the concrete scene class, never the reusable TeachingScene base."""
    tree = ast.parse(code)
    candidates: list[tuple[str, bool]] = []
    for node in tree.body:
        if not isinstance(node, ast.ClassDef) or node.name in {"TeachingScene", "BaseScene"}:
            continue
        has_construct = any(
            isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)) and child.name == "construct"
            for child in node.body
        )
        if has_construct:
            inherits_teaching_scene = any(
                isinstance(base, ast.Name) and base.id == "TeachingScene" for base in node.bases
            )
            candidates.append((node.name, inherits_teaching_scene))
    if not candidates:
        raise ValueError("No concrete Scene class with construct() was found")
    validate_scene_api_calls(code, tree=tree)
    return next((name for name, preferred in candidates if preferred), candidates[-1][0])


def validate_scene_api_calls(code: str, *, tree: ast.AST | None = None) -> None:
    """Reject model-invented ``self.method()`` calls before starting Manim."""
    tree = tree or ast.parse(code)
    declared_methods = {
        child.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ClassDef)
        for child in node.body
        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef))
    }
    try:
        from manim import Scene

        inherited_methods = {
            name for name in dir(Scene) if callable(getattr(Scene, name, None))
        }
    except Exception:
        inherited_methods = {
            "add",
            "add_sound",
            "bring_to_back",
            "bring_to_front",
            "clear",
            "construct",
            "next_section",
            "play",
            "remove",
            "render",
            "wait",
        }
    allowed = declared_methods | inherited_methods
    unknown = sorted(
        {
            node.func.attr
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "self"
            and node.func.attr not in allowed
        }
    )
    if unknown:
        raise ValueError(
            "Scene code calls unavailable self methods: " + ", ".join(unknown)
        )


def normalize_known_scene_tokens(code: str) -> tuple[str, list[str]]:
    """Inject fixed semantic color tokens without asking a model to repair them."""
    fixes: list[str] = []
    if not re.search(r"^\s*from\s+manim\s+import\s+\*", code, flags=re.MULTILINE):
        code = "from manim import *\n" + code
        fixes.append("added_manim_import")

    for old_name, new_name in SCENE_METHOD_ALIASES.items():
        pattern = rf"\bself\.{re.escape(old_name)}\s*\("
        normalized, replacements = re.subn(
            pattern,
            f"self.{new_name}(",
            code,
        )
        if replacements:
            code = normalized
            fixes.append(f"normalized_{old_name}_to_{new_name}")

    referenced = set(re.findall(r"\bself\.([A-Z][A-Z0-9_]+)\b", code))
    resolved = {
        name: color
        for name in referenced
        if (color := _resolve_semantic_color(name)) is not None
    }
    used = sorted(resolved)
    if not used:
        return code, fixes

    match = re.search(r"^(?P<indent>[ \t]*)class\s+TeachingScene\s*\([^\n]+\):\s*$", code, flags=re.MULTILINE)
    if not match:
        return code, fixes

    insert_at = match.end()
    class_indent = match.group("indent") + "    "
    definitions = []
    for name in used:
        if re.search(rf"^\s+{re.escape(name)}\s*=", code, flags=re.MULTILINE):
            continue
        definitions.append(f'{class_indent}{name} = "{resolved[name]}"')
        fixes.append(f"defined_{name}")
    if definitions:
        code = code[:insert_at] + "\n" + "\n".join(definitions) + code[insert_at:]
    return code, fixes


def remaining_pipeline_seconds(started_at: float, budget_seconds: float) -> float:
    return max(0.0, float(budget_seconds) - (time.time() - float(started_at)))


def _safe_text(value: Any, limit: int = 72) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text if len(text) <= limit else text[: max(1, limit - 1)] + "…"


def generate_fallback_scene_code(
    *,
    section_id: str,
    title: str,
    section_steps: list[dict[str, Any]],
    base_class: str,
    solution_code: str = "",
) -> str:
    if not section_steps:
        raise ValueError(f"{section_id} has no narration steps for fallback rendering")
    scene_name = f"{section_id.title().replace('_', '')}Scene"
    title_json = json.dumps(_safe_text(title, 48), ensure_ascii=False)
    code_lines = [line.rstrip() for line in str(solution_code or "").splitlines() if line.strip()][:14]
    code_excerpt = "\n".join(code_lines)
    code_json = json.dumps(code_excerpt, ensure_ascii=False)
    timeline_steps = [
        {
            "highlight_indices": step.get("highlight_indices") or [],
            "audio_path": str(step.get("audio_path") or ""),
            "audio_duration": float(step.get("audio_duration") or 0.1),
        }
        for step in section_steps
    ]
    timeline_steps_json = json.dumps(timeline_steps, ensure_ascii=False)

    blocks: list[str] = []
    previous_page: Any = None
    for index, step in enumerate(section_steps):
        page_index = step.get("page_index", 0)
        page_change = ""
        if index > 0 and page_index != previous_page:
            page_change = (
                f'        self.replace_lecture_lines({json.dumps(step.get("page_screen_texts") or [], ensure_ascii=False)}, '
                f'{json.dumps(step.get("page_line_indices") or [], ensure_ascii=False)})\n'
            )
        screen_text = "；".join(step.get("screen_texts") or step.get("page_screen_texts") or [])
        screen_json = json.dumps(_safe_text(screen_text, 42), ensure_ascii=False)
        remove = f"[visual_{index - 1}]" if index else "[]"
        excerpt_block = ""
        if code_excerpt:
            excerpt_block = f'''        excerpt_{index} = Text(code_excerpt, font="Noto Sans CJK SC", font_size=13, color="#2C1608", line_spacing=0.75)
        excerpt_{index}.scale_to_fit_width(5.2)
        if excerpt_{index}.height > 2.8:
            excerpt_{index}.scale_to_fit_height(2.8)
        excerpt_{index}.next_to(progress_{index}, DOWN, buff=0.35)
        visual_{index} = VGroup(progress_{index}, excerpt_{index})
        self.fit_right_area(visual_{index})
'''
        else:
            excerpt_block = f"        visual_{index} = progress_{index}\n"
        blocks.append(f'''{page_change}        progress_bg_{index} = RoundedRectangle(width=5.5, height=1.65, corner_radius=0.18, stroke_color="#E4C8A6", stroke_width=2, fill_color="#FFF7E8", fill_opacity=0.96)
        progress_title_{index} = Text("步骤 {index + 1} / {len(section_steps)}", font="Noto Sans CJK SC", font_size=22, color="#BE8944", weight="BOLD")
        summary_{index} = Text({screen_json}, font="Noto Sans CJK SC", font_size=18, color="#2C1608")
        progress_{index} = VGroup(progress_bg_{index}, progress_title_{index}, summary_{index})
        progress_title_{index}.move_to(progress_bg_{index}.get_center() + UP * 0.35)
        summary_{index}.next_to(progress_title_{index}, DOWN, buff=0.24)
        self.fit_right_area(progress_{index})
{excerpt_block}        self.play_synced_step(steps[{index}]["highlight_indices"], steps[{index}]["audio_path"], steps[{index}]["audio_duration"], remove_at_start={remove}, show_at_start=[visual_{index}])
''')
        previous_page = page_index

    first = section_steps[0]
    return f'''from manim import *
{base_class}

class {scene_name}(TeachingScene):
    def construct(self):
        self.setup_layout({title_json}, {json.dumps(first.get("page_screen_texts") or [], ensure_ascii=False)}, {json.dumps(first.get("page_line_indices") or [], ensure_ascii=False)})
        code_excerpt = {code_json}
        steps = {timeline_steps_json}
{''.join(blocks)}
'''
