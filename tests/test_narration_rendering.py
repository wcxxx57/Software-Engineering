import ast
from pathlib import Path
from types import SimpleNamespace

import pytest

import src.audio_steps as audio_steps
from src.agent import TeachingVideoAgent
from src.api.schemas.request import RenderProfileName, VideoGenerateRequest
from src.cover_scene import generate_cover_manim_code
from src.overview_scene import build_overview_lecture_lines, generate_overview_manim_code
from src.rendering import get_render_profile, render_fingerprint


def _response(text):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=text))]
    )


def test_spoken_script_uses_neighbor_context_and_is_one_complete_sentence():
    prompts = []

    def api(prompt, max_tokens):
        prompts.append(prompt)
        return _response("由于订单紧急程度不同，我们需要让更紧急的任务先被处理。")

    spoken = audio_steps.expand_screen_text_to_spoken_script(
        "紧急订单应优先处理。",
        api,
        previous_screen_text="普通队列只看到达顺序。",
        next_screen_text="优先队列每次取出最重要的任务。",
        target_seconds=8,
    )
    assert spoken.endswith("。")
    assert spoken.count("。") == 1
    assert "上一画面分组：普通队列" in prompts[0]
    assert "下一画面分组：优先队列" in prompts[0]


def test_overview_uses_previous_narration_but_does_not_ban_suihou():
    prompts = []

    def api(prompt, max_tokens):
        prompts.append(prompt)
        return _response("随后再比较到达顺序和任务重要程度。")

    spoken = audio_steps.expand_screen_text_to_spoken_script(
        "第二部分，到达顺序与重要程度",
        api,
        previous_screen_text="第一部分，仓库订单优先级",
        previous_spoken_script="先从仓库订单的优先级出发。",
        next_screen_text="第三部分，业务规则与优先级数值",
        section_title="课程导览",
    )
    assert spoken == "随后再比较到达顺序和任务重要程度。"
    assert "上一句旁白：先从仓库订单的优先级出发。" in prompts[0]
    assert "不要求每句都有过渡词" in prompts[0]


def test_adjacent_overview_transition_is_retried_instead_of_banned():
    responses = iter(
        [
            "随后比较到达顺序和任务重要程度。",
            "比较这两个维度后，我们就能判断任务的处理先后。",
        ]
    )
    calls = []

    def api(prompt, max_tokens):
        calls.append(prompt)
        return _response(next(responses))

    spoken = audio_steps.expand_screen_text_to_spoken_script(
        "第二部分，到达顺序与重要程度",
        api,
        previous_spoken_script="随后介绍仓库订单的优先级。",
        section_title="课程导览",
        max_retries=2,
    )
    assert spoken == "比较这两个维度后，我们就能判断任务的处理先后。"
    assert len(calls) == 2


def test_build_steps_keeps_single_line_group_and_one_audio_per_group(tmp_path, monkeypatch):
    section = SimpleNamespace(
        id="section_demo",
        title="优先队列",
        lecture_lines=["普通队列按到达顺序。", "紧急订单应优先。", "每次只取最重要的任务。"],
        highlight_groups=[[0], [1, 2]],
        layout_mode="no_code",
    )
    scripts = iter(["普通队列会严格按照任务的到达顺序处理。", "面对紧急订单时，优先队列每次只取出当前最重要的任务。"])
    previous_scripts = []

    def fake_expand(*args, **kwargs):
        previous_scripts.append(kwargs.get("previous_spoken_script", ""))
        return next(scripts)

    monkeypatch.setattr(audio_steps, "expand_screen_text_to_spoken_script", fake_expand)

    def fake_tts(text, output_path, max_retries):
        Path(output_path).write_bytes(text.encode("utf-8"))
        return Path(output_path)

    monkeypatch.setattr(audio_steps, "synthesize_tts_audio", fake_tts)
    monkeypatch.setattr(audio_steps, "measure_audio_duration", lambda path: 4.0)
    steps = audio_steps.build_section_steps(section, tmp_path, lambda *args, **kwargs: None, target_audio_seconds=8)
    assert [step["highlight_indices"] for step in steps] == [[0], [1, 2]]
    assert steps[1]["screen_text"] == "紧急订单应优先。\n每次只取最重要的任务。"
    assert len(list((tmp_path / "audio" / section.id).glob("*.wav"))) == 2
    assert previous_scripts == ["", steps[0]["spoken_script"]]


def test_failed_step_rebuild_preserves_previous_audio_cache(tmp_path, monkeypatch):
    section = SimpleNamespace(
        id="section_demo",
        title="demo",
        lecture_lines=["first.", "second."],
        highlight_groups=[[0], [1]],
        layout_mode="no_code",
    )
    old_audio_dir = tmp_path / "audio" / section.id
    old_audio_dir.mkdir(parents=True)
    (old_audio_dir / "step_00.wav").write_bytes(b"previous-complete-cache")
    monkeypatch.setattr(
        audio_steps,
        "expand_screen_text_to_spoken_script",
        lambda *args, **kwargs: "Complete narration sentence.",
    )
    calls = 0

    def interrupted_tts(text, output_path, max_retries):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("interrupted")
        Path(output_path).write_bytes(b"new-but-incomplete")
        return Path(output_path)

    monkeypatch.setattr(audio_steps, "synthesize_tts_audio", interrupted_tts)
    monkeypatch.setattr(audio_steps, "measure_audio_duration", lambda path: 4.0)
    with pytest.raises(RuntimeError, match="interrupted"):
        audio_steps.build_section_steps(section, tmp_path, lambda *args, **kwargs: None)
    assert (old_audio_dir / "step_00.wav").read_bytes() == b"previous-complete-cache"
    assert not list((tmp_path / "audio").glob("*.building"))


def test_cached_audio_repair_only_rebuilds_missing_or_mismatched_steps(tmp_path, monkeypatch):
    good = tmp_path / "good.wav"
    stale = tmp_path / "stale.wav"
    good.write_bytes(b"good")
    stale.write_bytes(b"stale")
    calls = []

    def fake_duration(path):
        return 1.0 if Path(path).read_bytes() in {b"good", b"repaired"} else 2.0

    def fake_tts(text, output_path, max_retries):
        calls.append(text)
        Path(output_path).write_bytes(b"repaired")
        return Path(output_path)

    monkeypatch.setattr(audio_steps, "measure_audio_duration", fake_duration)
    monkeypatch.setattr(audio_steps, "synthesize_tts_audio", fake_tts)
    steps = [
        {"audio_path": str(good), "audio_duration": 1.0, "spoken_script": "keep"},
        {"audio_path": str(stale), "audio_duration": 1.0, "spoken_script": "repair"},
    ]
    assert audio_steps.repair_cached_step_audio(steps) is True
    assert calls == ["repair"]
    assert good.read_bytes() == b"good"
    assert stale.read_bytes() == b"repaired"


def test_render_fingerprint_includes_code_audio_bytes_and_profile(tmp_path):
    audio = tmp_path / "voice.wav"
    audio.write_bytes(b"first")
    steps = [{"audio_path": str(audio), "audio_duration": 1.0, "spoken_script": "一句话。", "highlight_indices": [0]}]
    first = render_fingerprint("code-a", steps, get_render_profile("4k30"))
    audio.write_bytes(b"second")
    assert render_fingerprint("code-a", steps, get_render_profile("4k30")) != first
    assert render_fingerprint("code-b", steps, get_render_profile("4k30")) != first
    assert render_fingerprint("code-a", steps, get_render_profile("1080p30")) != first


def test_api_defaults_to_native_4k30_and_rejects_unknown_profile():
    request = VideoGenerateRequest(knowledge_point="优先队列")
    assert request.render_profile is RenderProfileName.UHD_4K30
    profile = get_render_profile(request.render_profile.value)
    assert (profile.width, profile.height, profile.fps) == (3840, 2160, 30)
    with pytest.raises(ValueError):
        VideoGenerateRequest(knowledge_point="优先队列", render_profile="720p")


def test_templates_have_no_raw_audio_wait_or_play_padding():
    steps = [{"audio_path": "/tmp/a.wav", "audio_duration": 4.0, "highlight_indices": [0]}]
    cover = generate_cover_manim_code("优先队列与二叉堆", "优先队列", steps)
    assert "self.play_narrated_step(" in cover
    assert "self.add(upper_line, title, subtitle, lower_line)" in cover
    assert cover.index("self.add(upper_line, title, subtitle, lower_line)") < cover.index(
        "self.play_narrated_step("
    )
    assert "FadeIn(title" not in cover
    assert "FadeIn(subtitle" not in cover
    assert "Create(upper_line)" not in cover
    assert "self.add_sound(" not in cover
    assert "self.wait(" not in cover
    assert "self.play(" not in cover

    lines = build_overview_lecture_lines(["优先队列", "二叉堆"])
    assert lines == ["第一部分，优先队列", "第二部分，二叉堆"]
    overview_steps = [
        {"audio_path": f"/tmp/{index}.wav", "audio_duration": 4.0, "highlight_indices": [index]}
        for index in range(2)
    ]
    overview = generate_overview_manim_code(["优先队列", "二叉堆"], overview_steps)
    assert overview.count("self.play_synced_step(") == 2
    assert "self.add_sound(" not in overview
    assert "self.wait(" not in overview
    assert "self.play(" not in overview

    paged_steps = [
        {"audio_path": f"/tmp/{index}.wav", "audio_duration": 1.0}
        for index in range(7)
    ]
    paged = generate_overview_manim_code(
        [f"章节{index}" for index in range(7)],
        paged_steps,
    )
    assert "self.remove(*bullets)" in paged
    assert "self.remove(bullets)" not in paged


def test_generated_scene_validator_rejects_raw_timeline_padding():
    agent = TeachingVideoAgent.__new__(TeachingVideoAgent)
    valid = """
class DemoScene(TeachingScene):
    def construct(self):
        self.play_synced_step([0], steps[0][\"audio_path\"], steps[0][\"audio_duration\"])
"""
    assert agent._validate_synced_step_coverage(valid, 1) == (True, "")
    raw_play = """
class DemoScene(TeachingScene):
    def construct(self):
        self.play_synced_step([0], steps[0][\"audio_path\"], steps[0][\"audio_duration\"])
        self.play(FadeIn(x))
"""
    ok, error = agent._validate_synced_step_coverage(raw_play, 1)
    assert ok is False
    assert "raw self.play" in error
