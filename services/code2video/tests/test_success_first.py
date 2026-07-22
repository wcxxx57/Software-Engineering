import ast
import subprocess
import sys
import time
from pathlib import Path
from types import MethodType, SimpleNamespace

import psutil
import pytest

from src.agent import RunConfig, TeachingVideoAgent
import src.agent as agent_module
from prompts.base_class import base_class
from src.cover_scene import generate_cover_manim_code
from src.audio_steps import _timeline_events_from_statements
from src.delivery import (
    find_scene_class_name,
    generate_fallback_scene_code,
    normalize_known_scene_tokens,
    validate_scene_api_calls,
)
from src.rendering import (
    get_render_profile,
    get_render_timeout_seconds,
    run_process_with_tree_timeout,
)
from src.utils import replace_base_class


def _bare_agent(tmp_path: Path) -> TeachingVideoAgent:
    agent = TeachingVideoAgent.__new__(TeachingVideoAgent)
    agent.duration = 10
    agent.max_repair_attempts = 2
    agent.max_attempts = 3
    agent.sections = [SimpleNamespace(id="section_1", estimated_duration=1)]
    agent.section_steps = {"section_1": [{"audio_duration": 1.0}]}
    agent.section_codes = {"section_1": "code"}
    agent.section_videos = {}
    agent.preview_video_paths = {}
    agent.preview_render_seconds = []
    agent.output_dir = tmp_path
    agent.learning_topic = "测试题目"
    agent.use_feedback = False
    agent.preview_render_profile = get_render_profile("1080p30")
    agent.render_profile = get_render_profile("1080p30")
    agent.requested_render_profile = agent.render_profile
    agent.actual_render_profile = agent.render_profile
    agent.warnings = []
    agent.retry_summary = {"max_repair_attempts": 2}
    agent.pinned_final_reused = set()
    return agent


def test_retry_defaults_are_initial_plus_two_repairs():
    cfg = RunConfig()
    assert cfg.max_repair_attempts == 2
    assert cfg.max_regenerate_tries == 3
    assert cfg.max_fix_bug_tries == 3
    assert cfg.feedback_rounds == 2
    assert cfg.max_feedback_gen_code_tries == 1


def test_automatic_duration_is_limited_to_five_to_eight_minutes(monkeypatch):
    captured = {}

    def select_duration(api_call, **kwargs):
        captured.update(kwargs)
        return kwargs["maximum"], "ai"

    monkeypatch.setattr(agent_module, "select_duration_with_ai", select_duration)
    agent = TeachingVideoAgent.__new__(TeachingVideoAgent)
    agent.duration = None
    agent.duration_source = None
    agent.user_profile = SimpleNamespace(parsed_profile={})
    agent.learning_topic = "Two Sum"
    agent.problem_description = "Find two indices"
    agent._request_api_and_track_tokens = lambda *args, **kwargs: None

    agent._ensure_duration_resolved()

    assert agent.duration == 8
    assert agent.duration_source == "ai"
    assert captured["minimum"] == 5
    assert captured["maximum"] == 8
    assert captured["fallback"] == 7


def test_duration_miss_returns_steps_with_warning_after_three_attempts(tmp_path):
    agent = _bare_agent(tmp_path)

    def prepare(self, section, **kwargs):
        return [{"audio_duration": 1.0}]

    agent.prepare_section_steps = MethodType(prepare, agent)
    steps = agent.prepare_all_narration_steps(max_rounds=99)
    assert steps["section_1"][0]["audio_duration"] == 1.0
    assert agent.retry_summary["narration_attempts"] == 3
    assert any(item["code"] == "duration_target_missed" for item in agent.warnings)


def test_section_render_uses_single_1080p_tier(tmp_path):
    agent = _bare_agent(tmp_path)
    preview = tmp_path / "preview.mp4"
    profiles = []

    def render(self, section_id, *, render_profile, **kwargs):
        profiles.append(render_profile.name)
        self.section_videos[section_id] = str(preview)
        return True, None

    agent.debug_and_fix_code = MethodType(render, agent)
    assert agent.render_section(SimpleNamespace(id="section_1"), run_feedback=False) is True
    assert profiles == ["1080p30"]
    assert agent.section_videos["section_1"] == str(preview)
    assert agent.actual_render_profile.name == "1080p30"


def test_scene_preflight_selects_concrete_scene_and_fills_known_token():
    code = """from manim import *
class TeachingScene(Scene):
    pass
class Lesson(TeachingScene):
    def construct(self):
        self.add(Text('ok', color=self.GOLD))
"""
    normalized, fixes = normalize_known_scene_tokens(code)
    assert find_scene_class_name(normalized) == "Lesson"
    assert "defined_GOLD" in fixes
    assert 'GOLD = "#BE8944"' in normalized


def test_scene_preflight_maps_model_invented_semantic_colors_locally():
    code = """from manim import *
class TeachingScene(Scene):
    pass
class Lesson(TeachingScene):
    def construct(self):
        self.add(Text('important', color=self.IMPORTANT_COLOR))
        self.add(Text('summary', color=self.LIGHT_GOLD))
"""
    normalized, fixes = normalize_known_scene_tokens(code)
    assert "defined_IMPORTANT_COLOR" in fixes
    assert "defined_LIGHT_GOLD" in fixes
    assert 'IMPORTANT_COLOR = "#C35101"' in normalized
    assert 'LIGHT_GOLD = "#E7C98F"' in normalized


def test_scene_preflight_normalizes_known_layout_alias():
    code = """from manim import *
class TeachingScene(Scene):
    def fit_right_area(self, mobject):
        return mobject
class Lesson(TeachingScene):
    def construct(self):
        self.keep_in_right_area(VGroup())
"""
    normalized, fixes = normalize_known_scene_tokens(code)
    assert "self.fit_right_area(VGroup())" in normalized
    assert "normalized_keep_in_right_area_to_fit_right_area" in fixes
    assert find_scene_class_name(normalized) == "Lesson"


def test_scene_preflight_normalizes_fit_in_right_region_alias():
    code = """from manim import *
class TeachingScene(Scene):
    def fit_right_area(self, mobject):
        return mobject
class Lesson(TeachingScene):
    def construct(self):
        self.fit_in_right_region(VGroup())
"""
    normalized, fixes = normalize_known_scene_tokens(code)
    assert "self.fit_right_area(VGroup())" in normalized
    assert "normalized_fit_in_right_region_to_fit_right_area" in fixes
    assert find_scene_class_name(normalized) == "Lesson"


def test_fallback_scene_uses_supported_right_area_helper():
    code = generate_fallback_scene_code(
        section_id="section_8",
        title="Complexity",
        section_steps=[
            {
                "screen_texts": ["O(n) time"],
                "page_screen_texts": ["O(n) time"],
                "page_line_indices": [0],
                "audio_path": "/tmp/step.wav",
                "audio_duration": 1.0,
            }
        ],
        base_class="class TeachingScene(Scene):\n    def fit_right_area(self, mobject):\n        return mobject\n",
        solution_code="return []",
    )
    assert "fit_in_right_region" not in code
    assert "self.fit_right_area(" in code
    assert 'steps[0]["audio_path"]' in code

    tree = ast.parse(code)
    scene = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "Section8Scene")
    construct = next(node for node in scene.body if isinstance(node, ast.FunctionDef) and node.name == "construct")
    events = []
    _timeline_events_from_statements(construct.body, 1, events, {})
    assert events == [("audio", 0.0)]


def test_narration_timeline_resolves_simple_step_alias():
    tree = ast.parse(
        '''
def construct(self):
    step = steps[1]
    self.play_synced_step(step["highlight_indices"], step["audio_path"], step["audio_duration"])
'''
    )
    events = []
    _timeline_events_from_statements(tree.body[0].body, 3, events, {})
    assert events == [("audio", 1.0)]


def test_render_timeout_is_fixed_to_1080p(monkeypatch):
    monkeypatch.delenv("MANIM_RENDER_TIMEOUT_SECONDS", raising=False)
    monkeypatch.setenv("MANIM_RENDER_TIMEOUT_1080P_SECONDS", "321")
    assert get_render_timeout_seconds(get_render_profile("1080p30")) == 321
    with pytest.raises(ValueError, match="1080p30"):
        get_render_profile("4k30")


def test_renderer_timeout_terminates_descendant_process_tree(tmp_path):
    child_pid_path = tmp_path / "child.pid"
    script = (
        "import pathlib, subprocess, sys, time; "
        "child=subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)']); "
        f"pathlib.Path({str(child_pid_path)!r}).write_text(str(child.pid)); "
        "time.sleep(60)"
    )
    with pytest.raises(subprocess.TimeoutExpired):
        run_process_with_tree_timeout(
            [sys.executable, "-c", script],
            timeout_seconds=1,
            kill_grace_seconds=0.5,
        )
    child_pid = int(child_pid_path.read_text())
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline and psutil.pid_exists(child_pid):
        try:
            if psutil.Process(child_pid).status() == psutil.STATUS_ZOMBIE:
                break
        except psutil.NoSuchProcess:
            break
        time.sleep(0.05)
    assert not psutil.pid_exists(child_pid) or psutil.Process(child_pid).status() == psutil.STATUS_ZOMBIE


def test_scene_preflight_rejects_unknown_model_helper():
    code = """from manim import *
class TeachingScene(Scene):
    pass
class Lesson(TeachingScene):
    def construct(self):
        self.make_array()
"""
    try:
        validate_scene_api_calls(code)
    except ValueError as exc:
        assert "make_array" in str(exc)
    else:
        raise AssertionError("unknown scene helper should fail preflight")


def test_cover_scene_inherits_injected_teaching_scene():
    code = generate_cover_manim_code(
        topic="Two Sum",
        short_title="Hash Map",
        section_steps=[{"audio_path": "/tmp/cover.wav", "audio_duration": 1.0}],
    )
    code = replace_base_class(code, base_class)
    assert "class TeachingScene(Scene):" in code
    assert "class CoverScene(TeachingScene):" in code
    assert "def play_narrated_step(" in code
    assert find_scene_class_name(code) == "CoverScene"


