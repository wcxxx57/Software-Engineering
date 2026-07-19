import sys
import os
import imageio_ffmpeg

# Add project root to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 安全地设置编码（兼容 Celery Worker 环境）
try:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass  # 在 Celery Worker 中可能会失败，忽略即可

# Ensure ffmpeg is in PATH for Manim and other subprocesses
FFMPEG_PATH = imageio_ffmpeg.get_ffmpeg_exe()
FFMPEG_DIR = os.path.dirname(FFMPEG_PATH)
if FFMPEG_DIR not in os.environ["PATH"]:
    os.environ["PATH"] = FFMPEG_DIR + os.pathsep + os.environ["PATH"]

import re
import ast
import argparse
import json
import time
import random
import subprocess
import shutil
import pathlib
from typing import List, Dict, Any, Optional, Tuple, Callable
from dataclasses import dataclass
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed, ThreadPoolExecutor

from src.gpt_request import *
from prompts import *
from prompts.user_profile import UserProfile, get_default_profile, create_profile_from_text, parse_profile_with_ai_sync
from src.utils import *
from src.scope_refine import *
from src.external_assets import process_storyboard_with_assets
from src.audio_steps import (
    _timeline_events_from_statements,
    build_section_steps,
    repair_cached_step_audio,
    save_section_steps,
    build_section_narration_track,
    remux_video_with_audio,
)
from src.pedagogy import (
    max_new_terms_from_profile,
    measure_video_duration,
    parse_stage5_evaluation,
    select_duration_with_ai,
    validate_outline,
    validate_requested_duration,
    validate_storyboard,
    normalize_grouped_lecture_lines,
    wrap_storyboard_lecture_lines,
)
from src.rendering import (
    detect_long_silences,
    get_render_profile,
    probe_media,
    render_fingerprint,
    validate_rendered_media,
)
from src.overview_scene import (
    build_overview_lecture_lines,
    generate_overview_manim_code,
    _merge_section_titles_with_ai,
    OVERVIEW_INTRO_LINE,
    OVERVIEW_ENDING_LINE,
)
from src.cover_scene import generate_cover_manim_code


@dataclass
class Section:
    id: str
    title: str
    lecture_lines: List[str]
    animations: List[str]
    estimated_duration: Optional[int] = None  # 预计时长（秒）
    highlight_groups: Optional[List[List[int]]] = None
    evidence_lines_indices: Optional[List[int]] = None
    zpd_check_line_index: Optional[int] = None
    bridge_line_index: Optional[int] = None
    new_terms_introduced: Optional[List[str]] = None
    layout_mode: str = "no_code"
    code_snippets: Optional[List[str]] = None


@dataclass
class TeachingOutline:
    topic: str
    target_audience: str
    sections: List[Dict[str, Any]]
    teaching_schema_version: str = "zh-cn-pedagogy-v2"
    factuality_anchor_checklist: Optional[List[str]] = None
    scaffold_map: Optional[List[Dict[str, Any]]] = None
    difficulty_level: Optional[str] = None


@dataclass
class VideoFeedback:
    section_id: str
    video_path: str
    has_issues: bool
    suggested_improvements: List[str]
    raw_response: Optional[str] = None
    is_good_enough: bool = False
    good_enough_reason: Optional[str] = None
    evaluation_scores: Optional[Dict[str, float]] = None


@dataclass
class RunConfig:
    use_feedback: bool = True
    use_assets: bool = True
    api: Callable = None
    logic_api: Callable = None
    feedback_rounds: int = 3
    iconfinder_api_key: str = ""
    max_code_token_length: int = 10000
    max_planning_token_length: int = 16000
    max_fix_bug_tries: int = 10
    max_regenerate_tries: int = 10
    max_feedback_gen_code_tries: int = 3
    max_mllm_fix_bugs_tries: int = 3
    duration: Optional[int] = None
    render_profile: str = "4k30"
    preview_render_profile: str = "1080p30"
    # 用户个性化配置
    user_profile: Optional[UserProfile] = None
    # 强制大纲难度（入门/中等/进阶），若为空则由画像推断
    forced_difficulty_level: Optional[str] = None


class TeachingVideoAgent:
    def __init__(
        self,
        idx,
        knowledge_point,
        folder="CASES",
        cfg: Optional[RunConfig] = None,
    ):
        """1. Global parameter"""
        self.learning_topic = knowledge_point
        self.idx = idx
        self.cfg = cfg or RunConfig()
        self.folder = folder  # 修复：保存 folder 路径，供 get_serializable_state 使用

        if not self.cfg.api:
            raise ValueError(f"❌ 错误: TeachingVideoAgent 初始化失败。必须在 RunConfig 中提供有效的 'api' 回调函数。")

        self.use_feedback = cfg.use_feedback
        self.use_assets = cfg.use_assets
        self.code_API = cfg.api
        self.logic_API = cfg.logic_api or cfg.api
        self.API = self.code_API
        self.feedback_rounds = cfg.feedback_rounds
        self.iconfinder_api_key = cfg.iconfinder_api_key
        self.max_code_token_length = cfg.max_code_token_length
        self.max_planning_token_length = cfg.max_planning_token_length
        self.max_fix_bug_tries = cfg.max_fix_bug_tries
        self.max_regenerate_tries = cfg.max_regenerate_tries
        self.max_feedback_gen_code_tries = cfg.max_feedback_gen_code_tries
        self.max_mllm_fix_bugs_tries = cfg.max_mllm_fix_bugs_tries
        self.forced_difficulty_level = cfg.forced_difficulty_level
        self.duration = validate_requested_duration(self.cfg.duration, 5, 12)
        self.render_profile = get_render_profile(self.cfg.render_profile)
        self.preview_render_profile = get_render_profile(self.cfg.preview_render_profile)
        self.duration_source = "manual" if self.duration is not None else None
        self.actual_duration_seconds: Optional[float] = None
        self.actual_narration_seconds: Optional[float] = None
        self.media_metadata: Dict[str, Any] = {}
        self.long_silence_intervals: List[Tuple[float, float]] = []
        self.use_assets = cfg.use_assets
        self.API = self.code_API
        self.feedback_rounds = cfg.feedback_rounds
        self.iconfinder_api_key = cfg.iconfinder_api_key
        self.max_code_token_length = cfg.max_code_token_length
        self.max_fix_bug_tries = cfg.max_fix_bug_tries
        self.max_regenerate_tries = cfg.max_regenerate_tries
        self.max_feedback_gen_code_tries = cfg.max_feedback_gen_code_tries
        self.max_mllm_fix_bugs_tries = cfg.max_mllm_fix_bugs_tries
        
        # 用户个性化配置
        self.user_profile = cfg.user_profile or get_default_profile()

        """2. Path for output"""
        self.output_dir = get_output_dir(idx=idx, knowledge_point=self.learning_topic, base_dir=folder)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.assets_dir = Path(*self.output_dir.parts[: self.output_dir.parts.index("CASES")]) / "assets" / "icon"
        self.assets_dir.mkdir(exist_ok=True)

        """3. ScopeRefine & Anchor Visual"""
        self.scope_refine_fixer = ScopeRefineFixer(self.API, self.max_code_token_length)
        self.extractor = GridPositionExtractor()

        """4. External Database"""
        knowledge_ref_mapping_path = (
            Path(*self.output_dir.parts[: self.output_dir.parts.index("CASES")]) / "json_files" / "long_video_ref_mapping.json"
        )
        with open(knowledge_ref_mapping_path) as f:
            self.KNOWLEDGE2PATH = json.load(f)
        self.knowledge_ref_img_folder = (
            Path(*self.output_dir.parts[: self.output_dir.parts.index("CASES")]) / "assets" / "reference"
        )
        self.GRID_IMG_PATH = self.knowledge_ref_img_folder / "GRID.png"

        """5. Data structure"""
        self.outline = None
        self.enhanced_storyboard = None
        self.sections = []
        self.section_codes = {}
        self.section_steps = {}
        self.section_videos = {}
        self.video_feedbacks = {}
        self.visual_quality_results: Dict[str, Any] = {}
        self.pinned_final_reused: set[str] = set()

        """6. For Efficiency"""
        self.token_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

    def _request_with_tracking(self, api_func, prompt, max_tokens):
        response, usage = api_func(prompt, max_tokens=max_tokens)
        if usage:
            self.token_usage["prompt_tokens"] += usage.get("prompt_tokens", 0)
            self.token_usage["completion_tokens"] += usage.get("completion_tokens", 0)
            self.token_usage["total_tokens"] += usage.get("total_tokens", 0)
        return response

    def _request_api_and_track_tokens(self, prompt, max_tokens=10000):
        """Call the code/authoring model and accumulate token usage."""
        return self._request_with_tracking(self.code_API, prompt, max_tokens)

    def _request_logic_api_and_track_tokens(self, prompt, max_tokens=12000):
        """Call the logic/planning model and accumulate token usage."""
        return self._request_with_tracking(self.logic_API, prompt, max_tokens)

    def _ensure_duration_resolved(self) -> None:
        if self.duration is not None:
            return
        parsed_profile = getattr(self.user_profile, "parsed_profile", None) or {}
        self.duration, self.duration_source = select_duration_with_ai(
            self._request_logic_api_and_track_tokens,
            topic=self.learning_topic,
            learner_profile=parsed_profile,
            minimum=5,
            maximum=12,
            fallback=8,
        )
        print(f"⏱️ 视频目标时长：{self.duration} 分钟（{self.duration_source}）")

    def _validate_outline_payload(self, payload):
        return validate_outline(
            payload,
            target_minutes=self.duration,
            evidence_types={"算法定义", "不变量", "执行追踪", "复杂度推导", "边界案例"},
        )

    def _validate_storyboard_payload(self, payload):
        return validate_storyboard(
            payload,
            outline_sections=self.outline.sections,
            target_minutes=self.duration,
            max_new_terms=max_new_terms_from_profile(self.user_profile),
        )

    def _request_video_api_and_track_tokens(self, prompt, video_path):
        """Wraps video API requests and accumulates token usage automatically"""
        response, usage = request_gemini_video_img_token(prompt=prompt, video_path=video_path, image_path=self.GRID_IMG_PATH)

        if usage:
            self.token_usage["prompt_tokens"] += usage.get("prompt_tokens", 0)
            self.token_usage["completion_tokens"] += usage.get("completion_tokens", 0)
            self.token_usage["total_tokens"] += usage.get("total_tokens", 0)
        return response

    def _video_has_audio_stream(self, video_path: Path) -> bool:
        video_path = Path(video_path)
        ffprobe_path = shutil.which("ffprobe")
        if not ffprobe_path or not video_path.exists():
            return False

        result = subprocess.run(
            [
                ffprobe_path,
                "-v",
                "error",
                "-select_streams",
                "a",
                "-show_entries",
                "stream=index",
                "-of",
                "json",
                str(video_path),
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            return False

        try:
            payload = json.loads(result.stdout or "{}")
        except json.JSONDecodeError:
            return False

        return bool(payload.get("streams"))

    def _remux_section_audio(
        self,
        section_id: str,
        video_path: Path,
        *,
        profile_name: str,
        fingerprint: str,
    ) -> Path:
        steps_file = self.output_dir / f"{section_id}_steps.json"
        code_file = self.output_dir / f"{section_id}.py"
        if not steps_file.exists() or not code_file.exists():
            raise FileNotFoundError(f"Missing steps/code file for remux: {section_id}")

        if section_id in self.section_steps:
            section_steps = self.section_steps[section_id]
        else:
            with open(steps_file, "r", encoding="utf-8") as f:
                section_steps = json.load(f)
            self.section_steps[section_id] = section_steps

        remux_dir = self.output_dir / "audio_remux" / profile_name / section_id / fingerprint
        remux_dir.mkdir(parents=True, exist_ok=True)
        narration_path = remux_dir / f"{section_id}_track.wav"
        fixed_video_path = remux_dir / f"{section_id}_with_audio.mp4"

        build_section_narration_track(section_steps, code_file, narration_path)
        remux_video_with_audio(video_path, narration_path, fixed_video_path)
        return fixed_video_path

    def get_serializable_state(self):
        """返回可以序列化保存的Agent状态"""
        return {"idx": self.idx, "knowledge_point": self.learning_topic, "folder": self.folder, "cfg": self.cfg}

    def _validate_synced_step_coverage(self, code: str, expected_steps: int) -> Tuple[bool, str]:
        try:
            tree = ast.parse(code)
        except SyntaxError as exc:
            return False, f"SyntaxError during AST validation: {exc}"

        construct_func = None
        for node in tree.body:
            if isinstance(node, ast.ClassDef) and node.name != "TeachingScene":
                for child in node.body:
                    if isinstance(child, ast.FunctionDef) and child.name == "construct":
                        construct_func = child
                        break
            if construct_func:
                break

        if construct_func is None:
            return False, "No construct() method found in generated scene code"

        synced_calls = 0
        narrated_calls = 0
        raw_add_sound_calls = 0
        raw_play_calls = 0
        excessive_waits: List[float] = []
        for node in ast.walk(construct_func):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                if node.func.attr == "play_synced_step":
                    synced_calls += 1
                elif node.func.attr == "play_narrated_step":
                    narrated_calls += 1
                elif node.func.attr == "add_sound":
                    raw_add_sound_calls += 1
                elif node.func.attr == "play":
                    raw_play_calls += 1
                elif node.func.attr == "wait" and node.args:
                    value = node.args[0]
                    if isinstance(value, ast.Constant) and isinstance(value.value, (int, float)):
                        if float(value.value) > 0.5:
                            excessive_waits.append(float(value.value))

        if raw_add_sound_calls > 0:
            return False, "construct() contains raw add_sound() calls instead of play_synced_step()"
        if raw_play_calls > 0:
            return False, "construct() contains raw self.play(); every animation must run inside a narrated step"
        if excessive_waits:
            return False, f"construct() contains artificial wait() values above 0.5s: {excessive_waits}"
        covered_calls = synced_calls + narrated_calls
        if covered_calls != expected_steps:
            return False, (
                f"construct() only contains {covered_calls} narrated step calls "
                f"({synced_calls} highlighted, {narrated_calls} non-lecture), expected {expected_steps}"
            )

        timeline_events: List[Tuple[str, float]] = []
        try:
            _timeline_events_from_statements(construct_func.body, expected_steps, timeline_events)
        except Exception as exc:
            return False, f"construct() narration timeline cannot be resolved: {exc}"
        audio_order = [int(payload) for kind, payload in timeline_events if kind == "audio"]
        if audio_order != list(range(expected_steps)):
            return False, (
                "construct() must play every narration step exactly once and in order; "
                f"resolved={audio_order}, expected={list(range(expected_steps))}"
            )

        return True, ""

    def generate_outline(self) -> TeachingOutline:
        self._ensure_duration_resolved()
        outline_file = self.output_dir / "outline.json"
        outline_data = None

        if outline_file.exists():
            print("📂 正在读取大纲...")
            try:
                with open(outline_file, "r", encoding="utf-8") as f:
                    cached_outline = json.load(f)
                cached_outline, cache_errors = self._validate_outline_payload(cached_outline)
                if cache_errors:
                    print("♻️ 旧大纲缓存已过期，将重新生成：" + "; ".join(cache_errors))
                else:
                    outline_data = cached_outline
            except Exception as exc:
                print(f"♻️ 大纲缓存不可用，将重新生成：{exc}")

        if outline_data is None:
            """Step 1: Generate teaching outline from topic"""
            refer_img_path = (
                self.knowledge_ref_img_folder / img_name
                if (img_name := self.KNOWLEDGE2PATH.get(self.learning_topic)) is not None
                else None
            )
            prompt1 = get_prompt1_outline(
                knowledge_point=self.learning_topic, 
                duration=self.duration, 
                reference_image_path=refer_img_path,
                user_profile=self.user_profile,
                forced_difficulty_level=self.forced_difficulty_level,
            )

            print(f"📝 正在生成大纲...")

            for attempt in range(1, self.max_regenerate_tries + 1):
                api_func = self._request_logic_api_and_track_tokens
                validation_note = ""
                if attempt > 1 and 'outline_errors' in locals() and outline_errors:
                    validation_note = "\n\n上一次输出未通过校验，请逐项修正：\n- " + "\n- ".join(outline_errors)
                response = api_func(prompt1 + validation_note, max_tokens=self.max_planning_token_length)
                if response is None:
                    print(f"⚠️ 第 {attempt} 次尝试失败，正在重试...")
                    if attempt == self.max_regenerate_tries:
                        raise ValueError("API 请求多次失败")
                    continue
                try:
                    content = response.candidates[0].content.parts[0].text
                except Exception:
                    try:
                        content = response.choices[0].message.content
                    except Exception:
                        content = str(response)
                content = extract_json_from_markdown(content)
                try:
                    candidate = json.loads(content)
                    outline_data, outline_errors = self._validate_outline_payload(candidate)
                    if outline_errors:
                        print(f"⚠️ 第 {attempt} 次大纲结构校验失败：" + "; ".join(outline_errors))
                        outline_data = None
                        if attempt == self.max_regenerate_tries:
                            raise ValueError("大纲结构多次无效：" + "; ".join(outline_errors))
                        continue
                    with open(self.output_dir / "outline.json", "w", encoding="utf-8") as f:
                        json.dump(outline_data, f, ensure_ascii=False, indent=2)
                    break
                except json.JSONDecodeError:
                    print(f"⚠️ 第 {attempt} 次尝试大纲格式无效，正在重试...")
                    if attempt == self.max_regenerate_tries:
                        raise ValueError("大纲格式多次无效，请检查提示词或 API 响应")

        self.outline = TeachingOutline(
            topic=outline_data["topic"],
            target_audience=outline_data["target_audience"],
            sections=outline_data["sections"],
            teaching_schema_version=outline_data["teaching_schema_version"],
            factuality_anchor_checklist=outline_data.get("factuality_anchor_checklist"),
            scaffold_map=outline_data.get("scaffold_map"),
            difficulty_level=outline_data.get("difficulty_level"),
        )
        print(f"== 大纲已生成: {self.outline.topic}")
        return self.outline

    def generate_storyboard(self) -> List[Section]:
        """Step 2: Generate teaching storyboard from outline (optionally with asset enhancement)"""
        if not self.outline:
            raise ValueError("大纲未生成，请先生成大纲")

        storyboard_file = self.output_dir / "storyboard.json"
        enhanced_storyboard_file = self.output_dir / "storyboard_with_assets.json"
        self.enhanced_storyboard = None

        for cache_file in (enhanced_storyboard_file, storyboard_file):
            if not cache_file.exists():
                continue
            try:
                print(f"📂 正在检查分镜缓存：{cache_file.name}")
                with open(cache_file, "r", encoding="utf-8") as f:
                    cached_storyboard = json.load(f)
                cached_storyboard = wrap_storyboard_lecture_lines(cached_storyboard)
                cached_storyboard, cache_errors = self._validate_storyboard_payload(cached_storyboard)
                if cache_errors:
                    print("♻️ 分镜缓存已过期：" + "; ".join(cache_errors))
                    continue
                if cache_file == storyboard_file and self.use_assets:
                    cached_storyboard = self._enhance_storyboard_with_assets(cached_storyboard)
                    cached_storyboard = wrap_storyboard_lecture_lines(cached_storyboard)
                    cached_storyboard, enhanced_errors = self._validate_storyboard_payload(cached_storyboard)
                    if enhanced_errors:
                        print("♻️ 素材增强结果破坏教学结构，将重生成：" + "; ".join(enhanced_errors))
                        continue
                self.enhanced_storyboard = cached_storyboard
                break
            except Exception as exc:
                print(f"♻️ 分镜缓存不可用：{exc}")

        if self.enhanced_storyboard is None:
            print("🎬 正在生成分镜脚本...")
            refer_img_path = (
                self.knowledge_ref_img_folder / img_name
                if (img_name := self.KNOWLEDGE2PATH.get(self.learning_topic)) is not None
                else None
            )

            prompt2 = get_prompt2_storyboard(
                outline=json.dumps(self.outline.__dict__, ensure_ascii=False, indent=2),
                reference_image_path=refer_img_path,
                user_profile=self.user_profile
            )

            for attempt in range(1, self.max_regenerate_tries + 1):
                api_func = self._request_logic_api_and_track_tokens
                validation_note = ""
                if attempt > 1 and 'storyboard_errors' in locals() and storyboard_errors:
                    validation_note = "\n\n上一次输出未通过校验，请逐项修正：\n- " + "\n- ".join(storyboard_errors)
                response = api_func(prompt2 + validation_note, max_tokens=self.max_planning_token_length)
                if response is None:
                    print(f"⚠️ 第 {attempt} 次尝试 API 请求失败，正在重试...")
                    if attempt == self.max_regenerate_tries:
                        raise ValueError("API 请求多次失败")
                    continue

                try:
                    content = response.candidates[0].content.parts[0].text
                except Exception:
                    try:
                        content = response.choices[0].message.content
                    except Exception:
                        content = str(response)

                try:
                    json_str = extract_json_from_markdown(content)
                    candidate = json.loads(json_str)
                    candidate = wrap_storyboard_lecture_lines(candidate)
                    storyboard_data, storyboard_errors = self._validate_storyboard_payload(candidate)
                    if storyboard_errors:
                        print(f"⚠️ 第 {attempt} 次分镜结构校验失败：" + "; ".join(storyboard_errors))
                        if attempt == self.max_regenerate_tries:
                            raise ValueError("分镜结构多次无效：" + "; ".join(storyboard_errors))
                        continue

                    # Save original storyboard
                    with open(storyboard_file, "w", encoding="utf-8") as f:
                        json.dump(storyboard_data, f, ensure_ascii=False, indent=2)

                    # Enhance storyboard (add assets)
                    if self.use_assets:
                        self.enhanced_storyboard = self._enhance_storyboard_with_assets(storyboard_data)
                    else:
                        self.enhanced_storyboard = storyboard_data
                    self.enhanced_storyboard = wrap_storyboard_lecture_lines(self.enhanced_storyboard)
                    self.enhanced_storyboard, enhanced_errors = self._validate_storyboard_payload(self.enhanced_storyboard)
                    if enhanced_errors:
                        raise ValueError("素材增强后的分镜结构无效：" + "; ".join(enhanced_errors))
                    break

                except json.JSONDecodeError as e:
                    print(f"⚠️ 第 {attempt} 次尝试分镜格式无效，正在重试...")
                    print(f"❌ JSON Error: {e}")
                    print(f"❌ Content snippet: {content[:1000]}...") 
                    if attempt == self.max_regenerate_tries:
                        raise ValueError("分镜格式多次无效，请检查提示词或 API 响应")

        # Parse into Section objects (using enhanced storyboard)
        self.sections = []
        for section_data in self.enhanced_storyboard["sections"]:
            lecture_lines = normalize_grouped_lecture_lines(
                section_data.get("lecture_lines", []),
                section_data.get("highlight_groups"),
            )
            section_data["lecture_lines"] = lecture_lines
            section = Section(
                id=section_data["id"],
                title=section_data["title"],
                lecture_lines=lecture_lines,
                animations=section_data["animations"],
                estimated_duration=section_data.get("estimated_duration"),  # 解析预计时长
                highlight_groups=section_data.get("highlight_groups"),
                evidence_lines_indices=section_data.get("evidence_lines_indices"),
                zpd_check_line_index=section_data.get("zpd_check_line_index"),
                bridge_line_index=section_data.get("bridge_line_index"),
                new_terms_introduced=section_data.get("new_terms_introduced"),
                layout_mode=section_data.get("layout_mode", "no_code"),
                code_snippets=section_data.get("code_snippets", []),
            )
            self.sections.append(section)

        normalized_storyboard_path = enhanced_storyboard_file if self.use_assets else storyboard_file
        with open(normalized_storyboard_path, "w", encoding="utf-8") as f:
            json.dump(self.enhanced_storyboard, f, ensure_ascii=False, indent=2)

        print(f"== 分镜处理完成，共生成 {len(self.sections)} 个小节")
        return self.sections

    def _enhance_storyboard_with_assets(self, storyboard_data: dict) -> dict:
        """Enhance storyboard: smart analysis and download assets"""
        print("🤖 正在增强分镜：智能分析并下载素材...")

        try:
            enhanced_storyboard = process_storyboard_with_assets(
                storyboard=storyboard_data,
                api_function=self.logic_API,
                assets_dir=str(self.assets_dir),
                iconfinder_api_key=self.iconfinder_api_key,
            )
            enhanced_storyboard_file = self.output_dir / "storyboard_with_assets.json"
            with open(enhanced_storyboard_file, "w", encoding="utf-8") as f:
                json.dump(enhanced_storyboard, f, ensure_ascii=False, indent=2)
            print("✅ 分镜已增强素材")
            return enhanced_storyboard

        except Exception as e:
            print(f"⚠️ 素材下载失败，使用原始分镜: {e}")
            return storyboard_data

    def inject_cover_section(self) -> None:
        """
        在 sections 列表最前面注入一个「封面」section。

        封面展示大标题（短名称）+ 副标题（完整 topic），并播放介绍旁白。
        使用确定性模板生成 Manim 代码，保证 100% 成功率。
        """
        if not self.outline:
            print("⚠️ 大纲尚未生成，跳过封面注入")
            return

        # 如果已经注入过，不重复注入
        if self.sections and self.sections[0].id == "section_cover":
            print("🎬 封面 section 已存在，跳过注入")
            return

        # 封面旁白：介绍语（会走 TTS 管线）
        intro_text = f"本视频将带你学习：{self.outline.topic}"

        cover_section = Section(
            id="section_cover",
            title=self.outline.topic,
            lecture_lines=[intro_text],
            animations=["Show complete cover from frame zero", "Play intro audio over static cover"],
            estimated_duration=10,  # 封面约 8-12 秒（含旁白）
        )

        # 插入到 sections 最前面
        self.sections.insert(0, cover_section)
        print(f"🎬 已注入封面 section（知识点：{self.outline.topic}）")

    def _generate_cover_code(self, section: Section) -> str:
        """
        为封面 section 使用确定性模板生成 Manim 代码。

        封面现在有旁白（介绍语），需要先生成 TTS 音频，再生成代码。

        Returns:
            完整的 Manim 代码字符串
        """
        # 先生成 TTS 音频（封面有旁白了）
        section_steps = self.prepare_section_steps(section)

        code = generate_cover_manim_code(
            topic=self.outline.topic,
            short_title=self.learning_topic,
            section_steps=section_steps,
        )
        code = replace_base_class(code, base_class)

        # 保存代码文件
        code_file = self.output_dir / f"{section.id}.py"
        with open(code_file, "w", encoding="utf-8") as f:
            f.write(code)

        self.section_codes[section.id] = code
        print(f"🎬 封面 section 代码已生成（模板化，含 TTS 旁白）")
        return code

    def inject_overview_section(self) -> None:
        """
        在 sections 列表最前面注入一个「课程导览」概述 section。

        该方法使用 AI 合并精简 section titles，然后生成 lecture_lines。
        概述 section 后续会正常走 TTS 管线（Stage 2.5）和模板化代码生成（跳过 LLM Stage 3）。
        """
        if not self.outline or not self.sections:
            print("⚠️ 大纲或分节尚未生成，跳过概述注入")
            return

        # 如果已经注入过，不重复注入
        if self.sections and self.sections[0].id == "section_overview":
            print("📋 概述 section 已存在，跳过注入")
            return

        # A completed overview is immutable input on resume.  Re-running the
        # title-merging model can yield a different number of bullets, which
        # invalidates otherwise reusable TTS and template code.  Rehydrate the
        # exact screen groups first; only a brand-new task calls the model.
        cached_steps_path = self.output_dir / "section_overview_steps.json"
        overview_lines = []
        if cached_steps_path.exists():
            try:
                cached_steps = json.loads(cached_steps_path.read_text(encoding="utf-8"))
                overview_lines = [
                    str(text).strip()
                    for step in cached_steps
                    for text in (step.get("screen_texts") or [])
                    if str(text).strip()
                ]
            except Exception as exc:
                print(f"♻️ 概述缓存不可读，将重新合并标题: {exc}")
                overview_lines = []

        if overview_lines:
            print(f"📂 复用概述语义组缓存（{len(overview_lines)} 条）")
        else:
            section_titles = [
                s.title for s in self.sections
                if s.id not in ("section_overview", "section_cover")
            ]
            print("🤖 正在使用 AI 合并精简章节标题...")
            merged_titles = _merge_section_titles_with_ai(
                section_titles=section_titles,
                topic=self.outline.topic,
                api_func=self._request_logic_api_and_track_tokens,
            )
            print(f"📋 合并后共 {len(merged_titles)} 条概要: {merged_titles}")
            overview_lines = build_overview_lecture_lines(
                section_titles=merged_titles,
            )

        overview_section = Section(
            id="section_overview",
            title="课程导览",
            lecture_lines=overview_lines,
            animations=["FadeIn title", "Sequential FadeIn bullet points", "FadeIn ending"],
            estimated_duration=20,  # 概述约 15-25 秒
        )

        # 插入到 sections 最前面
        self.sections.insert(0, overview_section)
        print(f"📋 已注入概述 section（{len(overview_lines)} 条讲解行）")

    def _generate_overview_code(self, section: Section) -> str:
        """
        为概述 section 使用确定性模板生成 Manim 代码（跳过 LLM）。

        Returns:
            完整的 Manim 代码字符串
        """
        import re as _re

        # 确保 section_steps 已构建
        section_steps = self.prepare_section_steps(section)

        # 从 lecture_lines 中提取合并后的 section titles
        # 新格式：起始语 + "第X部分，标题" + 结束语
        # 旧格式（兼容）：圈号格式 "① 标题" + 收尾行
        merged_titles = []
        for line in section.lecture_lines:
            # 跳过起始语
            if line == OVERVIEW_INTRO_LINE:
                continue
            # 跳过结束语（新格式）
            if line == OVERVIEW_ENDING_LINE:
                continue
            # 跳过旧格式收尾行（兼容旧数据）
            if line == "让我们开始吧！":
                continue

            # 新格式：提取 "第X部分，标题" 中的标题部分
            match = _re.match(r"^第[一二三四五六七八九十\d]+部分，(.+)$", line)
            if match:
                merged_titles.append(match.group(1).strip())
                continue

            # 旧格式兼容：去掉圈号前缀（如 "① "）
            cleaned = _re.sub(r"^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]\s*", "", line)
            if cleaned and cleaned != line:
                merged_titles.append(cleaned)

        code = generate_overview_manim_code(
            section_titles=merged_titles,
            section_steps=section_steps,
        )

        # 注入 base_class（与其他 section 统一处理）
        code = replace_base_class(code, base_class)

        # 保存代码文件
        code_file = self.output_dir / f"{section.id}.py"
        with open(code_file, "w", encoding="utf-8") as f:
            f.write(code)

        self.section_codes[section.id] = code
        print(f"📋 概述 section 代码已生成（模板化，无需 LLM）")
        return code

    def generate_section_code(self, section: Section, attempt: int = 1, feedback_improvements=None, error_message: str = None) -> str:
        """Generate Manim code for a single section
        
        Args:
            section: 章节对象
            attempt: 当前尝试次数
            feedback_improvements: MLLM 反馈的改进建议（效果不佳时）
            error_message: 上次运行失败的错误信息（运行失败时）
        """
        # ── 封面 section 使用确定性模板，跳过 LLM ──
        if section.id == "section_cover" and not feedback_improvements:
            code_file = self.output_dir / f"{section.id}.py"
            steps_file = self.output_dir / f"{section.id}_steps.json"
            audio_dir = self.output_dir / "audio" / section.id
            audio_files_exist = audio_dir.exists() and any(
                fp.is_file() for p in ("*.wav",) for fp in audio_dir.glob(p)
            )
            if (
                attempt == 1
                and steps_file.exists()
                and audio_files_exist
            ):
                print(f"📂 复用 {section.id} 的旁白步骤并重建确定性封面模板...")
                with open(steps_file, "r", encoding="utf-8") as f:
                    self.section_steps[section.id] = json.load(f)
            return self._generate_cover_code(section)

        # ── 概述 section 使用确定性模板，跳过 LLM ──
        if section.id == "section_overview" and not feedback_improvements:
            code_file = self.output_dir / f"{section.id}.py"
            steps_file = self.output_dir / f"{section.id}_steps.json"
            audio_dir = self.output_dir / "audio" / section.id
            audio_files_exist = audio_dir.exists() and any(
                fp.is_file() for p in ("*.wav",) for fp in audio_dir.glob(p)
            )
            if (
                attempt == 1
                and steps_file.exists()
                and audio_files_exist
            ):
                print(f"📂 复用 {section.id} 的旁白步骤并重建确定性概览模板...")
                with open(steps_file, "r", encoding="utf-8") as f:
                    self.section_steps[section.id] = json.load(f)
            return self._generate_overview_code(section)

        code_file = self.output_dir / f"{section.id}.py"
        steps_file = self.output_dir / f"{section.id}_steps.json"
        audio_dir = self.output_dir / "audio" / section.id
        audio_files_exist = audio_dir.exists() and any(
            file_path.is_file()
            for pattern in ("*.wav", "*.mp3", "*.ogg")
            for file_path in audio_dir.glob(pattern)
        )

        if (
            attempt == 1
            and code_file.exists()
            and not feedback_improvements
            and steps_file.exists()
            and audio_files_exist
        ):
            print(f"📂 发现 {section.id} 的现有代码，正在读取...")
            with open(steps_file, "r", encoding="utf-8") as f:
                self.section_steps[section.id] = json.load(f)
            with open(code_file, "r", encoding="utf-8") as f:
                code = f.read()
            is_valid, _ = self._validate_synced_step_coverage(
                code, len(self.section_steps[section.id])
            )
            if is_valid:
                self.section_codes[section.id] = code
                return code
            print(f"♻️ {section.id} 代码与当前旁白步骤不一致，只重生成该节代码")
        # print(f"💻 正在为 {section.id} 生成 Manim 代码 (尝试 {attempt}/{self.max_regenerate_tries})...")
        regenerate_note = ""
        if attempt > 1:
            # 仅用于运行失败的情况
            regenerate_note = get_regenerate_note(
                attempt, 
                MAX_REGENERATE_TRIES=self.max_regenerate_tries,
                error_message=error_message
            )

        # Add MLLM feedback and improvement suggestions
        if feedback_improvements:
            current_code = self.section_codes.get(section.id, "")
            try:
                modifier = GridCodeModifier(current_code)
                modified_code = modifier.parse_feedback_and_modify(feedback_improvements)
                modified_code = fix_png_path(modified_code, self.assets_dir)
                if modified_code.strip() == current_code.strip():
                    raise ValueError("结构化修改器未产生代码变化，改用完整代码修订")
                with open(code_file, "w", encoding="utf-8") as f:
                    f.write(modified_code)

                self.section_codes[section.id] = modified_code
                return modified_code
            except Exception as e:
                print(f"⚠️ GridCodeModifier 失败，回退到原始代码: {e}")
                code_gen_prompt = get_feedback_improve_code(
                    feedback=get_feedback_list_prefix(feedback_improvements), code=current_code
                )

        else:
            section_steps = self.prepare_section_steps(section)
            code_gen_prompt = get_prompt3_code(
                regenerate_note=regenerate_note, 
                section=section, 
                section_steps=section_steps,
                base_class=base_class,
                user_profile=self.user_profile,
                estimated_duration=section.estimated_duration  # 传递预计时长
            )

        response = self._request_api_and_track_tokens(code_gen_prompt, max_tokens=self.max_code_token_length)
        if response is None:
            print(f"❌ 通过 API 生成 {section.id} 代码失败。")
            return ""

        try:
            code = response.candidates[0].content.parts[0].text
        except Exception:
            try:
                code = response.choices[0].message.content
            except Exception:
                code = str(response)
        if "```python" in code:
            code = code.split("```python")[1].split("```")[0].strip()
        elif "```" in code:
            code = code.split("```")[1].strip()

        # Replace base class
        code = replace_base_class(code, base_class)
        code = fix_png_path(code, self.assets_dir)

        if not feedback_improvements:
            is_valid, validation_error = self._validate_synced_step_coverage(code, len(section_steps))
            if not is_valid:
                if attempt < self.max_regenerate_tries:
                    print(f"⚠️ {section.id} 代码未覆盖全部音频步骤，重新生成: {validation_error}")
                    return self.generate_section_code(
                        section=section,
                        attempt=attempt + 1,
                        error_message=validation_error,
                    )
                raise ValueError(validation_error)

        with open(code_file, "w", encoding="utf-8") as f:
            f.write(code)

        self.section_codes[section.id] = code
        return code

    def prepare_section_steps(
        self,
        section: Section,
        *,
        target_audio_seconds: float | None = None,
        force: bool = False,
    ) -> List[dict]:
        steps_file = self.output_dir / f"{section.id}_steps.json"
        audio_dir = self.output_dir / "audio" / section.id
        if (
            not force
            and steps_file.exists()
            and audio_dir.exists()
            and any(file_path.is_file() for file_path in audio_dir.glob("*.wav"))
        ):
            with open(steps_file, "r", encoding="utf-8") as f:
                section_steps = json.load(f)
            cached_target = sum(float(step.get("target_audio_seconds") or 0) for step in section_steps)
            groups = section.highlight_groups or [[index] for index in range(len(section.lecture_lines))]
            expected_screen_groups = [
                [section.lecture_lines[index] for index in group]
                for group in groups
            ]
            cached_screen_groups = [list(step.get("screen_texts") or []) for step in section_steps]
            same_content = cached_screen_groups == expected_screen_groups
            same_target = target_audio_seconds is None or abs(cached_target - target_audio_seconds) <= 1.0
            if same_content and same_target:
                if repair_cached_step_audio(section_steps):
                    save_section_steps(section_steps, steps_file)
                    print(f"♻️ {section.id} 仅修复缺失或失配的旁白音频，保留其余缓存")
                self.section_steps[section.id] = section_steps
                return section_steps
            print(
                f"♻️ {section.id} 旁白缓存与当前语义组或时长目标不一致，只重生成该节"
            )

        section_steps = build_section_steps(
            section=section,
            output_root=self.output_dir,
            api_func=self._request_logic_api_and_track_tokens,
            target_audio_seconds=target_audio_seconds,
        )
        save_section_steps(section_steps, steps_file)
        self.section_steps[section.id] = section_steps
        return section_steps

    def prepare_all_narration_steps(self, max_rounds: int = 3) -> Dict[str, List[dict]]:
        """Generate TTS against a physical whole-video narration budget."""
        if self.duration is None:
            self._ensure_duration_resolved()
        target_final_seconds = float(self.duration * 60)
        transition_budget = min(30.0, max(8.0, len(self.sections) * 1.0))
        desired_narration_seconds = target_final_seconds - transition_budget
        minimum_final_seconds = target_final_seconds * 0.85
        maximum_final_seconds = target_final_seconds * 1.30
        # 旁白后还会有少量分页切换；下限直接用旁白物理时长保守判断，
        # 上限预留 transition_budget，避免合并后超过 10:30。
        acceptable_narration_range = (
            minimum_final_seconds,
            maximum_final_seconds - transition_budget,
        )
        weights = [max(1.0, float(section.estimated_duration or 1.0)) for section in self.sections]
        weight_total = sum(weights)
        targets = {
            section.id: desired_narration_seconds * weight / weight_total
            for section, weight in zip(self.sections, weights)
        }

        for round_index in range(max_rounds):

            def prepare(section):
                return section.id, self.prepare_section_steps(
                    section,
                    target_audio_seconds=targets[section.id],
                    force=False,
                )

            with ThreadPoolExecutor(max_workers=min(4, max(1, len(self.sections)))) as executor:
                futures = [executor.submit(prepare, section) for section in self.sections]
                for future in as_completed(futures):
                    section_id, steps = future.result()
                    self.section_steps[section_id] = steps

            measured_by_section = {
                section.id: sum(float(step["audio_duration"]) for step in self.section_steps[section.id])
                for section in self.sections
            }
            measured_total = sum(measured_by_section.values())
            self.actual_narration_seconds = measured_total
            print(
                f"🎙️ 第 {round_index + 1}/{max_rounds} 轮物理旁白时长 "
                f"{measured_total:.2f}s，理想目标 {desired_narration_seconds:.2f}s，"
                f"可接受 {acceptable_narration_range[0]:.2f}-{acceptable_narration_range[1]:.2f}s"
            )
            if acceptable_narration_range[0] <= measured_total <= acceptable_narration_range[1]:
                return self.section_steps
            if measured_total <= 0:
                raise ValueError("TTS physical duration is zero")
            ratio = desired_narration_seconds / measured_total
            # LLM 对“目标朗读秒数”的响应通常弱于线性；使用有界过补偿，
            # 避免三轮都只增加少量文字却始终达不到物理时长。
            scale = min(1.35, max(0.75, ratio ** 2.5))
            targets = {
                section.id: max(2.0, targets[section.id] * scale)
                for section in self.sections
            }

        raise ValueError(
            f"三轮旁白调整后仍未达到可接受范围：actual={self.actual_narration_seconds:.2f}s, "
            f"accepted={acceptable_narration_range[0]:.2f}-{acceptable_narration_range[1]:.2f}s"
        )

    def debug_and_fix_code(
        self,
        section_id: str,
        max_fix_attempts: int = 3,
        *,
        render_profile=None,
        force_render: bool = False,
    ) -> Tuple[bool, Optional[str]]:
        """Render a code/audio/profile fingerprint and repair only real failures."""
        code_path = self.output_dir / f"{section_id}.py"
        if section_id not in self.section_codes:
            if not code_path.exists():
                return False, "代码文件不存在"
            self.section_codes[section_id] = code_path.read_text(encoding="utf-8")

        steps_file = self.output_dir / f"{section_id}_steps.json"
        if section_id not in self.section_steps:
            if not steps_file.exists():
                return False, f"Missing narration steps: {steps_file}"
            self.section_steps[section_id] = json.loads(steps_file.read_text(encoding="utf-8"))
        steps = self.section_steps[section_id]
        profile_value = getattr(render_profile, "name", render_profile) or self.preview_render_profile.name
        profile = get_render_profile(profile_value)
        last_error: Optional[str] = None

        for fix_attempt in range(max_fix_attempts):
            code = self.section_codes[section_id]
            scene_candidates = re.findall(r"class\s+(\w+)\s*\([^)]*\):", code)
            preferred_scene = next(
                (
                    name for name in scene_candidates
                    if name.lower() not in {"teachingscene", "basescene"}
                    and re.search(rf"class\s+{name}\s*\([^)]*\):[\s\S]*?def\s+construct\s*\(", code)
                ),
                scene_candidates[-1] if scene_candidates else f"{section_id.title().replace('_', '')}Scene",
            )
            fingerprint = render_fingerprint(code, steps, profile)
            render_root = self.output_dir / "render_cache" / profile.name / section_id / fingerprint
            remuxed_path = (
                self.output_dir / "audio_remux" / profile.name / section_id / fingerprint / f"{section_id}_with_audio.mp4"
            )

            if not force_render and remuxed_path.exists():
                try:
                    validate_rendered_media(remuxed_path, profile, require_audio=True)
                    self.section_videos[section_id] = str(remuxed_path)
                    print(f"✅ {section_id} 命中内容指纹缓存: {profile.name}/{fingerprint}")
                    return True, None
                except Exception as exc:
                    print(f"♻️ {section_id} 指纹缓存无效，将重新渲染: {exc}")

            print(
                f"🔧 {self.learning_topic} 渲染 {section_id} "
                f"[{profile.name}] ({fix_attempt + 1}/{max_fix_attempts}, {fingerprint})"
            )
            try:
                is_valid, validation_error = self._validate_synced_step_coverage(code, len(steps))
                if not is_valid:
                    raise ValueError(validation_error)
                if force_render and render_root.exists():
                    resolved_root = render_root.resolve()
                    if self.output_dir.resolve() not in resolved_root.parents:
                        raise RuntimeError(f"Unsafe render cache path: {resolved_root}")
                    shutil.rmtree(resolved_root)
                render_root.mkdir(parents=True, exist_ok=True)
                output_name = f"{section_id}_{fingerprint}.mp4"
                timeout_seconds = int(
                    os.getenv(
                        "MANIM_RENDER_TIMEOUT_SECONDS",
                        "21600" if profile.width >= 3840 else "3600",
                    )
                )
                cmd = [
                    sys.executable,
                    "-m",
                    "manim",
                    "render",
                    *profile.manim_args,
                    "--media_dir",
                    str(render_root),
                    "--disable_caching",
                    "-o",
                    output_name,
                    str(code_path.name),
                    preferred_scene,
                ]
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    cwd=self.output_dir,
                    timeout=timeout_seconds,
                )
                if result.returncode != 0:
                    raise RuntimeError(result.stderr or result.stdout or "Manim rendering failed")
                candidates = sorted(render_root.rglob(output_name), key=lambda path: path.stat().st_mtime, reverse=True)
                if not candidates:
                    candidates = sorted(render_root.rglob("*.mp4"), key=lambda path: path.stat().st_mtime, reverse=True)
                if not candidates:
                    raise FileNotFoundError(f"Manim succeeded but no MP4 exists under {render_root}")
                raw_video = candidates[0]
                validate_rendered_media(raw_video, profile, require_audio=False)
                fixed_video = self._remux_section_audio(
                    section_id,
                    raw_video,
                    profile_name=profile.name,
                    fingerprint=fingerprint,
                )
                validate_rendered_media(fixed_video, profile, require_audio=True)
                self.section_videos[section_id] = str(fixed_video)
                print(f"✅ {section_id} {profile.name} 渲染与音频回灌完成")
                return True, None
            except subprocess.TimeoutExpired:
                last_error = f"Manim {profile.name} 渲染超时"
            except Exception as exc:
                last_error = str(exc)

            print(f"❌ {section_id} {profile.name} 渲染失败: {last_error}")
            fixed_code = self.scope_refine_fixer.fix_code_smart(
                section_id,
                self.section_codes[section_id],
                last_error,
                self.output_dir,
            )
            if not fixed_code:
                break
            self.section_codes[section_id] = fixed_code
            code_path.write_text(fixed_code, encoding="utf-8")
            force_render = True

        return False, last_error

    def get_mllm_feedback(self, section: Section, video_path: str, round_number: int = 1) -> VideoFeedback:
        print(f"🤖 {self.learning_topic} 使用 MLLM 分析视频 ({round_number}/{self.feedback_rounds}): {section.id}")

        current_code = self.section_codes[section.id]
        positions = self.extractor.extract_grid_positions(current_code)
        position_table = self.extractor.generate_position_table(positions)
        if section.id in {"section_cover", "section_overview"}:
            template_role = "全屏居中封面" if section.id == "section_cover" else "全屏章节概览"
            analysis_prompt = f"""
你是严格的视频布局质检员。当前片段是{template_role}，不是普通的左文右图教学页，
因此不要套用右侧动画安全区，也不要把居中的标题或目录文字判为越界。

逐秒检查全部联系表，只把以下真实可见问题判为问题：文字或图形相互遮挡、元素被画面
裁切、影响阅读的低对比度、字符渲染为方框或乱码、切换后旧元素残留，以及逐句旁白
字幕或横跨底部的字幕框。还要检查后续页面元素是否提前出现、当前页面元素是否延迟消失，
以及完整页面是否在整句旁白期间缓慢淡入或淡出。正常的标题、副标题、章节目录和装饰线不是字幕。

片段标题：{section.title}
画面文字：{'；'.join(section.lecture_lines)}

只输出合法 JSON，不要 Markdown、注释、占位符或额外说明：
{{"layout":{{"has_issues":false,"improvements":[]}}}}
若确有问题，将 has_issues 改为 true；improvements 最多三项，每项必须是
{{"problem":"具体可见问题","solution":"可执行修复","timestamp":"12.0-13.0s","line_number":0,"object_affected":"对象名"}}。
"""
        else:
            analysis_prompt = get_prompt4_layout_feedback(section=section, position_table=position_table)
        evaluation_prompt = get_prompt_aes(self.learning_topic)
        transition_timestamps: List[float] = []
        cursor = 0.0
        previous_page = None
        for step in self.section_steps.get(section.id, []):
            page = step.get("page_index")
            if previous_page is not None and page != previous_page:
                transition_timestamps.extend([cursor, cursor + 0.25])
                cursor += 0.25
            cursor += float(step.get("audio_duration") or 0.0)
            previous_page = page

        def _request_structured(prompt, parser, label):
            last_error = None
            for attempt in range(1, 4):
                try:
                    response = request_gemini_video_img(
                        prompt=prompt,
                        video_path=video_path,
                        image_path=self.GRID_IMG_PATH,
                        sample_timestamps=transition_timestamps,
                    )
                    content = extract_answer_from_response(response)
                    parsed = parser(content)
                    return content, parsed
                except Exception as exc:
                    last_error = exc
                    print(f"⚠️ {self.learning_topic} {label} 结构化解析失败 {attempt}/3: {exc}")
            raise ValueError(f"{label} failed structured validation after 3 attempts: {last_error}")

        def _parse_layout(feedback_content):
            data = json.loads(extract_json_from_markdown(feedback_content))
            lay = data.get("layout")
            if not isinstance(lay, dict) or not isinstance(lay.get("has_issues"), bool):
                raise ValueError("layout.has_issues must be boolean")
            improvements = lay.get("improvements")
            if not isinstance(improvements, list):
                raise ValueError("layout.improvements must be a list")
            suggested = []
            for item in improvements:
                if not isinstance(item, dict):
                    raise ValueError("layout improvement must be an object")
                problem = str(item.get("problem") or "").strip()
                solution = str(item.get("solution") or "").strip()
                if not problem or not solution:
                    raise ValueError("layout improvement requires problem and solution")
                suggested.append(f"[LAYOUT] Problem: {problem}; Solution: {solution}")
            return bool(lay["has_issues"]), suggested

        try:
            feedback_content, layout_result = _request_structured(
                analysis_prompt, _parse_layout, "layout feedback"
            )
            has_layout_issues, suggested_improvements = layout_result
            # Cover and overview clips are structural bookends rather than
            # self-contained teaching sections.  Applying the full pedagogy
            # rubric to them makes dimensions such as accuracy depth and
            # execution tracing impossible to satisfy, even when their visual
            # contract is correct.  They still go through the strict,
            # every-second layout check above (overlap, clipping, stale
            # elements and forbidden caption bars).
            if section.id in {"section_cover", "section_overview"}:
                evaluation = {
                    "is_good_enough": not has_layout_issues,
                    "reason": "模板章节仅按严格布局与无字幕契约验收。",
                    "scores": {"element_layout": 20.0 if not has_layout_issues else 0.0},
                    "blockers": [],
                    "improvements": [],
                }
                evaluation_content = json.dumps(evaluation, ensure_ascii=False)
            else:
                evaluation_content, evaluation = _request_structured(
                    evaluation_prompt,
                    lambda text: parse_stage5_evaluation(extract_json_from_markdown(text)),
                    "stage5 evaluation",
                )
            suggested_improvements = evaluation["improvements"] + suggested_improvements
            # A reviewer may provide optional polish suggestions while still
            # declaring the clip good enough.  Only an actual layout failure
            # or a failed pedagogy threshold should trigger regeneration.
            has_issues = has_layout_issues or not evaluation["is_good_enough"]
            feedback = VideoFeedback(
                section_id=section.id,
                video_path=video_path,
                has_issues=has_issues,
                suggested_improvements=suggested_improvements,
                raw_response=json.dumps(
                    {"layout_feedback": feedback_content, "stage5_evaluation": evaluation_content},
                    ensure_ascii=False,
                ),
                is_good_enough=evaluation["is_good_enough"],
                good_enough_reason=evaluation["reason"],
                evaluation_scores=evaluation["scores"],
            )
            self.video_feedbacks[f"{section.id}_round{round_number}"] = feedback
            return feedback

        except Exception as e:
            print(f"❌ {self.learning_topic} MLLM 分析失败: {str(e)}")
            return VideoFeedback(
                section_id=section.id,
                video_path=video_path,
                has_issues=True,
                suggested_improvements=[f"[教学评价] 评价失败，不能视为通过：{str(e)}"],
                raw_response=f"Error: {str(e)}",
            )

    def optimize_with_feedback(self, section: Section, feedback: VideoFeedback) -> bool:
        """Apply feedback transactionally and render the new code fingerprint."""
        if not feedback.has_issues or not feedback.suggested_improvements:
            print(f"✅ {self.learning_topic} {section.id} 无需优化")
            return True

        original_code_content = self.section_codes[section.id]
        original_video_path = self.section_videos.get(section.id)
        code_path = self.output_dir / f"{section.id}.py"

        for attempt in range(self.max_feedback_gen_code_tries):
            print(
                f"🎯 {self.learning_topic} MLLM 反馈优化 {section.id} 代码，尝试 {attempt + 1}/{self.max_feedback_gen_code_tries}"
            )

            self.section_codes[section.id] = original_code_content
            code_path.write_text(original_code_content, encoding="utf-8")
            self.generate_section_code(
                section=section, attempt=attempt + 1, feedback_improvements=feedback.suggested_improvements
            )
            timeline_valid, timeline_error = self._validate_synced_step_coverage(
                self.section_codes[section.id],
                len(self.section_steps[section.id]),
            )
            if not timeline_valid:
                print(f"⚠️ {section.id} 视觉修订破坏旁白时间轴，立即回滚: {timeline_error}")
                self.section_codes[section.id] = original_code_content
                code_path.write_text(original_code_content, encoding="utf-8")
                if original_video_path:
                    self.section_videos[section.id] = original_video_path
                return False
            success, _ = self.debug_and_fix_code(
                section.id,
                max_fix_attempts=self.max_mllm_fix_bugs_tries,
                render_profile=self.preview_render_profile,
                force_render=True,
            )
            if success:
                print(f"✨ {self.learning_topic} {section.id} 新代码已重新渲染")
                return True
            print(f"❌ {self.learning_topic} {section.id} MLLM 优化渲染失败")

        print(f"❌ {self.learning_topic} {section.id} 所有优化尝试均失败，回滚到原始版本")
        self.section_codes[section.id] = original_code_content
        code_path.write_text(original_code_content, encoding="utf-8")
        if original_video_path:
            self.section_videos[section.id] = original_video_path
        return False

    def generate_codes(self) -> Dict[str, str]:
        if not self.sections:
            raise ValueError(f"{self.learning_topic} 请先生成教学小节")
        self.prepare_all_narration_steps(max_rounds=3)
        pinned_cache_path = self.output_dir / "pinned_final_sections.json"
        pinned_sections = {}
        if pinned_cache_path.exists():
            try:
                pinned_sections = json.loads(
                    pinned_cache_path.read_text(encoding="utf-8")
                )
            except Exception:
                pinned_sections = {}

        def task(section):
            try:
                if section.id in pinned_sections:
                    code_path = self.output_dir / f"{section.id}.py"
                    self.section_codes[section.id] = (
                        code_path.read_text(encoding="utf-8")
                        if code_path.exists()
                        else "# Pinned final section; source recovery is not required for this run.\n"
                    )
                    print(f"✅ {section.id} 已有验收后的最终章节缓存，跳过代码重生成")
                    return section.id, None
                self.generate_section_code(section, attempt=1)
                return section.id, None
            except Exception as e:
                return section.id, e

        with ThreadPoolExecutor(max_workers=6) as executor:
            futures = {executor.submit(task, section): section for section in self.sections}
            failures = []
            for future in as_completed(futures):
                section_id, err = future.result()
                if err:
                    print(f"❌ {self.learning_topic} {section_id} 代码生成失败: {err}")
                    failures.append((section_id, str(err)))

        if failures or len(self.section_codes) != len(self.sections):
            missing = [section.id for section in self.sections if section.id not in self.section_codes]
            raise RuntimeError(f"分节代码生成不完整: failures={failures}, missing={missing}")

        return self.section_codes

    def render_section(self, section: Section) -> bool:
        section_id = section.id

        try:
            pinned_cache_path = self.output_dir / "pinned_final_sections.json"
            if pinned_cache_path.exists():
                try:
                    pinned_sections = json.loads(
                        pinned_cache_path.read_text(encoding="utf-8")
                    )
                    pinned_value = pinned_sections.get(section_id)
                    if pinned_value:
                        pinned_video = Path(pinned_value)
                        if not pinned_video.is_absolute():
                            pinned_video = self.output_dir / pinned_video
                        validate_rendered_media(
                            pinned_video,
                            self.render_profile,
                            require_audio=True,
                        )
                        self.section_videos[section_id] = str(pinned_video)
                        self.pinned_final_reused.add(section_id)
                        print(
                            f"✅ {section_id} 复用显式验收的最终章节缓存: "
                            f"{pinned_video}"
                        )
                        return True
                except Exception as exc:
                    print(f"♻️ {section_id} 显式最终缓存无效，将正常渲染: {exc}")
            success = False
            last_error = None
            for regenerate_attempt in range(self.max_regenerate_tries):
                try:
                    if regenerate_attempt > 0:
                        self.generate_section_code(section, attempt=regenerate_attempt + 1, error_message=last_error)
                    success, last_error = self.debug_and_fix_code(
                        section_id,
                        max_fix_attempts=self.max_fix_bug_tries,
                        render_profile=self.preview_render_profile,
                    )
                    if success:
                        break
                except Exception as e:
                    last_error = str(e)
                    print(f"⚠️ {section_id} 第 {regenerate_attempt + 1} 次尝试抛出异常: {str(e)}")
            if not success:
                print(f"❌ {self.learning_topic} {section_id} 预览渲染失败")
                return False

            if self.use_feedback:
                passed_visual_qa = False
                qa_fingerprint = render_fingerprint(
                    self.section_codes[section_id],
                    self.section_steps[section_id],
                    self.preview_render_profile,
                )
                qa_path = (
                    self.output_dir
                    / "visual_qa_cache"
                    / section_id
                    / f"{qa_fingerprint}.json"
                )
                qa_completed = False
                if qa_path.exists():
                    try:
                        cached_qa = json.loads(qa_path.read_text(encoding="utf-8"))
                        passed_visual_qa = cached_qa.get("passed") is True
                        qa_completed = passed_visual_qa or cached_qa.get("completed") is True
                    except Exception:
                        passed_visual_qa = False
                        qa_completed = False
                if passed_visual_qa:
                    print(f"✅ {section_id} 命中视觉质检指纹缓存: {qa_fingerprint}")
                elif qa_completed:
                    print(f"📝 {section_id} 命中已完成的视觉检查缓存: {qa_fingerprint}")
                # Completeness comes first: do a small, bounded visual pass
                # before delivery, but never turn a successfully rendered
                # section into a missing section merely because a reviewer is
                # unavailable or still has optional polish suggestions.  The
                # cached section can be improved again in later runs.
                predelivery_rounds = 0 if qa_completed else max(
                    0,
                    min(
                        self.feedback_rounds,
                        int(os.getenv("K2V_PREDELIVERY_FEEDBACK_ROUNDS", "1")),
                    ),
                )
                for round_number in range(1, predelivery_rounds + 1):
                    current_video = self.section_videos.get(section_id)
                    if not current_video:
                        print(f"⚠️ {section_id} 没有可供视觉评价的预览，保留已成功渲染状态")
                        break
                    feedback = self.get_mllm_feedback(section, current_video, round_number=round_number)
                    if feedback.raw_response and feedback.raw_response.startswith("Error:"):
                        print(f"⚠️ {section_id} 视觉评价不可用，记录问题并继续完整成片")
                        break
                    if not feedback.has_issues and feedback.is_good_enough:
                        passed_visual_qa = True
                        break
                    if not self.optimize_with_feedback(section, feedback):
                        print(f"⚠️ {section_id} 视觉优化未成功，已回退并保留最后一次成功预览")
                        break
                if not passed_visual_qa:
                    print(f"📝 {section_id} 尚有视觉优化空间；不阻塞章节完整渲染")
                qa_fingerprint = render_fingerprint(
                    self.section_codes[section_id],
                    self.section_steps[section_id],
                    self.preview_render_profile,
                )
                qa_path = (
                    self.output_dir
                    / "visual_qa_cache"
                    / section_id
                    / f"{qa_fingerprint}.json"
                )
                qa_path.parent.mkdir(parents=True, exist_ok=True)
                qa_path.write_text(
                    json.dumps(
                        {
                            "completed": True,
                            "passed": passed_visual_qa,
                            "section_id": section_id,
                            "fingerprint": qa_fingerprint,
                            "preview_profile": self.preview_render_profile.name,
                        },
                        ensure_ascii=False,
                        indent=2,
                    ),
                    encoding="utf-8",
                )

            if self.render_profile.name != self.preview_render_profile.name:
                success, last_error = self.debug_and_fix_code(
                    section_id,
                    max_fix_attempts=self.max_fix_bug_tries,
                    render_profile=self.render_profile,
                )
                if not success:
                    print(f"❌ {section_id} 最终 {self.render_profile.name} 渲染失败: {last_error}")
                    return False
            return True

        except Exception as e:
            print(f"❌ {self.learning_topic} {section_id} 渲染过程异常: {str(e)}")
            return False

    def render_section_worker(self, section_data) -> Tuple[str, bool, Optional[str], Dict[str, Any]]:
        section_id = "unknown"
        try:
            section, agent_class, kwargs = section_data
            section_id = section.id
            agent = agent_class(**kwargs)
            success = agent.render_section(section)
            video_path = agent.section_videos.get(section.id) if success else None
            feedback_rounds = []
            for key, feedback in sorted(agent.video_feedbacks.items()):
                feedback_rounds.append(
                    {
                        "key": key,
                        "has_issues": feedback.has_issues,
                        "is_good_enough": feedback.is_good_enough,
                        "reason": feedback.good_enough_reason,
                        "scores": feedback.evaluation_scores,
                        "improvements": feedback.suggested_improvements,
                    }
                )
            reused_accepted_final = section_id in agent.pinned_final_reused
            visual_passed = reused_accepted_final or (not agent.use_feedback) or any(
                not feedback.has_issues
                and feedback.is_good_enough
                and not (feedback.raw_response or "").startswith("Error:")
                for feedback in agent.video_feedbacks.values()
            )
            quality = {
                "rendered": bool(success),
                "passed": bool(visual_passed),
                "preview_profile": agent.preview_render_profile.name,
                "final_profile": agent.render_profile.name,
                "feedback_enabled": agent.use_feedback,
                "quality_source": (
                    "pinned_accepted_final" if reused_accepted_final else "visual_feedback"
                ),
                "rounds": feedback_rounds,
            }
            return section_id, success, video_path, quality

        except Exception as e:
            print(f"❌ {self.learning_topic} {section_id} 渲染过程异常: {str(e)}")
            return section_id, False, None, {"passed": False, "error": str(e)}

    def render_all_sections(self, max_workers: Optional[int] = None) -> Dict[str, str]:
        if max_workers is None:
            configured = os.getenv("K2V_RENDER_WORKERS")
            # Native 4K Manim + FFmpeg and multimodal contact-sheet analysis
            # can exceed the Docker Desktop memory ceiling when two section
            # processes overlap.  Prefer a stable serial 4K pipeline; users
            # with a larger memory budget can still override it explicitly.
            max_workers = int(configured) if configured else (1 if self.render_profile.width >= 3840 else 4)
        print(f"🎥 开始并行渲染所有分节视频 (最多 {max_workers} 个进程)...")

        tasks = []
        for section in self.sections:
            try:
                task_data = (section, self.__class__, self.get_serializable_state())
                tasks.append(task_data)
            except Exception as e:
                print(f"⚠️ 为 {section.id} 准备任务数据时出错: {str(e)}")
                continue

        if not tasks:
            print("❌ 没有有效任务可执行")
            return {}

        results = {}
        successful_count = 0
        failed_count = 0

        try:
            with ProcessPoolExecutor(max_workers=max_workers) as executor:
                future_to_section = {}
                for task in tasks:
                    try:
                        future = executor.submit(self.render_section_worker, task)
                        future_to_section[future] = task[0].id
                    except Exception as e:
                        section_id = task[0].id if task and len(task) > 0 else "unknown"
                        print(f"⚠️ 提交 {section_id} 任务时出错: {str(e)}")
                        failed_count += 1

                for future in as_completed(future_to_section):
                    section_id = future_to_section[future]
                    try:
                        sid, success, video_path, quality = future.result()
                        self.visual_quality_results[sid] = quality

                        if success and video_path:
                            results[sid] = video_path
                            successful_count += 1
                            print(f"✅ {sid} 视频渲染成功: {video_path}")
                        else:
                            failed_count += 1
                            print(f"⚠️ {sid} 视频渲染失败")

                    except Exception as e:
                        failed_count += 1
                        print(f"❌ {section_id} 视频渲染过程错误: {str(e)}")

        except Exception as e:
            print(f"❌ 并行渲染过程中出现严重错误: {str(e)}")

        # 更新结果并输出统计信息
        self.section_videos.update(results)

        total_sections = len(self.sections)
        print(f"\n📊 渲染统计:")
        print(f"   总小节数: {total_sections}")
        print(f"   成功率: {successful_count/total_sections*100:.1f}%" if total_sections > 0 else "   成功率: 0%")

        if successful_count == 0:
            raise RuntimeError("所有分节视频渲染失败")
        elif failed_count > 0 or successful_count != total_sections:
            raise RuntimeError(
                f"{total_sections - successful_count} 个分节视频实际渲染失败；禁止合并缺少章节的成片"
            )
        else:
            print("🎉 所有分节视频渲染成功！")

        return results

    def merge_videos(self, output_filename: str = None) -> str:
        """Merge every final-profile section, then physically validate the result."""
        if not self.section_videos:
            raise ValueError("没有可用视频进行合并")
        if self.duration is None:
            self._ensure_duration_resolved()

        if output_filename is None:
            safe_name = topic_to_safe_name(self.learning_topic)
            output_filename = f"{safe_name}.mp4"

        output_path = self.output_dir / output_filename

        print(f"🔗 开始合并分节视频...")

        video_list_file = self.output_dir / "video_list.txt"
        ordered_ids = []
        if self.sections:
            ordered_ids = [s.id for s in self.sections]
        else:
            # 备选方案：如果缺失 sections 对象，使用自然排序 (Natural Sort)
            # 这里简单实现一个 key function 处理 trailing numbers
            def natural_keys(text):
                return [int(c) if c.isdigit() else c for c in re.split(r'(\d+)', text)]
            ordered_ids = sorted(self.section_videos.keys(), key=natural_keys)
        
        target_ids = ordered_ids if ordered_ids else sorted(self.section_videos.keys())
        missing = [section_id for section_id in target_ids if section_id not in self.section_videos]
        if missing:
            raise ValueError(f"严格合并禁止缺节：{missing}")

        with open(video_list_file, "w", encoding="utf-8") as f:
            for section_id in target_ids:
                video_path = Path(self.section_videos[section_id]).resolve()
                section_media = validate_rendered_media(
                    video_path,
                    self.render_profile,
                    require_audio=True,
                )
                if section_media["video_codec"] != "h264":
                    raise ValueError(f"{section_id} 视频编码不是 H.264: {section_media['video_codec']}")
                escaped = str(video_path).replace("'", "'\\''")
                f.write(f"file '{escaped}'\n")

        ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
        result = subprocess.run(
            [
                ffmpeg_exe,
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(video_list_file),
                "-c",
                "copy",
                str(output_path),
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(f"合并分节视频失败: {result.stderr}")

        target_seconds = float(self.duration * 60)
        minimum_seconds = target_seconds * 0.85
        maximum_seconds = target_seconds * 1.30
        self.media_metadata = validate_rendered_media(
            output_path,
            self.render_profile,
            duration_range=(minimum_seconds, maximum_seconds),
            require_audio=True,
            reject_long_silences=True,
        )
        if self.media_metadata["video_codec"] != "h264":
            raise ValueError(f"成片视频编码不是 H.264: {self.media_metadata['video_codec']}")
        if self.media_metadata["pixel_format"] != "yuv420p":
            raise ValueError(f"成片像素格式不是 yuv420p: {self.media_metadata['pixel_format']}")
        if self.media_metadata["audio_codec"] != "aac":
            raise ValueError(f"成片音频编码不是 AAC: {self.media_metadata['audio_codec']}")
        self.actual_duration_seconds = float(self.media_metadata["duration"])
        self.long_silence_intervals = list(self.media_metadata["long_silences"])
        print(
            f"✅ 成片物理验收通过: {self.media_metadata['width']}x{self.media_metadata['height']} "
            f"{self.media_metadata['fps']:.2f}fps, {self.actual_duration_seconds:.2f}s, 长静音 0"
        )
        return str(output_path)

    def GENERATE_VIDEO(self) -> str:
        """Generate complete video with MLLM feedback optimization"""
        try:
            self.generate_outline()
            self.generate_storyboard()
            self.inject_overview_section()
            self.inject_cover_section()
            self.generate_codes()
            self.render_all_sections()
            final_video = self.merge_videos()
            if final_video:
                print(f"🎉 视频生成成功: {final_video}")
                return final_video
            else:
                print(f"❌ {self.learning_topic} 失败")
                return None
        except Exception as e:
            print(f"❌ 视频生成失败: {e}")
            return None


def process_knowledge_point(idx, kp, folder_path: Path, cfg: RunConfig):
    print(f"\n🚀 正在处理知识点: {kp}")
    start_time = time.time()

    agent = TeachingVideoAgent(
        idx=idx,
        knowledge_point=kp,
        folder=folder_path,
        cfg=cfg,
    )
    video_path = agent.GENERATE_VIDEO()

    duration_minutes = (time.time() - start_time) / 60
    total_tokens = agent.token_usage["total_tokens"]

    print(f"✅ 知识点 '{kp}' 处理完成。耗时: {duration_minutes:.2f} 分钟, Token 使用: {total_tokens}")
    return kp, video_path, duration_minutes, total_tokens


def process_batch(batch_data, cfg: RunConfig):
    """Process a batch of knowledge points (serial within a batch)"""
    batch_idx, kp_batch, folder_path = batch_data
    results = []
    print(f"第 {batch_idx + 1} 批次开始处理 {len(kp_batch)} 个知识点")

    for local_idx, (idx, kp) in enumerate(kp_batch):
        try:
            if local_idx > 0:
                delay = random.uniform(3, 6)
                print(f"⏳ 第 {batch_idx + 1} 批次在处理 {kp} 前等待 {delay:.1f} 秒...")
                time.sleep(delay)
            results.append(process_knowledge_point(idx, kp, folder_path, cfg))
        except Exception as e:
            print(f"❌ 第 {batch_idx + 1} 批次处理 {kp} 失败: {e}")
            results.append((kp, None, 0, 0))
    return batch_idx, results


def run_Code2Video(
    knowledge_points: List[str], folder_path: Path, parallel=True, batch_size=3, max_workers=8, cfg: RunConfig = RunConfig()
):
    all_results = []

    if parallel:
        batches = []
        for i in range(0, len(knowledge_points), batch_size):
            batch = [(i + j, kp) for j, kp in enumerate(knowledge_points[i : i + batch_size])]
            batches.append((i // batch_size, batch, folder_path))

        print(
            f"🔄 并行批处理模式: {len(batches)} 个批次，每批 {batch_size} 个知识点，{max_workers} 个并发批次"
        )
        with ProcessPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(process_batch, batch, cfg): batch for batch in batches}
            for future in as_completed(futures):
                try:
                    batch_idx, batch_results = future.result()
                    all_results.extend(batch_results)
                    print(f"✅ 第 {batch_idx + 1} 批次完成")
                except Exception as e:
                    print(f"❌ 第 {batch_idx + 1} 批次处理失败: {e}")
    else:
        print("🔄 串行处理模式")
        for idx, kp in enumerate(knowledge_points):
            try:
                all_results.append(process_knowledge_point(idx, kp, folder_path, cfg))
            except Exception as e:
                print(f"❌ 串行处理 {kp} 失败: {e}")
                all_results.append((kp, None, 0, 0))

    successful_runs = [r for r in all_results if r[1] is not None]
    total_runs = len(all_results)
    if not successful_runs:
        print("\n所有知识点处理失败，无法计算平均值。")
        return

    total_duration = sum(r[2] for r in successful_runs)
    total_tokens_consumed = sum(r[3] for r in successful_runs)
    num_successful = len(successful_runs)

    print("\n" + "=" * 50)
    print(f"   总知识点数: {total_runs}")
    print(f"   成功处理: {num_successful} ({num_successful/total_runs*100:.1f}%)")
    print(f"   平均耗时 [分]: {total_duration/num_successful:.2f} 分钟/知识点")
    print(f"   平均 Token 消耗: {total_tokens_consumed/num_successful:,.0f} tokens/知识点")
    print("=" * 50)


def get_api_and_output(API_name):
    mapping = {
        "gpt-41": (request_gpt41_token, "Chatgpt41"),
        "claude": (request_claude_token, "CLAUDE"),
        "gpt-5": (request_gpt5_token, "Chatgpt5"),
        "gpt-4o": (request_gpt4o_token, "Chatgpt4o"),
        "gpt-o4mini": (request_o4mini_token, "Chatgpto4mini"),
        "Gemini": (request_gemini_token, "Gemini"),
    }
    try:
        return mapping[API_name]
    except KeyError:
        raise ValueError("无效的 API 模型名称")


def build_and_parse_args():
    parser = argparse.ArgumentParser()
    # TODO: Core hyperparameters
    parser.add_argument(
        "--API",
        type=str,
        choices=["gpt-41", "claude", "gpt-5", "gpt-4o", "gpt-o4mini", "Gemini"],
        default="gpt-5",
    )
    parser.add_argument(
        "--folder_prefix",
        type=str,
        default="TEST",
    )
    parser.add_argument("--knowledge_file", type=str, default="long_video_topics_list.json")
    parser.add_argument("--iconfinder_api_key", type=str, default="")

    # Basically invariant parameters
    parser.add_argument("--use_feedback", action="store_true", default=False)
    parser.add_argument("--no_feedback", action="store_false", dest="use_feedback")
    parser.add_argument("--use_assets", action="store_true", default=False)
    parser.add_argument("--no_assets", action="store_false", dest="use_assets")

    parser.add_argument("--max_code_token_length", type=int, help="max # token for generating code", default=10000)
    parser.add_argument("--max_fix_bug_tries", type=int, help="max # tries for SR to fix bug", default=10)
    parser.add_argument("--max_regenerate_tries", type=int, help="max # tries to regenerate", default=10)
    parser.add_argument("--max_feedback_gen_code_tries", type=int, help="max # tries for Critic", default=3)
    parser.add_argument("--max_mllm_fix_bugs_tries", type=int, help="max # tries for Critic to fix bug", default=3)
    parser.add_argument("--feedback_rounds", type=int, default=3)
    parser.add_argument("--duration", type=int, default=None, help="目标时长（分钟）；不传时由 AI 在 5-12 分钟内选择")
    parser.add_argument(
        "--render_profile",
        choices=["1080p30", "4k30", "4k60"],
        default="4k30",
        help="原生渲染规格",
    )

    parser.add_argument("--parallel", action="store_true", default=False)
    parser.add_argument("--no_parallel", action="store_false", dest="parallel")
    parser.add_argument("--parallel_group_num", type=int, default=3)
    parser.add_argument("--max_concepts", type=int, help="Limit # concepts for a quick run, -1 for all", default=-1)
    parser.add_argument("--knowledge_point", type=str, help="if knowledge_file not given, can ignore", default=None)
    
    # 新增参数：最大并行工作进程数
    parser.add_argument("--max_workers", type=int, default=None, help="Force specific number of workers, overriding auto-detection")

    # 用户个性化配置参数 - 新的自然语言描述方式
    parser.add_argument(
        "--user_profile",
        type=str,
        default="",
        help="用户画像的自然语言描述，例如：'我是17岁的高中生，想要的学习难度是入门级，选择的编程语言是Python，目标是利用暑假成功入门Python'"
    )

    return parser.parse_args()


if __name__ == "__main__":
    args = build_and_parse_args()

    api, folder_name = get_api_and_output(args.API)
    folder = Path(__file__).resolve().parent / "CASES" / f"{args.folder_prefix}_{folder_name}"

    _CFG_PATH = pathlib.Path(__file__).with_name("api_config.json")
    with _CFG_PATH.open("r", encoding="utf-8") as _f:
        _CFG = json.load(_f)
    iconfinder_cfg = _CFG.get("iconfinder", {})
    args.iconfinder_api_key = iconfinder_cfg.get("api_key")
    if args.iconfinder_api_key:
        print(f"Iconfinder API 密钥: {args.iconfinder_api_key}")
    else:
        print("警告: 配置文件中未找到 Iconfinder API 密钥。使用默认值 (None)。")

    if args.knowledge_point:
        print(f"🔄 单知识点模式: {args.knowledge_point}")
        knowledge_points = [args.knowledge_point]
        args.parallel_group_num = 1
    elif args.knowledge_file:
        with open(Path(__file__).resolve().parent / "json_files" / args.knowledge_file, "r", encoding="utf-8") as f:
            knowledge_points = json.load(f)
            if args.max_concepts is not None:
                knowledge_points = knowledge_points[: args.max_concepts]
    else:
        raise ValueError("必须提供 --knowledge_point 或 --knowledge_file")

    # 创建用户个性化配置
    if args.user_profile:
        print(f"🧠 正在使用 AI 解析用户画像...")
        print(f"📝 用户输入: {args.user_profile}")
        
        # 先创建基础的用户配置
        user_profile = create_profile_from_text(args.user_profile)
        
        # 使用 AI 解析用户画像
        parsed_profile = parse_profile_with_ai_sync(args.user_profile, api)
        
        if parsed_profile:
            user_profile.update_with_parsed_profile(parsed_profile)
            print(f"✅ AI 解析成功！")
            
            # 打印解析结果摘要
            summary = parsed_profile.get("user_summary", {})
            print(f"📋 解析结果:")
            print(f"   - 年龄段: {summary.get('age_group', '未知')}")
            print(f"   - 知识背景: {summary.get('background', '未知')}")
            print(f"   - 学习目标: {summary.get('learning_goal', '未知')}")
            print(f"   - 编程语言: {summary.get('target_language', 'Python')}")
            print(f"   - 难度偏好: {summary.get('difficulty_preference', '中等')}")
        else:
            print(f"⚠️ AI 解析失败，使用默认解析结果")
    else:
        print(f"📋 未提供用户画像，使用默认配置")
        user_profile = get_default_profile()

    cfg = RunConfig(
        api=api,
        iconfinder_api_key=args.iconfinder_api_key,
        use_feedback=args.use_feedback,
        use_assets=args.use_assets,
        max_code_token_length=args.max_code_token_length,
        max_fix_bug_tries=args.max_fix_bug_tries,
        max_regenerate_tries=args.max_regenerate_tries,
        max_feedback_gen_code_tries=args.max_feedback_gen_code_tries,
        max_mllm_fix_bugs_tries=args.max_mllm_fix_bugs_tries,
        feedback_rounds=args.feedback_rounds,
        duration=args.duration,
        render_profile=args.render_profile,
        user_profile=user_profile,
    )
    
    # 优先使用命令行参数指定的 workers，否则自动计算
    real_workers = args.max_workers if args.max_workers is not None else get_optimal_workers()

    run_Code2Video(
        knowledge_points,
        folder,
        parallel=args.parallel,
        batch_size=max(1, int(len(knowledge_points) / args.parallel_group_num)),
        max_workers=real_workers,
        cfg=cfg,
    )
