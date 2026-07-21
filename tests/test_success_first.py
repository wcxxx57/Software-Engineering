from pathlib import Path
from types import MethodType, SimpleNamespace

from src.agent import RunConfig, TeachingVideoAgent
from src.delivery import (
    estimate_native_4k_seconds,
    find_scene_class_name,
    normalize_known_scene_tokens,
)
from src.rendering import get_render_profile


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
    agent.render_profile = get_render_profile("4k30")
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


def test_duration_miss_returns_steps_with_warning_after_three_attempts(tmp_path):
    agent = _bare_agent(tmp_path)

    def prepare(self, section, **kwargs):
        return [{"audio_duration": 1.0}]

    agent.prepare_section_steps = MethodType(prepare, agent)
    steps = agent.prepare_all_narration_steps(max_rounds=99)
    assert steps["section_1"][0]["audio_duration"] == 1.0
    assert agent.retry_summary["narration_attempts"] == 3
    assert any(item["code"] == "duration_target_missed" for item in agent.warnings)


def test_section_render_builds_1080p_baseline_before_4k(tmp_path):
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


def test_native_estimate_uses_measured_preview_cost():
    assert estimate_native_4k_seconds([10, 20], workers=1) == 240
