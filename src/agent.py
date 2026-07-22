import sys
import os
import imageio_ffmpeg

# Add project root to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass  # 鍦?Celery Worker 涓彲鑳戒細澶辫触锛屽拷鐣ュ嵆鍙?
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
import multiprocessing
from typing import List, Dict, Any, Optional, Tuple, Callable
from dataclasses import dataclass
from functools import partial
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
    TEACHING_SCHEMA_VERSION,
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
from src.cover_scene import generate_cover_manim_code
from src.rendering import (
    get_render_profile,
    render_fingerprint,
    validate_rendered_media,
)
from src.overview_scene import (
    OVERVIEW_ENDING_LINE,
    OVERVIEW_INTRO_LINE,
    _merge_section_titles_with_ai,
    build_overview_lecture_lines,
    generate_overview_manim_code,
)
from src.delivery import (
    estimate_native_4k_seconds,
    find_scene_class_name,
    generate_fallback_scene_code,
    normalize_known_scene_tokens,
    remaining_pipeline_seconds,
)


@dataclass
class Section:
    id: str
    title: str
    lecture_lines: List[str]
    animations: List[str]
    estimated_duration: Optional[int] = None
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
    teaching_schema_version: str = TEACHING_SCHEMA_VERSION
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
    feedback_rounds: int = 2
    iconfinder_api_key: str = ""
    max_code_token_length: int = 10000
    max_fix_bug_tries: int = 3
    max_regenerate_tries: int = 3
    max_feedback_gen_code_tries: int = 1
    max_mllm_fix_bugs_tries: int = 1
    max_repair_attempts: int = 2
    duration: Optional[int] = None
    render_profile: str = "4k30"
    preview_render_profile: str = "1080p30"
    pipeline_budget_seconds: int = 3000
    finalize_reserve_seconds: int = 240
    pipeline_started_at: Optional[float] = None
    # 鐢ㄦ埛涓€у寲閰嶇疆
    user_profile: Optional[UserProfile] = None
    forced_difficulty_level: Optional[str] = None
    # 缂栫▼棰樼洰鐩稿叧
    problem_description: str = ""
    solution_code: str = ""


class TeachingVideoAgent:
    def __init__(
        self,
        idx,
        folder="CASES",
        cfg: Optional[RunConfig] = None,
        problem_description: str = "",
        solution_code: str = "",
    ):
        # 1. Global parameter
        # 缂栫▼棰樼洰鐩稿叧锛氫紭鍏堜娇鐢ㄧ洿鎺ヤ紶鍏ョ殑鍙傛暟锛屽叾娆′娇鐢?cfg 涓殑閰嶇疆
        self.problem_description = problem_description or (cfg.problem_description if cfg else "")
        self.solution_code = solution_code or (cfg.solution_code if cfg else "")
        
        # Extract a short title for output directory names and logs.
        if self.problem_description:
            first_line = self.problem_description.split('\n')[0].strip()
            first_sentence = re.split(r"[。；;\n]|示例\d+[:：]|限制[:：]", first_line, maxsplit=1)[0].strip()
            main_title = re.split(r"[:：]", first_sentence, maxsplit=1)[0].strip()
            self.learning_topic = main_title[:50] if len(main_title) > 50 else main_title
        else:
            self.learning_topic = "untitled_problem"
        self.idx = idx
        self.cfg = cfg or RunConfig()
        self.folder = folder  # 淇锛氫繚瀛?folder 璺緞锛屼緵 get_serializable_state 浣跨敤

        if not self.cfg.api:
            raise ValueError("TeachingVideoAgent initialization failed: cfg.api is required")

        cfg = self.cfg
        self.use_feedback = cfg.use_feedback
        self.use_assets = cfg.use_assets
        self.API = cfg.api
        self.max_repair_attempts = min(2, max(0, int(cfg.max_repair_attempts)))
        self.max_attempts = self.max_repair_attempts + 1
        self.feedback_rounds = min(2, max(0, int(cfg.feedback_rounds)))
        self.iconfinder_api_key = cfg.iconfinder_api_key
        self.max_code_token_length = cfg.max_code_token_length
        self.max_fix_bug_tries = min(self.max_attempts, max(1, int(cfg.max_fix_bug_tries)))
        self.max_regenerate_tries = min(self.max_attempts, max(1, int(cfg.max_regenerate_tries)))
        self.max_feedback_gen_code_tries = 1
        self.max_mllm_fix_bugs_tries = 1
        self.forced_difficulty_level = cfg.forced_difficulty_level
        self.duration = validate_requested_duration(self.cfg.duration, 5, 15)
        self.render_profile = get_render_profile(self.cfg.render_profile)
        self.preview_render_profile = get_render_profile(self.cfg.preview_render_profile)
        self.requested_render_profile = self.render_profile
        self.actual_render_profile = self.render_profile
        self.pipeline_started_at = float(cfg.pipeline_started_at or time.time())
        self.cfg.pipeline_started_at = self.pipeline_started_at
        self.pipeline_budget_seconds = max(300, int(cfg.pipeline_budget_seconds))
        self.finalize_reserve_seconds = max(60, int(cfg.finalize_reserve_seconds))
        self.duration_source = "manual" if self.duration is not None else None
        self.actual_duration_seconds: Optional[float] = None
        self.actual_narration_seconds: Optional[float] = None
        self.media_metadata: Dict[str, Any] = {}
        self.long_silence_intervals: List[Tuple[float, float]] = []
        self.long_silence_checked = False
        self.warnings: List[Dict[str, Any]] = []
        self.retry_summary: Dict[str, Any] = {"max_repair_attempts": self.max_repair_attempts}
        self.stage_timings: Dict[str, Dict[str, float]] = {}
        self.deadline_action: Optional[str] = None
        self.section_fallbacks: Dict[str, Dict[str, Any]] = {}
        self.preview_render_seconds: List[float] = []
        
        # 鐢ㄦ埛涓€у寲閰嶇疆
        self.user_profile = cfg.user_profile or get_default_profile()

        # 2. Path for output
        self.output_dir = get_output_dir(idx=idx, knowledge_point=self.learning_topic, base_dir=folder)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.assets_dir = Path(*self.output_dir.parts[: self.output_dir.parts.index("CASES")]) / "assets" / "icon"
        self.assets_dir.mkdir(exist_ok=True)

        # 3. ScopeRefine & Anchor Visual
        self.scope_refine_fixer = ScopeRefineFixer(self.API, self.max_code_token_length)
        self.extractor = GridPositionExtractor()

        # 4. External Database
        knowledge_ref_mapping_path = (
            Path(*self.output_dir.parts[: self.output_dir.parts.index("CASES")]) / "json_files" / "long_video_ref_mapping.json"
        )
        with open(knowledge_ref_mapping_path) as f:
            self.KNOWLEDGE2PATH = json.load(f)
        self.knowledge_ref_img_folder = (
            Path(*self.output_dir.parts[: self.output_dir.parts.index("CASES")]) / "assets" / "reference"
        )
        self.GRID_IMG_PATH = self.knowledge_ref_img_folder / "GRID.png"

        # 5. Data structure
        self.outline = None
        self.enhanced_storyboard = None
        self.sections = []
        self.section_codes = {}
        self.section_steps = {}
        self.section_videos = {}
        self.preview_video_paths: Dict[str, str] = {}
        self.video_feedbacks = {}
        self.visual_quality_results: Dict[str, Any] = {}
        self.pinned_final_reused: set[str] = set()

        # 6. For Efficiency
        self.token_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

        legacy_limits = {
            "max_fix_bug_tries": cfg.max_fix_bug_tries,
            "max_regenerate_tries": cfg.max_regenerate_tries,
            "max_feedback_gen_code_tries": cfg.max_feedback_gen_code_tries,
            "max_mllm_fix_bugs_tries": cfg.max_mllm_fix_bugs_tries,
        }
        if any(int(value) > self.max_attempts for value in legacy_limits.values()):
            print("Legacy retry settings are capped at first attempt plus two repairs.")

    def _add_warning(self, code: str, message: str, **details: Any) -> None:
        warning = {"code": code, "message": message}
        warning.update({key: value for key, value in details.items() if value is not None})
        if warning not in self.warnings:
            self.warnings.append(warning)

    def remaining_pipeline_seconds(self) -> float:
        return remaining_pipeline_seconds(self.pipeline_started_at, self.pipeline_budget_seconds)

    def record_stage_timing(self, stage: str, started_at: float) -> None:
        ended_at = time.time()
        self.stage_timings[stage] = {
            "started_at": float(started_at),
            "ended_at": ended_at,
            "elapsed_seconds": max(0.0, ended_at - float(started_at)),
        }

    def _attempt_state_path(self, section_id: str) -> Path:
        return self.output_dir / ".delivery" / f"{section_id}.json"

    def _section_versions_used(self, section_id: str) -> int:
        path = self._attempt_state_path(section_id)
        try:
            return max(0, int(json.loads(path.read_text(encoding="utf-8")).get("code_versions_used", 0)))
        except Exception:
            return 0

    def _set_section_versions_used(self, section_id: str, count: int) -> None:
        path = self._attempt_state_path(section_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"section_id": section_id, "code_versions_used": min(self.max_attempts, max(0, int(count)))}
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def _normalize_section_code(self, section_id: str) -> list[str]:
        code_path = self.output_dir / f"{section_id}.py"
        code = self.section_codes.get(section_id)
        if code is None and code_path.exists():
            code = code_path.read_text(encoding="utf-8")
        if code is None:
            return []
        normalized, fixes = normalize_known_scene_tokens(code)
        find_scene_class_name(normalized)
        if normalized != code:
            code_path.write_text(normalized, encoding="utf-8")
        self.section_codes[section_id] = normalized
        return fixes

    def _install_fallback_code(self, section: Section, reason: str) -> None:
        steps = self.section_steps.get(section.id)
        if steps is None:
            steps_path = self.output_dir / f"{section.id}_steps.json"
            steps = json.loads(steps_path.read_text(encoding="utf-8"))
            self.section_steps[section.id] = steps
        code = generate_fallback_scene_code(
            section_id=section.id,
            title=section.title,
            section_steps=steps,
            base_class=base_class,
            solution_code=self.solution_code,
            code_snippets=section.code_snippets,
        )
        code_path = self.output_dir / f"{section.id}.py"
        code_path.write_text(code, encoding="utf-8")
        self.section_codes[section.id] = code
        self.section_fallbacks[section.id] = {"reason": reason, "template": "code_progress"}
        self._add_warning(
            "section_template_fallback",
            f"{section.id} 涓変釜浠ｇ爜鐗堟湰鍧囦笉鍙敤锛屽凡閲囩敤绋冲畾淇濆簳妯℃澘",
            section_id=section.id,
            reason=reason,
        )

    def _request_api_and_track_tokens(self, prompt, max_tokens=10000):
        # Packages API requests and automatically accumulates token usage.
        response, usage = self.API(prompt, max_tokens=max_tokens)
        if usage:
            self.token_usage["prompt_tokens"] += usage.get("prompt_tokens", 0)
            self.token_usage["completion_tokens"] += usage.get("completion_tokens", 0)
            self.token_usage["total_tokens"] += usage.get("total_tokens", 0)
        return response

    def _ensure_duration_resolved(self) -> None:
        if self.duration is not None:
            return
        parsed_profile = getattr(self.user_profile, "parsed_profile", None) or {}
        self.duration, self.duration_source = select_duration_with_ai(
            self._request_api_and_track_tokens,
            topic=self.learning_topic,
            problem_description=self.problem_description,
            learner_profile=parsed_profile,
            minimum=5,
            maximum=15,
            fallback=10,
        )
        print(f"Video target duration: {self.duration} minutes ({self.duration_source})")

    def _validate_outline_payload(self, payload):
        return validate_outline(
            payload,
            target_minutes=self.duration,
            evidence_types={"题目条件", "标准答案代码", "算法定义", "不变量", "执行追踪", "复杂度推导", "边界案例"},
        )

    def _validate_storyboard_payload(self, payload):
        return validate_storyboard(
            payload,
            outline_sections=self.outline.sections,
            target_minutes=self.duration,
            max_new_terms=max_new_terms_from_profile(self.user_profile),
            solution_code=self.solution_code,
        )

    def _repair_storyboard_payload(self, storyboard_data):
        # Repair recoverable storyboard schema drift before validation.
        if not isinstance(storyboard_data, dict):
            return storyboard_data
        sections = storyboard_data.get("sections")
        if not isinstance(sections, list):
            return storyboard_data

        for section in sections:
            if not isinstance(section, dict):
                continue

            lines = section.get("lecture_lines")
            if not isinstance(lines, list):
                continue
            line_count = len(lines)
            layout_mode = str(section.get("layout_mode") or "no_code")
            section_index = section.get("id") or section.get("title") or "section"

            groups = section.get("highlight_groups")
            repaired_groups: List[List[int]] = []
            used = set()
            if isinstance(groups, list):
                for group in groups:
                    if not isinstance(group, list):
                        continue
                    valid_indices: List[int] = []
                    for raw_index in group:
                        if (
                            isinstance(raw_index, int)
                            and not isinstance(raw_index, bool)
                            and 0 <= raw_index < line_count
                        ):
                            if raw_index not in valid_indices:
                                valid_indices.append(raw_index)
                                used.add(raw_index)
                    valid_indices.sort()
                    if valid_indices:
                        repaired_groups.append(valid_indices)
            if not repaired_groups and line_count > 0:
                repaired_groups = [[index] for index in range(line_count)]

            if line_count > 0 and used:
                for index in range(line_count):
                    if index not in used:
                        repaired_groups.append([index])
            if line_count == 0:
                section["highlight_groups"] = []
            elif repaired_groups:
                repaired_groups.sort(key=lambda g: g[0] if g else 0)
                section["highlight_groups"] = repaired_groups

            new_terms = section.get("new_terms_introduced")
            if isinstance(new_terms, list):
                section["new_terms_introduced"] = [
                    item.strip()
                    for item in new_terms
                    if isinstance(item, str) and item.strip()
                ]
            else:
                section["new_terms_introduced"] = []
            if not section["new_terms_introduced"]:
                fallback_term = str(section_index).replace("_", " ").replace("-", " ").strip()
                section["new_terms_introduced"] = [fallback_term]

            snippets = section.get("code_snippets")
            if isinstance(snippets, list):
                section["code_snippets"] = [
                    str(item).strip()
                    for item in snippets
                    if isinstance(item, str) and str(item).strip()
                ]
            else:
                section["code_snippets"] = []

            if layout_mode == "full_code" and self.solution_code:
                full_code_lines = self.solution_code.splitlines(keepends=True)
                full_code_pages: List[str] = []
                for start in range(0, len(full_code_lines), 12):
                    full_code_pages.append("".join(full_code_lines[start : start + 12]))
                if full_code_pages and "".join(section["code_snippets"]) != self.solution_code:
                    section["code_snippets"] = full_code_pages

            if layout_mode in {"with_code", "full_code"} and self.solution_code:
                valid_snippets = [
                    snippet for snippet in section["code_snippets"]
                    if isinstance(snippet, str) and snippet in self.solution_code
                ]
                section["code_snippets"] = valid_snippets or [self.solution_code]

        return storyboard_data

    def _request_video_api_and_track_tokens(self, prompt, video_path):
        # Wrap video API requests and accumulate token usage automatically.
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
        # Return serializable agent state.
        return {
            "idx": self.idx,
            "folder": self.folder,
            "cfg": self.cfg,
            "problem_description": self.problem_description,
            "solution_code": self.solution_code,
        }

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
        raw_wait_calls = 0
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
                elif node.func.attr == "wait":
                    raw_wait_calls += 1
                    if node.args:
                        value = node.args[0]
                        if isinstance(value, ast.Constant) and isinstance(value.value, (int, float)):
                            if float(value.value) > 0.5:
                                excessive_waits.append(float(value.value))

        if raw_add_sound_calls > 0:
            return False, "construct() contains raw add_sound() calls instead of play_synced_step()"
        if raw_play_calls > 0:
            return False, "construct() contains raw self.play(); every animation must run inside a narrated step"
        if raw_wait_calls > 0:
            return False, (
                "construct() contains raw self.wait(); narration groups must be adjacent and all timing "
                f"must come from narrated steps (long waits={excessive_waits})"
            )
        covered_calls = synced_calls + narrated_calls
        if covered_calls != expected_steps:
            return False, (
                f"construct() contains {covered_calls} narrated step calls "
                f"({synced_calls} highlighted, {narrated_calls} non-lecture), expected {expected_steps}"
            )

        timeline_events: List[Tuple[str, float]] = []
        try:
            _timeline_events_from_statements(construct_func.body, expected_steps, timeline_events, {})
        except Exception as exc:
            return False, f"construct() narration timeline cannot be resolved: {exc}"
        audio_order = [int(payload) for kind, payload in timeline_events if kind == "audio"]
        if audio_order != list(range(expected_steps)):
            return False, (
                "construct() must play every narration step exactly once and in order; "
                f"resolved={audio_order}, expected={list(range(expected_steps))}"
            )

        return True, ""

    def _validate_code_snippet_literals(self, code: str, section: Section) -> Tuple[bool, str]:
        snippets = section.code_snippets or []
        if section.layout_mode not in {"with_code", "full_code"}:
            return True, ""
        try:
            tree = ast.parse(code)
        except SyntaxError as exc:
            return False, f"SyntaxError during code literal validation: {exc}"
        uses_standard_code_block = any(
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "self"
            and node.func.attr == "create_code_block"
            for node in ast.walk(tree)
        )
        if not uses_standard_code_block:
            return False, (
                "with_code/full_code scenes must render snippets through "
                "self.create_code_block(), not Text()"
            )
        string_literals = [
            node.value for node in ast.walk(tree)
            if isinstance(node, ast.Constant) and isinstance(node.value, str)
        ]
        missing = [
            index for index, snippet in enumerate(snippets)
            if not any(snippet in literal for literal in string_literals)
        ]
        if missing:
            return False, f"generated scene omits exact code_snippets pages: {missing}"
        if section.layout_mode == "full_code" and "".join(snippets) != self.solution_code:
            return False, "full_code snippets no longer reconstruct the exact solution_code"
        return True, ""

    def _validate_persisted_code_literals(self, section_id: str, code: str) -> Tuple[bool, str]:
        for filename in ("storyboard_with_assets.json", "storyboard.json"):
            path = self.output_dir / filename
            if not path.exists():
                continue
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                section_data = next(
                    item for item in payload.get("sections", [])
                    if item.get("id") == section_id
                )
            except (ValueError, StopIteration, TypeError, json.JSONDecodeError):
                continue
            proxy = Section(
                id=section_id,
                title=str(section_data.get("title") or section_id),
                lecture_lines=list(section_data.get("lecture_lines") or []),
                animations=list(section_data.get("animations") or []),
                layout_mode=str(section_data.get("layout_mode") or "no_code"),
                code_snippets=list(section_data.get("code_snippets") or []),
            )
            return self._validate_code_snippet_literals(code, proxy)
        return True, ""

    def generate_outline(self) -> TeachingOutline:
        self._ensure_duration_resolved()
        outline_file = self.output_dir / "outline.json"
        outline_data = None

        if outline_file.exists():
            print("馃搨 姝ｅ湪璇诲彇澶х翰...")
            try:
                with open(outline_file, "r", encoding="utf-8") as f:
                    cached_outline = json.load(f)
                cached_outline, cache_errors = self._validate_outline_payload(cached_outline)
                if cache_errors:
                    print("Outline cache is stale; regenerating: " + "; ".join(cache_errors))
                else:
                    outline_data = cached_outline
            except Exception as exc:
                print(f"鈾伙笍 澶х翰缂撳瓨涓嶅彲鐢紝灏嗛噸鏂扮敓鎴愶細{exc}")

        if outline_data is None:
            # Step 1: Generate teaching outline from topic
            refer_img_path = (
                self.knowledge_ref_img_folder / img_name
                if (img_name := self.KNOWLEDGE2PATH.get(self.learning_topic)) is not None
                else None
            )
            prompt1 = get_prompt1_outline(
                problem_description=self.problem_description,
                solution_code=self.solution_code,
                duration=self.duration, 
                reference_image_path=refer_img_path,
                user_profile=self.user_profile,
                forced_difficulty_level=self.forced_difficulty_level,
            )

            print(f"馃摑 姝ｅ湪鐢熸垚澶х翰...")

            for attempt in range(1, self.max_regenerate_tries + 1):
                self.retry_summary["outline_attempts"] = attempt
                api_func = self._request_api_and_track_tokens if refer_img_path else self._request_api_and_track_tokens
                validation_note = ""
                if attempt > 1 and 'outline_errors' in locals() and outline_errors:
                    validation_note = "\n\n涓婁竴娆¤緭鍑烘湭閫氳繃鏍￠獙锛岃閫愰」淇锛歕n- " + "\n- ".join(outline_errors)
                response = api_func(prompt1 + validation_note, max_tokens=self.max_code_token_length)
                if response is None:
                    print(f"鈿狅笍 绗?{attempt} 娆″皾璇曞け璐ワ紝姝ｅ湪閲嶈瘯...")
                    if attempt == self.max_regenerate_tries:
                        raise ValueError("API 璇锋眰澶氭澶辫触")
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
                        print(f"鈿狅笍 绗?{attempt} 娆″ぇ绾茬粨鏋勬牎楠屽け璐ワ細" + "; ".join(outline_errors))
                        outline_data = None
                        if attempt == self.max_regenerate_tries:
                            raise ValueError("Outline schema remained invalid: " + "; ".join(outline_errors))
                        continue
                    with open(self.output_dir / "outline.json", "w", encoding="utf-8") as f:
                        json.dump(outline_data, f, ensure_ascii=False, indent=2)
                    break
                except json.JSONDecodeError:
                    print(f"鈿狅笍 绗?{attempt} 娆″皾璇曞ぇ绾叉牸寮忔棤鏁堬紝姝ｅ湪閲嶈瘯...")
                    if attempt == self.max_regenerate_tries:
                        raise ValueError("澶х翰鏍煎紡澶氭鏃犳晥锛岃妫€鏌ユ彁绀鸿瘝鎴?API 鍝嶅簲")

        self.outline = TeachingOutline(
            topic=outline_data["topic"],
            target_audience=outline_data["target_audience"],
            sections=outline_data["sections"],
            teaching_schema_version=outline_data["teaching_schema_version"],
            factuality_anchor_checklist=outline_data.get("factuality_anchor_checklist"),
            scaffold_map=outline_data.get("scaffold_map"),
            difficulty_level=outline_data.get("difficulty_level"),
        )
        print(f"== 澶х翰宸茬敓鎴? {self.outline.topic}")
        return self.outline

    def generate_storyboard(self) -> List[Section]:
        # Step 2: Generate teaching storyboard from outline.
        if not self.outline:
            raise ValueError("澶х翰鏈敓鎴愶紝璇峰厛鐢熸垚澶х翰")

        storyboard_file = self.output_dir / "storyboard.json"
        enhanced_storyboard_file = self.output_dir / "storyboard_with_assets.json"
        self.enhanced_storyboard = None

        for cache_file in (enhanced_storyboard_file, storyboard_file):
            if not cache_file.exists():
                continue
            try:
                print(f"馃搨 姝ｅ湪妫€鏌ュ垎闀滅紦瀛橈細{cache_file.name}")
                with open(cache_file, "r", encoding="utf-8") as f:
                    cached_storyboard = wrap_storyboard_lecture_lines(json.load(f))
                cached_storyboard = self._repair_storyboard_payload(cached_storyboard)
                cached_storyboard, cache_errors = self._validate_storyboard_payload(cached_storyboard)
                if cache_errors:
                    print("鈾伙笍 鍒嗛暅缂撳瓨宸茶繃鏈燂細" + "; ".join(cache_errors))
                    continue
                if cache_file == storyboard_file and self.use_assets:
                    cached_storyboard = wrap_storyboard_lecture_lines(
                        self._enhance_storyboard_with_assets(cached_storyboard)
                    )
                    cached_storyboard = self._repair_storyboard_payload(cached_storyboard)
                    cached_storyboard, enhanced_errors = self._validate_storyboard_payload(cached_storyboard)
                    if enhanced_errors:
                        print("鈾伙笍 绱犳潗澧炲己缁撴灉鐮村潖鏁欏缁撴瀯锛屽皢閲嶇敓鎴愶細" + "; ".join(enhanced_errors))
                        continue
                self.enhanced_storyboard = cached_storyboard
                break
            except Exception as exc:
                print(f"鈾伙笍 鍒嗛暅缂撳瓨涓嶅彲鐢細{exc}")

        if self.enhanced_storyboard is None:
            print("馃幀 姝ｅ湪鐢熸垚鍒嗛暅鑴氭湰...")
            refer_img_path = (
                self.knowledge_ref_img_folder / img_name
                if (img_name := self.KNOWLEDGE2PATH.get(self.learning_topic)) is not None
                else None
            )

            prompt2 = get_prompt2_storyboard(
                outline=json.dumps(self.outline.__dict__, ensure_ascii=False, indent=2),
                solution_code=self.solution_code,
                reference_image_path=refer_img_path,
                user_profile=self.user_profile
            )

            for attempt in range(1, self.max_regenerate_tries + 1):
                self.retry_summary["storyboard_attempts"] = attempt
                api_func = self._request_api_and_track_tokens
                validation_note = ""
                if attempt > 1 and 'storyboard_errors' in locals() and storyboard_errors:
                    validation_note = "\n\n涓婁竴娆¤緭鍑烘湭閫氳繃鏍￠獙锛岃閫愰」淇锛歕n- " + "\n- ".join(storyboard_errors)
                response = api_func(prompt2 + validation_note, max_tokens=self.max_code_token_length)
                if response is None:
                    print(f"鈿狅笍 绗?{attempt} 娆″皾璇?API 璇锋眰澶辫触锛屾鍦ㄩ噸璇?..")
                    if attempt == self.max_regenerate_tries:
                        raise ValueError("API 璇锋眰澶氭澶辫触")
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
                    candidate = wrap_storyboard_lecture_lines(json.loads(json_str))
                    candidate = self._repair_storyboard_payload(candidate)
                    storyboard_data, storyboard_errors = self._validate_storyboard_payload(candidate)
                    if storyboard_errors:
                        print(f"鈿狅笍 绗?{attempt} 娆″垎闀滅粨鏋勬牎楠屽け璐ワ細" + "; ".join(storyboard_errors))
                        if attempt == self.max_regenerate_tries:
                            raise ValueError("Storyboard schema remained invalid: " + "; ".join(storyboard_errors))
                        continue

                    # Save original storyboard
                    with open(storyboard_file, "w", encoding="utf-8") as f:
                        json.dump(storyboard_data, f, ensure_ascii=False, indent=2)

                    # Enhance storyboard (add assets)
                    if self.use_assets:
                        self.enhanced_storyboard = wrap_storyboard_lecture_lines(
                            self._enhance_storyboard_with_assets(storyboard_data)
                        )
                    else:
                        self.enhanced_storyboard = storyboard_data
                    self.enhanced_storyboard = self._repair_storyboard_payload(self.enhanced_storyboard)
                    self.enhanced_storyboard, enhanced_errors = self._validate_storyboard_payload(self.enhanced_storyboard)
                    if enhanced_errors:
                        raise ValueError("Enhanced storyboard schema is invalid: " + "; ".join(enhanced_errors))
                    break

                except json.JSONDecodeError as e:
                    print(f"鈿狅笍 绗?{attempt} 娆″皾璇曞垎闀滄牸寮忔棤鏁堬紝姝ｅ湪閲嶈瘯...")
                    print(f"鉂?JSON Error: {e}")
                    print(f"鉂?Content snippet: {content[:1000]}...") 
                    if attempt == self.max_regenerate_tries:
                        raise ValueError("鍒嗛暅鏍煎紡澶氭鏃犳晥锛岃妫€鏌ユ彁绀鸿瘝鎴?API 鍝嶅簲")

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
                estimated_duration=section_data.get("estimated_duration"),  # 瑙ｆ瀽棰勮鏃堕暱
                highlight_groups=section_data.get("highlight_groups"),
                evidence_lines_indices=section_data.get("evidence_lines_indices"),
                zpd_check_line_index=section_data.get("zpd_check_line_index"),
                bridge_line_index=section_data.get("bridge_line_index"),
                new_terms_introduced=section_data.get("new_terms_introduced"),
                layout_mode=section_data.get("layout_mode", "no_code"),
                code_snippets=section_data.get("code_snippets", []),
            )
            self.sections.append(section)

        normalized_path = enhanced_storyboard_file if self.use_assets else storyboard_file
        with open(normalized_path, "w", encoding="utf-8") as f:
            json.dump(self.enhanced_storyboard, f, ensure_ascii=False, indent=2)

        print(f"== Storyboard processing complete, generated {len(self.sections)} sections")
        return self.sections

    def _enhance_storyboard_with_assets(self, storyboard_data: dict) -> dict:
        # Enhance storyboard with assets.
        print("馃 姝ｅ湪澧炲己鍒嗛暅锛氭櫤鑳藉垎鏋愬苟涓嬭浇绱犳潗...")

        try:
            enhanced_storyboard = process_storyboard_with_assets(
                storyboard=storyboard_data,
                api_function=self.API,
                assets_dir=str(self.assets_dir),
                iconfinder_api_key=self.iconfinder_api_key,
            )
            enhanced_storyboard_file = self.output_dir / "storyboard_with_assets.json"
            with open(enhanced_storyboard_file, "w", encoding="utf-8") as f:
                json.dump(enhanced_storyboard, f, ensure_ascii=False, indent=2)
            print("Storyboard assets enhanced")
            return enhanced_storyboard

        except Exception as e:
            print(f"鈿狅笍 绱犳潗涓嬭浇澶辫触锛屼娇鐢ㄥ師濮嬪垎闀? {e}")
            return storyboard_data

    def inject_cover_section(self) -> None:
        """
        Inject a deterministic cover section at the beginning of the storyboard.
        """
        if not self.outline:
            print("Outline is not ready; skipping cover section injection")
            return

        if any(section.id == "section_cover" for section in self.sections):
            print("馃幀 灏侀潰 section 宸插瓨鍦紝璺宠繃娉ㄥ叆")
            return

        intro_text = f"本视频将讲解：{self.outline.topic}"

        cover_section = Section(
            id="section_cover",
            title=self.outline.topic,
            lecture_lines=[intro_text],
            animations=["Gradient background", "Create decoration lines", "FadeIn title", "FadeIn subtitle", "Play intro audio"],
            estimated_duration=10,
        )

        self.sections.insert(0, cover_section)
        print(f"Injected cover section for topic: {self.outline.topic}")

    def _generate_cover_code(self, section: Section) -> str:
        # Generate deterministic Manim code for the cover section.
        section_steps = self.prepare_section_steps(section)

        code = generate_cover_manim_code(
            topic=self.outline.topic,
            short_title=self.learning_topic,
            section_steps=section_steps,
        )

        code_file = self.output_dir / f"{section.id}.py"
        with open(code_file, "w", encoding="utf-8") as f:
            f.write(code)

        self.section_codes[section.id] = code
        print("Cover section code generated from template")
        return code

    def inject_overview_section(self) -> None:
        """
        Inject an overview section before generated body sections.
        """
        if not self.outline or not self.sections:
            print("Outline or sections are not ready; skipping overview injection")
            return

        if any(section.id == "section_overview" for section in self.sections):
            print("馃搵 姒傝堪 section 宸插瓨鍦紝璺宠繃娉ㄥ叆")
            return

        section_titles = [
            s.title for s in self.sections
            if s.id not in ("section_overview", "section_cover")
        ]

        print("Merging section titles for overview...")
        merged_titles = _merge_section_titles_with_ai(
            section_titles=section_titles,
            topic=self.outline.topic,
            api_func=self._request_api_and_track_tokens,
        )
        print(f"Merged {len(merged_titles)} overview titles: {merged_titles}")

        overview_lines = build_overview_lecture_lines(
            section_titles=merged_titles,
        )

        overview_section = Section(
            id="section_overview",
            title="解题导览",
            lecture_lines=overview_lines,
            animations=["FadeIn title", "Sequential FadeIn bullet points", "FadeIn ending"],
            estimated_duration=20,
        )

        self.sections.insert(0, overview_section)
        print(f"Injected overview section with {len(overview_lines)} lecture lines")

    def _generate_overview_code(self, section: Section) -> str:
        # Generate deterministic Manim code for the overview section.
        import re as _re

        section_steps = self.prepare_section_steps(section)

        merged_titles = []
        for line in section.lecture_lines:
            if line == OVERVIEW_INTRO_LINE:
                continue
            if line == OVERVIEW_ENDING_LINE:
                continue
            if line == "让我们开始吧！":
                continue

            match = _re.match(r"^第[一二三四五六七八九十\\d]+部分[:：](.+)$", line)
            if match:
                merged_titles.append(match.group(1).strip())
                continue

            cleaned = _re.sub(r"^[①②③④⑤⑥⑦⑧⑨⑩]\\s*", "", line)
            if cleaned and cleaned != line:
                merged_titles.append(cleaned)

        code = generate_overview_manim_code(
            section_titles=merged_titles,
            section_steps=section_steps,
        )

        code = replace_base_class(code, base_class)

        code_file = self.output_dir / f"{section.id}.py"
        with open(code_file, "w", encoding="utf-8") as f:
            f.write(code)

        self.section_codes[section.id] = code
        print("Overview section code generated from template")
        return code

    def generate_section_code(self, section: Section, attempt: int = 1, feedback_improvements=None, error_message: str = None) -> str:
        # Generate Manim code for a single section.
        if not feedback_improvements:
            self._set_section_versions_used(
                section.id,
                max(self._section_versions_used(section.id), min(self.max_attempts, int(attempt))),
            )

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
            print(f"馃搨 鍙戠幇 {section.id} 鐨勭幇鏈変唬鐮侊紝姝ｅ湪璇诲彇...")
            with open(steps_file, "r", encoding="utf-8") as f:
                self.section_steps[section.id] = json.load(f)
            with open(code_file, "r", encoding="utf-8") as f:
                code = f.read()
            code, fixes = normalize_known_scene_tokens(code)
            try:
                find_scene_class_name(code)
                is_valid, _ = self._validate_synced_step_coverage(
                    code, len(self.section_steps[section.id])
                )
            except Exception:
                is_valid = False
            if is_valid:
                if fixes:
                    code_file.write_text(code, encoding="utf-8")
                self.section_codes[section.id] = code
                return code
            print(f"鈾伙笍 {section.id} 浠ｇ爜涓庡綋鍓嶆梺鐧芥楠や笉涓€鑷达紝鍙噸鐢熸垚璇ヨ妭浠ｇ爜")

        if not feedback_improvements:
            if section.id == "section_cover":
                return self._generate_cover_code(section)
            if section.id == "section_overview":
                return self._generate_overview_code(section)

        # print(f"馃捇 姝ｅ湪涓?{section.id} 鐢熸垚 Manim 浠ｇ爜 (灏濊瘯 {attempt}/{self.max_regenerate_tries})...")
        regenerate_note = ""
        if attempt > 1:
            # 浠呯敤浜庤繍琛屽け璐ョ殑鎯呭喌
            regenerate_note = get_regenerate_note(
                attempt, 
                MAX_REGENERATE_TRIES=self.max_regenerate_tries,
                error_message=error_message
            )

        # Add MLLM feedback and improvement suggestions
        if feedback_improvements:
            current_code = self.section_codes.get(section.id, "")
            versions_used = self._section_versions_used(section.id)
            if versions_used >= self.max_attempts:
                raise RuntimeError(f"{section.id} 宸茬敤瀹屼笁涓唬鐮佺増鏈紝涓嶈兘缁х画瑙嗚鏀瑰啓")
            try:
                modifier = GridCodeModifier(current_code)
                modified_code = modifier.parse_feedback_and_modify(feedback_improvements)
                modified_code = fix_png_path(modified_code, self.assets_dir)
                if modified_code.strip() == current_code.strip():
                    raise ValueError("structured modifier produced no verifiable local code changes")
                modified_code, _ = normalize_known_scene_tokens(modified_code)
                find_scene_class_name(modified_code)
                with open(code_file, "w", encoding="utf-8") as f:
                    f.write(modified_code)

                self.section_codes[section.id] = modified_code
                self._set_section_versions_used(section.id, versions_used + 1)
                return modified_code
            except Exception as e:
                raise ValueError(f"瑙嗚灞€閮ㄨˉ涓佷笉鍙簲鐢紝淇濈暀鍘熺珷鑺? {e}") from e

        else:
            section_steps = self.prepare_section_steps(section)
            code_gen_prompt = get_prompt3_code(
                regenerate_note=regenerate_note, 
                section=section, 
                section_steps=section_steps,
                base_class=base_class,
                user_profile=self.user_profile,
                estimated_duration=section.estimated_duration,
                solution_code=self.solution_code,
            )

        response = self._request_api_and_track_tokens(code_gen_prompt, max_tokens=self.max_code_token_length)
        if response is None:
            print(f"API failed to generate code for {section.id}")
            if not feedback_improvements and attempt < self.max_regenerate_tries:
                return self.generate_section_code(
                    section=section,
                    attempt=attempt + 1,
                    error_message="code generation API returned no content",
                )
            raise RuntimeError(f"{section.id} code generation API returned no content")

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
        code, token_fixes = normalize_known_scene_tokens(code)
        find_scene_class_name(code)
        if token_fixes:
            print(f"馃З {section.id} 鏈湴琛ュ叏鍥哄畾璁捐浠ょ墝: {', '.join(token_fixes)}")

        snippets_valid, snippets_error = self._validate_code_snippet_literals(code, section)
        if not snippets_valid:
            if attempt < self.max_regenerate_tries and not feedback_improvements:
                return self.generate_section_code(
                    section=section,
                    attempt=attempt + 1,
                    error_message=snippets_error,
                )
            raise ValueError(snippets_error)

        if not feedback_improvements:
            is_valid, validation_error = self._validate_synced_step_coverage(code, len(section_steps))
            if not is_valid:
                if attempt < self.max_regenerate_tries:
                    print(f"鈿狅笍 {section.id} 浠ｇ爜鏈鐩栧叏閮ㄩ煶棰戞楠わ紝閲嶆柊鐢熸垚: {validation_error}")
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
                    print(f"鈾伙笍 {section.id} 浠呬慨澶嶇己澶辨垨鎹熷潖鐨勬梺鐧介煶棰戯紝淇濈暀鍏朵綑闊抽缂撳瓨")
                self.section_steps[section.id] = section_steps
                return section_steps
            print(f"{section.id} narration cache changed; rebuilding this section only")

        section_steps = build_section_steps(
            section=section,
            output_root=self.output_dir,
            api_func=self._request_api_and_track_tokens,
            target_audio_seconds=target_audio_seconds,
        )
        save_section_steps(section_steps, steps_file)
        self.section_steps[section.id] = section_steps
        return section_steps

    def prepare_all_narration_steps(self, max_rounds: int = 3) -> Dict[str, List[dict]]:
        # Allocate narration budgets and adjust them using rendered audio durations.
        max_rounds = min(self.max_attempts, max(1, int(max_rounds)))
        if self.duration is None:
            self._ensure_duration_resolved()
        target_final_seconds = float(self.duration * 60)
        transition_budget = min(30.0, max(8.0, len(self.sections) * 1.0))
        desired_narration_seconds = max(1.0, target_final_seconds - transition_budget)
        acceptable_range = (
            max(1.0, target_final_seconds * 0.85 - transition_budget),
            target_final_seconds * 1.30 - transition_budget,
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

            measured_total = sum(
                sum(float(step.get("audio_duration") or 0.0) for step in self.section_steps[section.id])
                for section in self.sections
            )
            self.actual_narration_seconds = measured_total
            self.retry_summary["narration_attempts"] = round_index + 1
            print(f"Narration round {round_index + 1}/{max_rounds}: {measured_total:.2f}s; target {target_final_seconds:.2f}s")
            if acceptable_range[0] <= measured_total <= acceptable_range[1]:
                return self.section_steps
            if measured_total <= 0:
                raise ValueError("TTS physical duration is zero")
            ratio = desired_narration_seconds / measured_total
            scale = min(1.35, max(0.75, ratio ** 2.5))
            targets = {
                section.id: max(2.0, targets[section.id] * scale)
                for section in self.sections
            }

        message = (
            f"Narration is {self.actual_narration_seconds:.2f}s after {max_rounds} attempts; "
            f"outside target range {acceptable_range[0]:.2f}-{acceptable_range[1]:.2f}s, continuing with complete video."
        )
        print(f"鈿狅笍 {message}")
        self._add_warning(
            "duration_target_missed",
            message,
            actual_narration_seconds=self.actual_narration_seconds,
            accepted_narration_seconds=list(acceptable_range),
        )
        return self.section_steps

    def debug_and_fix_code(
        self,
        section_id: str,
        max_fix_attempts: int = 3,
        *,
        render_profile=None,
        force_render: bool = False,
        allow_code_repair: bool = True,
    ) -> Tuple[bool, Optional[str]]:
        # Render one section while sharing the section version budget.
        code_path = self.output_dir / f"{section_id}.py"
        if section_id not in self.section_codes:
            if not code_path.exists():
                return False, "code file does not exist"
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
        versions_used = max(1, self._section_versions_used(section_id))
        self._set_section_versions_used(section_id, versions_used)
        remaining_versions = max(0, self.max_attempts - versions_used)
        render_attempt_limit = 1 + (remaining_versions if allow_code_repair else 0)
        render_attempt_limit = max(1, min(int(max_fix_attempts), render_attempt_limit))

        for fix_attempt in range(render_attempt_limit):
            section_retry = self.retry_summary.setdefault("sections", {}).setdefault(section_id, {})
            section_retry[f"{profile.name}_render_attempts"] = fix_attempt + 1
            code, token_fixes = normalize_known_scene_tokens(self.section_codes[section_id])
            if token_fixes or code != self.section_codes[section_id]:
                self.section_codes[section_id] = code
                code_path.write_text(code, encoding="utf-8")
            try:
                preferred_scene = find_scene_class_name(code)
            except Exception as exc:
                preferred_scene = ""
                last_error = str(exc)
            fingerprint = render_fingerprint(code, steps, profile)
            render_root = self.output_dir / "render_cache" / profile.name / section_id / fingerprint
            remuxed_path = (
                self.output_dir / "audio_remux" / profile.name / section_id / fingerprint
                / f"{section_id}_with_audio.mp4"
            )

            if not force_render and remuxed_path.exists():
                try:
                    validate_rendered_media(
                        remuxed_path,
                        profile,
                        require_audio=True,
                    )
                    self.section_videos[section_id] = str(remuxed_path)
                    print(f"鉁?{section_id} 鍛戒腑鍐呭鎸囩汗缂撳瓨: {profile.name}/{fingerprint}")
                    return True, None
                except Exception as exc:
                    print(f"鈾伙笍 {section_id} 鎸囩汗缂撳瓨鏃犳晥锛屽皢閲嶆柊娓叉煋: {exc}")

            try:
                if not preferred_scene:
                    raise ValueError(last_error or "娌℃湁鎵惧埌鍙墽琛岀殑鍏蜂綋 Scene")
                snippets_valid, snippets_error = self._validate_persisted_code_literals(section_id, code)
                if not snippets_valid:
                    raise ValueError(snippets_error)
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
                timeout_seconds = int(os.getenv(
                    "MANIM_RENDER_TIMEOUT_SECONDS",
                    "21600" if profile.width >= 3840 else "3600",
                ))
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
                    code_path.name,
                    preferred_scene,
                ]
                print(
                    f"馃敡 {self.learning_topic} 娓叉煋 {section_id} [{profile.name}] "
                    f"({fix_attempt + 1}/{max_fix_attempts}, {fingerprint})"
                )
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
                fixed_media = validate_rendered_media(
                    fixed_video,
                    profile,
                    require_audio=True,
                )
                if fixed_media["video_codec"] != "h264":
                    raise ValueError(f"video codec must be H.264, got {fixed_media['video_codec']}")
                if fixed_media["pixel_format"] != "yuv420p":
                    raise ValueError(f"pixel format must be yuv420p, got {fixed_media['pixel_format']}")
                if fixed_media["audio_codec"] != "aac":
                    raise ValueError(f"audio codec must be AAC, got {fixed_media['audio_codec']}")
                self.section_videos[section_id] = str(fixed_video)
                return True, None
            except subprocess.TimeoutExpired:
                last_error = f"Manim {profile.name} 娓叉煋瓒呮椂"
            except Exception as exc:
                last_error = str(exc)

            print(f"鉂?{section_id} {profile.name} 娓叉煋澶辫触: {last_error}")
            if not allow_code_repair or fix_attempt + 1 >= render_attempt_limit:
                break
            fixed_code = self.scope_refine_fixer.fix_code_smart(
                section_id,
                self.section_codes[section_id],
                last_error,
                self.output_dir,
            )
            if not fixed_code:
                break
            fixed_code, _ = normalize_known_scene_tokens(fixed_code)
            try:
                find_scene_class_name(fixed_code)
            except Exception as exc:
                last_error = f"repaired code precheck failed: {exc}"
                break
            if fixed_code.strip() == self.section_codes[section_id].strip():
                last_error = "repair produced no code changes"
                break
            self.section_codes[section_id] = fixed_code
            code_path.write_text(fixed_code, encoding="utf-8")
            versions_used += 1
            self._set_section_versions_used(section_id, versions_used)
            force_render = True

        return False, last_error

    def get_mllm_feedback(self, section: Section, video_path: str, round_number: int = 1) -> VideoFeedback:
        print(f"馃 {self.learning_topic} 浣跨敤 MLLM 鍒嗘瀽瑙嗛 ({round_number}/{self.feedback_rounds}): {section.id}")

        current_code = self.section_codes[section.id]
        positions = self.extractor.extract_grid_positions(current_code)
        position_table = self.extractor.generate_position_table(positions)
        if section.id in {"section_cover", "section_overview"}:
            analysis_prompt = (
                "你是严格的视频布局质检员。当前片段是封面或全屏导览。\n"
                "只把真实可见的硬问题判为问题：文字或图形遮挡、元素被裁切、低对比度、乱码、旧元素残留、元素过早出现或过晚消失、逐句旁白字幕框。\n"
                f"片段标题：{section.title}\n"
                f"画面文字：{'；'.join(section.lecture_lines)}\n"
                '只输出合法 JSON：{"layout": {"has_issues": false, "improvements": []}}\n'
                "如确有问题，improvements 最多三项，每项包含 problem、solution、timestamp、line_number、object_affected。\n"
            )
        else:
            analysis_prompt = get_prompt4_layout_feedback(section=section, position_table=position_table)
        analysis_prompt += (
            "\n交付前只检查会破坏可用性的硬问题，不评价美观、教学深度或可选润色。\n"
            "如果能用固定网格定位调用修复，请在 improvement 中额外返回 line_number 和 new_code；"
            "new_code 必须是该行完整的 self.place_at_grid(...) 或 self.place_in_area(...) 调用。\n"
        )
        transition_timestamps: List[float] = []
        cursor = 0.0
        previous_page = None
        for step in self.section_steps.get(section.id, []):
            page = step.get("page_index")
            if previous_page is not None and page != previous_page:
                transition_timestamps.append(cursor)
            cursor += float(step.get("audio_duration") or 0.0)
            previous_page = page

        def _parse_layout(feedback_content):
            try:
                data = json.loads(extract_json_from_markdown(feedback_content))
            except Exception:
                match = re.search(r'"has_issues"\s*:\s*(true|false)', feedback_content, re.I)
                if not match:
                    raise ValueError("layout feedback does not contain has_issues")
                data = {"layout": {"has_issues": match.group(1).lower() == "true", "improvements": []}}
            layout = data.get("layout")
            if not isinstance(layout, dict) or not isinstance(layout.get("has_issues"), bool):
                raise ValueError("layout.has_issues must be boolean")
            improvements = layout.get("improvements")
            if not isinstance(improvements, list):
                raise ValueError("layout.improvements must be a list")
            suggested = []
            for item in improvements:
                if not isinstance(item, dict):
                    raise ValueError("layout improvement must be an object")
                problem = str(item.get("problem") or "").strip()
                solution = str(item.get("solution") or "").strip()
                timestamp = str(item.get("timestamp") or "").strip()
                if not problem or not solution:
                    raise ValueError("layout improvement requires problem and solution")
                line_number = item.get("line_number")
                new_code = str(item.get("new_code") or "").strip()
                patch = f" Line {line_number}: {new_code}" if line_number and new_code else ""
                suggested.append(f"[LAYOUT {timestamp}] Problem: {problem}; Solution:{patch or (' ' + solution)}")
            return layout["has_issues"], suggested

        try:
            response = request_gemini_video_img(
                prompt=analysis_prompt,
                video_path=video_path,
                image_path=self.GRID_IMG_PATH,
                sample_timestamps=transition_timestamps,
                max_retries=1,
            )
            feedback_content = extract_answer_from_response(response)
            layout_result = _parse_layout(feedback_content)
            has_layout_issues, suggested_improvements = layout_result
            feedback = VideoFeedback(
                section_id=section.id,
                video_path=video_path,
                has_issues=has_layout_issues,
                suggested_improvements=suggested_improvements,
                raw_response=feedback_content,
                is_good_enough=not has_layout_issues,
                good_enough_reason="Checked only hard visual integrity issues before delivery.",
                evaluation_scores={"hard_visual_integrity": 20.0 if not has_layout_issues else 0.0},
            )
            self.video_feedbacks[f"{section.id}_round{round_number}"] = feedback
            return feedback

        except Exception as e:
            print(f"鉂?{self.learning_topic} MLLM 鍒嗘瀽澶辫触: {str(e)}")
            return VideoFeedback(
                section_id=section.id,
                video_path=video_path,
                has_issues=True,
                suggested_improvements=[],
                raw_response=f"Error: {str(e)}",
            )

    def optimize_with_feedback(self, section: Section, feedback: VideoFeedback) -> bool:
        # Apply visual feedback transactionally and force rerender when code changes.
        if not feedback.has_issues or not feedback.suggested_improvements:
            print(f"鉁?{self.learning_topic} {section.id} 鏃犻渶浼樺寲")
            return True

        original_code_content = self.section_codes[section.id]
        original_video_path = self.section_videos.get(section.id)
        code_path = self.output_dir / f"{section.id}.py"

        print(f"馃幆 {self.learning_topic} 鏍规嵁鏈疆瑙嗚鍙嶉淇 {section.id}")
        try:
            self.section_codes[section.id] = original_code_content
            code_path.write_text(original_code_content, encoding="utf-8")
            self.generate_section_code(
                section=section, attempt=1, feedback_improvements=feedback.suggested_improvements
            )
            snippets_valid, snippets_error = self._validate_code_snippet_literals(
                self.section_codes[section.id],
                section,
            )
            if not snippets_valid:
                print(f"鈿狅笍 {section.id} 瑙嗚淇鐮村潖鏍囧噯绛旀灞曠ず锛岀珛鍗冲洖婊? {snippets_error}")
                self.section_codes[section.id] = original_code_content
                code_path.write_text(original_code_content, encoding="utf-8")
                if original_video_path:
                    self.section_videos[section.id] = original_video_path
                raise ValueError(snippets_error)
            timeline_valid, timeline_error = self._validate_synced_step_coverage(
                self.section_codes[section.id],
                len(self.section_steps[section.id]),
            )
            if not timeline_valid:
                print(f"鈿狅笍 {section.id} 瑙嗚淇鐮村潖鏃佺櫧鏃堕棿杞达紝绔嬪嵆鍥炴粴: {timeline_error}")
                self.section_codes[section.id] = original_code_content
                code_path.write_text(original_code_content, encoding="utf-8")
                if original_video_path:
                    self.section_videos[section.id] = original_video_path
                raise ValueError(timeline_error)
            success, _ = self.debug_and_fix_code(
                section.id,
                max_fix_attempts=1,
                render_profile=self.preview_render_profile,
                force_render=True,
            )
            if success:
                print(f"鉁?{self.learning_topic} {section.id} 鏂颁唬鐮佸凡鎸夋柊鎸囩汗閲嶆柊娓叉煋")
                return True
            raise RuntimeError("瑙嗚淇鍚庣殑浠ｇ爜鏈兘鎴愬姛娓叉煋")
        except Exception as exc:
            print(f"鈿狅笍 {self.learning_topic} {section.id} 鏈疆瑙嗚浼樺寲澶辫触锛屽洖婊? {exc}")
        self.section_codes[section.id] = original_code_content
        code_path.write_text(original_code_content, encoding="utf-8")
        if original_video_path:
            self.section_videos[section.id] = original_video_path
        return False

    def _load_pinned_sections(self) -> Dict[str, Any]:
        pinned_cache_path = self.output_dir / "pinned_final_sections.json"
        pinned_sections = {}
        if pinned_cache_path.exists():
            try:
                pinned_sections = json.loads(pinned_cache_path.read_text(encoding="utf-8"))
            except Exception:
                pinned_sections = {}
        return pinned_sections

    def _generate_section_code_task(
        self,
        section: Section,
        pinned_sections: Dict[str, Any],
    ) -> Tuple[str, Optional[Exception]]:
        """Generate one section and ensure a renderable source file is on disk."""
        try:
            pinned = pinned_sections.get(section.id)
            if isinstance(pinned, dict):
                code_path = self.output_dir / f"{section.id}.py"
                if code_path.exists():
                    cached_code = code_path.read_text(encoding="utf-8")
                    current_fingerprint = render_fingerprint(
                        cached_code,
                        self.section_steps[section.id],
                        self.render_profile,
                    )
                    if (
                        pinned.get("profile") == self.render_profile.name
                        and pinned.get("fingerprint") == current_fingerprint
                    ):
                        self.section_codes[section.id] = cached_code
                        print(f"鉁?{section.id} 鍐呭鎸囩汗涓庢樉寮忛獙鏀惰褰曚竴鑷达紝澶嶇敤婧愮爜")
                        return section.id, None
            self.generate_section_code(section, attempt=1)
            return section.id, None
        except Exception as exc:
            try:
                self._install_fallback_code(section, f"浠ｇ爜鐢熸垚涓夋浠嶅け璐? {exc}")
                return section.id, None
            except Exception as fallback_error:
                return section.id, fallback_error

    def generate_codes(self) -> Dict[str, str]:
        if not self.sections:
            raise ValueError(f"{self.learning_topic} 璇峰厛鐢熸垚鏁欏灏忚妭")
        self.prepare_all_narration_steps(max_rounds=self.max_attempts)
        pinned_sections = self._load_pinned_sections()

        with ThreadPoolExecutor(max_workers=6) as executor:
            futures = {
                executor.submit(self._generate_section_code_task, section, pinned_sections): section
                for section in self.sections
            }
            failures = []
            for future in as_completed(futures):
                section_id, err = future.result()
                if err:
                    print(f"鉂?{self.learning_topic} {section_id} 浠ｇ爜鐢熸垚澶辫触: {err}")
                    section = next(item for item in self.sections if item.id == section_id)
                    try:
                        self._install_fallback_code(section, str(err))
                        print(f"馃洘 {section_id} 宸插湪浠ｇ爜鐢熸垚闃舵鍒囨崲绋冲畾淇濆簳妯℃澘")
                    except Exception as fallback_exc:
                        failures.append((section_id, f"{err}; fallback={fallback_exc}"))

        missing = [section.id for section in self.sections if section.id not in self.section_codes]
        if failures or missing:
            raise RuntimeError(f"鍒嗚妭浠ｇ爜鐢熸垚涓嶅畬鏁? failures={failures}, missing={missing}")

        return self.section_codes

    def render_section(self, section: Section, *, run_feedback: bool = True) -> bool:
        section_id = section.id
        self.actual_render_profile = self.preview_render_profile

        try:
            if section_id not in self.section_codes:
                code_path = self.output_dir / f"{section_id}.py"
                if code_path.exists():
                    self.section_codes[section_id] = code_path.read_text(encoding="utf-8")
            if section_id not in self.section_steps:
                steps_path = self.output_dir / f"{section_id}_steps.json"
                if steps_path.exists():
                    self.section_steps[section_id] = json.loads(steps_path.read_text(encoding="utf-8"))
            pinned_cache_path = self.output_dir / "pinned_final_sections.json"
            if pinned_cache_path.exists():
                try:
                    pinned_sections = json.loads(pinned_cache_path.read_text(encoding="utf-8"))
                    pinned_value = pinned_sections.get(section_id)
                    if isinstance(pinned_value, dict):
                        expected_fingerprint = render_fingerprint(
                            self.section_codes[section_id],
                            self.section_steps[section_id],
                            self.render_profile,
                        )
                        if (
                            pinned_value.get("profile") != self.render_profile.name
                            or pinned_value.get("fingerprint") != expected_fingerprint
                        ):
                            raise ValueError("pinned final section does not match current code, audio, or render profile")
                        pinned_video = Path(str(pinned_value.get("video_path") or ""))
                        if not pinned_video.is_absolute():
                            pinned_video = self.output_dir / pinned_video
                        validate_rendered_media(
                            pinned_video,
                            self.render_profile,
                            require_audio=True,
                        )
                        self.section_videos[section_id] = str(pinned_video)
                        self.pinned_final_reused.add(section_id)
                        print(f"{section_id} reused pinned accepted final section cache")
                        return True
                except Exception as exc:
                    print(f"鈾伙笍 {section_id} 鏄惧紡鏈€缁堢紦瀛樻棤鏁堬紝灏嗘甯告覆鏌? {exc}")

            success, last_error = self.debug_and_fix_code(
                section_id,
                max_fix_attempts=self.max_attempts,
                render_profile=self.preview_render_profile,
            )
            if not success:
                print(f"{self.learning_topic} {section_id} exhausted code versions; switching to fallback template")
                self._install_fallback_code(section, last_error or "preview render failed")
                success, last_error = self.debug_and_fix_code(
                    section_id,
                    max_fix_attempts=1,
                    render_profile=self.preview_render_profile,
                    force_render=True,
                    allow_code_repair=False,
                )
                if not success:
                    print(f"鉂?{self.learning_topic} {section_id} 淇濆簳妯℃澘浠嶆棤娉曟覆鏌? {last_error}")
                    return False
            preview_video_path = self.section_videos.get(section_id)

            if self.use_feedback and run_feedback:
                qa_fingerprint = render_fingerprint(
                    self.section_codes[section_id],
                    self.section_steps[section_id],
                    self.preview_render_profile,
                )
                qa_path = self.output_dir / "visual_qa_cache" / section_id / f"{qa_fingerprint}.json"
                passed_visual_qa = False
                qa_completed = False
                if qa_path.exists():
                    try:
                        cached_qa = json.loads(qa_path.read_text(encoding="utf-8"))
                        passed_visual_qa = cached_qa.get("passed") is True
                        qa_completed = cached_qa.get("completed") is True
                    except Exception:
                        pass
                review_completed = qa_completed

                has_visual_budget = self.remaining_pipeline_seconds() > self.finalize_reserve_seconds
                predelivery_rounds = 0 if qa_completed or not has_visual_budget else max(
                    0,
                    min(self.feedback_rounds, int(os.getenv("C2V_PREDELIVERY_FEEDBACK_ROUNDS", "2"))),
                )
                for round_number in range(1, predelivery_rounds + 1):
                    current_video = self.section_videos.get(section_id)
                    if not current_video:
                        break
                    feedback = self.get_mllm_feedback(section, current_video, round_number=round_number)
                    if (feedback.raw_response or "").startswith("Error:"):
                        print(f"鈿狅笍 {section_id} 瑙嗚璇勪环涓嶅彲鐢紱淇濈暀宸插畬鎴愮珷鑺傦紝绋嶅悗浠嶅彲缁х画浼樺寲")
                        review_completed = False
                        break
                    if not feedback.has_issues and feedback.is_good_enough:
                        passed_visual_qa = True
                        review_completed = True
                        break
                    if not feedback.suggested_improvements:
                        print(f"{section_id} feedback had no verifiable local patch; keeping preview render")
                        break
                    if not self.optimize_with_feedback(section, feedback):
                        break
                    review_completed = False

                # Visual review results are warning-only for delivery.
                review_completed = True

                qa_fingerprint = render_fingerprint(
                    self.section_codes[section_id],
                    self.section_steps[section_id],
                    self.preview_render_profile,
                )
                qa_path = self.output_dir / "visual_qa_cache" / section_id / f"{qa_fingerprint}.json"
                qa_path.parent.mkdir(parents=True, exist_ok=True)
                qa_path.write_text(json.dumps({
                    "completed": review_completed,
                    "passed": passed_visual_qa,
                    "section_id": section_id,
                    "fingerprint": qa_fingerprint,
                    "preview_profile": self.preview_render_profile.name,
                }, ensure_ascii=False, indent=2), encoding="utf-8")
                self.visual_quality_results[section_id] = {
                    "completed": review_completed,
                    "passed": passed_visual_qa,
                    "preview_profile": self.preview_render_profile.name,
                }

            preview_video_path = self.section_videos.get(section_id) or preview_video_path
            if preview_video_path:
                self.preview_video_paths[section_id] = preview_video_path

            return True

        except Exception as e:
            print(f"鉂?{self.learning_topic} {section_id} 娓叉煋杩囩▼寮傚父: {str(e)}")
            return False

    def render_section_worker(self, section_data) -> Tuple[str, bool, Optional[str], Dict[str, Any]]:
        section_id = "unknown"
        worker_started = time.time()
        try:
            section, agent_class, kwargs, run_feedback = section_data
            section_id = section.id
            agent = agent_class(**kwargs)
            success = agent.render_section(section, run_feedback=run_feedback)
            video_path = agent.section_videos.get(section.id) if success else None
            rounds = [{
                "key": key,
                "has_issues": feedback.has_issues,
                "is_good_enough": feedback.is_good_enough,
                "reason": feedback.good_enough_reason,
                "scores": feedback.evaluation_scores,
                "improvements": feedback.suggested_improvements,
            } for key, feedback in sorted(agent.video_feedbacks.items())]
            reused_final = section_id in agent.pinned_final_reused
            visual_passed = (
                reused_final
                or (not agent.use_feedback)
                or bool((agent.visual_quality_results.get(section_id) or {}).get("passed"))
                or any(
                    not feedback.has_issues
                    and feedback.is_good_enough
                    and not (feedback.raw_response or "").startswith("Error:")
                    for feedback in agent.video_feedbacks.values()
                )
            )
            quality = {
                "rendered": bool(success),
                "passed": bool(visual_passed),
                "preview_profile": agent.preview_render_profile.name,
                "final_profile": agent.actual_render_profile.name,
                "preview_video_path": agent.preview_video_paths.get(section_id),
                "feedback_enabled": agent.use_feedback,
                "quality_source": "pinned_accepted_final" if reused_final else "visual_feedback",
                "rounds": rounds,
                "warnings": agent.warnings,
                "section_fallback": agent.section_fallbacks.get(section_id),
                "preview_render_seconds": max(0.0, time.time() - worker_started),
                "retry_summary": {
                    **agent.retry_summary.get("sections", {}).get(section_id, {}),
                    "visual_review_rounds": len(rounds),
                },
            }
            return section_id, success, video_path, quality

        except Exception as e:
            print(f"鉂?{self.learning_topic} {section_id} 娓叉煋杩囩▼寮傚父: {str(e)}")
            return section_id, False, None, {"passed": False, "error": str(e)}

    def render_native_section_worker(self, section_data) -> Tuple[str, bool, Optional[str], Optional[str]]:
        # Render the requested native profile once without mutating code.
        section_id = "unknown"
        try:
            section, agent_class, kwargs, _ = section_data
            section_id = section.id
            agent = agent_class(**kwargs)
            success, error = agent.debug_and_fix_code(
                section_id,
                max_fix_attempts=1,
                render_profile=agent.render_profile,
                allow_code_repair=False,
            )
            return section_id, success, agent.section_videos.get(section_id) if success else None, error
        except Exception as exc:
            return section_id, False, None, str(exc)

    def generate_and_render_sections(
        self,
        max_render_workers: Optional[int] = None,
    ) -> Dict[str, str]:
        # Pipeline section code generation directly into the preview renderer.
        if not self.sections:
            raise ValueError(f"{self.learning_topic} 璇峰厛鐢熸垚鏁欏灏忚妭")

        narration_started = time.time()
        self.prepare_all_narration_steps(max_rounds=self.max_attempts)
        self.record_stage_timing("prepare_narration", narration_started)

        configured_render_workers = os.getenv("C2V_PREVIEW_RENDER_WORKERS") or os.getenv("C2V_RENDER_WORKERS")
        render_workers = (
            int(max_render_workers)
            if max_render_workers is not None
            else int(configured_render_workers) if configured_render_workers else 3
        )
        render_workers = max(1, render_workers)
        code_workers = max(1, int(os.getenv("C2V_CODE_WORKERS", "6")))
        pinned_sections = self._load_pinned_sections()
        section_by_id = {section.id: section for section in self.sections}
        baseline_results: Dict[str, str] = {}
        render_futures = {}
        code_failures: List[Tuple[str, str]] = []

        print(f"Starting section pipeline: code workers={code_workers}, preview render workers={render_workers}")
        # The first render job is submitted while code-generation threads are
        # active. Use spawn explicitly so Docker/Linux does not fork a
        # multithreaded parent process and inherit unsafe lock state.
        with ProcessPoolExecutor(
            max_workers=render_workers,
            mp_context=multiprocessing.get_context("spawn"),
        ) as render_executor:
            with ThreadPoolExecutor(max_workers=code_workers) as code_executor:
                code_futures = {
                    code_executor.submit(
                        self._generate_section_code_task,
                        section,
                        pinned_sections,
                    ): section.id
                    for section in self.sections
                }
                for code_future in as_completed(code_futures):
                    expected_section_id = code_futures[code_future]
                    try:
                        section_id, error = code_future.result()
                    except Exception as exc:
                        section_id, error = expected_section_id, exc

                    section = section_by_id[section_id]
                    if error is not None:
                        try:
                            self._install_fallback_code(section, str(error))
                            print(f"{section_id} switched to fallback template")
                        except Exception as fallback_exc:
                            code_failures.append((section_id, f"{error}; fallback={fallback_exc}"))
                            continue

                    task_data = (section, self.__class__, self.get_serializable_state(), False)
                    render_future = render_executor.submit(self.render_section_worker, task_data)
                    render_futures[render_future] = section_id
                    print(f"馃幀 {section_id} 浠ｇ爜宸茶惤鐩橈紝绔嬪嵆寮€濮?1080p 娓叉煋")

            for render_future in as_completed(render_futures):
                section_id = render_futures[render_future]
                try:
                    sid, success, video_path, quality = render_future.result()
                    self.visual_quality_results[sid] = quality
                    if quality.get("preview_render_seconds") is not None:
                        self.preview_render_seconds.append(float(quality["preview_render_seconds"]))
                    if success and video_path:
                        baseline_results[sid] = video_path
                        print(f"鉁?{sid} 1080p 鍩虹嚎娓叉煋鎴愬姛: {video_path}")
                    else:
                        print(f"鈿狅笍 {sid} 1080p 鍩虹嚎娓叉煋澶辫触")
                except Exception as exc:
                    print(f"鉂?{section_id} 1080p 鍩虹嚎娓叉煋杩囩▼閿欒: {exc}")

        if code_failures:
            print(f"鈿狅笍 娴佹按绾夸腑鏈夌珷鑺傛棤娉曞舰鎴愪唬鐮佹垨淇濆簳浠ｇ爜: {code_failures}")

        missing_codes = [section.id for section in self.sections if section.id not in self.section_codes]
        if missing_codes:
            print(f"鈿狅笍 娴佹按绾跨己灏戠珷鑺備唬鐮侊紝灏嗙敱瀹屾暣鎬ф鏌ョ粓姝㈢己绔犱氦浠? {missing_codes}")

        return self.render_all_sections(
            max_workers=render_workers,
            baseline_results=baseline_results,
        )

    def render_all_sections(
        self,
        max_workers: Optional[int] = None,
        *,
        baseline_results: Optional[Dict[str, str]] = None,
    ) -> Dict[str, str]:
        if max_workers is None:
            configured = os.getenv("C2V_PREVIEW_RENDER_WORKERS") or os.getenv("C2V_RENDER_WORKERS")
            max_workers = int(configured) if configured else 3
        if baseline_results is None:
            print(f"馃帴 鍏堝苟琛岀敓鎴愬畬鏁?1080p 鍩虹嚎 (鏈€澶?{max_workers} 涓繘绋?...")
        else:
            print(f"馃攧 宸叉帴鏀舵祦姘寸嚎鐢熸垚鐨?{len(baseline_results)}/{len(self.sections)} 涓?1080p 鍩虹嚎绔犺妭")

        tasks = []
        for section in self.sections:
            try:
                task_data = (section, self.__class__, self.get_serializable_state(), False)
                tasks.append(task_data)
            except Exception as e:
                print(f"鈿狅笍 涓?{section.id} 鍑嗗浠诲姟鏁版嵁鏃跺嚭閿? {str(e)}")
                continue

        if not tasks:
            print("No valid render tasks to execute")
            return {}

        results = dict(baseline_results or {})
        successful_count = len(results)
        failed_count = max(0, len(self.sections) - successful_count) if baseline_results is not None else 0

        if baseline_results is None:
            try:
                with ProcessPoolExecutor(max_workers=max_workers) as executor:
                    future_to_section = {}
                    for task in tasks:
                        try:
                            future = executor.submit(self.render_section_worker, task)
                            future_to_section[future] = task[0].id
                        except Exception as e:
                            section_id = task[0].id if task and len(task) > 0 else "unknown"
                            print(f"鈿狅笍 鎻愪氦 {section_id} 浠诲姟鏃跺嚭閿? {str(e)}")
                            failed_count += 1

                    for future in as_completed(future_to_section):
                        section_id = future_to_section[future]
                        try:
                            sid, success, video_path, quality = future.result()
                            self.visual_quality_results[sid] = quality
                            if quality.get("preview_render_seconds") is not None:
                                self.preview_render_seconds.append(float(quality["preview_render_seconds"]))

                            if success and video_path:
                                results[sid] = video_path
                                successful_count += 1
                                print(f"鉁?{sid} 瑙嗛娓叉煋鎴愬姛: {video_path}")
                            else:
                                failed_count += 1
                                print(f"鈿狅笍 {sid} 瑙嗛娓叉煋澶辫触")

                        except Exception as e:
                            failed_count += 1
                            print(f"鉂?{section_id} 瑙嗛娓叉煋杩囩▼閿欒: {str(e)}")

            except Exception as e:
                print(f"鉂?骞惰娓叉煋杩囩▼涓嚭鐜颁弗閲嶉敊璇? {str(e)}")
        if successful_count == len(self.sections) and self.use_feedback:
            if self.remaining_pipeline_seconds() > self.finalize_reserve_seconds:
                visual_workers = max(1, int(os.getenv("C2V_VISUAL_WORKERS", "2")))
                visual_tasks = [(section, self.__class__, self.get_serializable_state(), True) for section in self.sections]
                print(f"1080p baseline complete; starting hard-issue visual review with {visual_workers} workers")
                with ProcessPoolExecutor(max_workers=visual_workers) as executor:
                    futures = {
                        executor.submit(self.render_section_worker, task): task[0].id
                        for task in visual_tasks
                    }
                    for future in as_completed(futures):
                        sid, success, path, quality = future.result()
                        if success and path:
                            results[sid] = path
                            self.visual_quality_results[sid] = quality
                        else:
                            self._add_warning(
                                "visual_review_unavailable",
                                f"{sid} 瑙嗚澶嶆煡鏈畬鎴愶紝缁х画浣跨敤宸叉垚鍔熺殑 1080p 鍩虹嚎",
                                section_id=sid,
                            )
            else:
                self.deadline_action = "skip_visual_review_for_deadline"
                self._add_warning("visual_review_skipped", "鍓╀綑棰勭畻涓嶈冻锛岃烦杩囪瑙夊鏌ュ苟淇濈暀瀹屾暣鍩虹嚎")

        for section_id, quality in self.visual_quality_results.items():
            self.retry_summary.setdefault("sections", {})[section_id] = quality.get("retry_summary", {})
            if quality.get("section_fallback"):
                self.section_fallbacks[section_id] = quality["section_fallback"]
            for warning in quality.get("warnings", []):
                self._add_warning(
                    str(warning.get("code") or "section_warning"),
                    str(warning.get("message") or "section generation produced a non-blocking warning"),
                    **{key: value for key, value in warning.items() if key not in {"code", "message"}},
                )
            if quality.get("feedback_enabled") and not quality.get("passed"):
                self._add_warning(
                    "visual_quality_not_passed",
                    f"{section_id} 宸插畬鎴愭覆鏌擄紝浣嗕袱杞唴鏈畬鍏ㄩ€氳繃瑙嗚瀹℃煡",
                    section_id=section_id,
                )

        if failed_count > 0 or successful_count != len(self.sections):
            raise RuntimeError(f"{len(self.sections) - successful_count} 涓珷鑺傛覆鏌撳け璐ワ紱绂佹鍚堝苟缂虹珷鎴愮墖")

        preview_results = dict(results)
        self.actual_render_profile = self.preview_render_profile
        if self.render_profile.name != self.preview_render_profile.name:
            native_workers = max(1, int(os.getenv("C2V_NATIVE_RENDER_WORKERS", "1")))
            estimated_native_seconds = estimate_native_4k_seconds(self.preview_render_seconds, native_workers)
            remaining = self.remaining_pipeline_seconds()
            can_finish_native = estimated_native_seconds + self.finalize_reserve_seconds <= remaining
            print(
                f"Native {self.render_profile.name} estimate {estimated_native_seconds:.0f}s; "
                f"remaining budget {remaining:.0f}s with merge reserve {self.finalize_reserve_seconds}s"
            )
            if can_finish_native:
                native_results: Dict[str, str] = {}
                native_errors: Dict[str, str] = {}
                with ProcessPoolExecutor(max_workers=native_workers) as executor:
                    futures = {
                        executor.submit(self.render_native_section_worker, task): task[0].id
                        for task in tasks
                    }
                    for future in as_completed(futures):
                        sid, success, path, error = future.result()
                        if success and path:
                            native_results[sid] = path
                        else:
                            native_errors[sid] = error or "native render failed"
                if len(native_results) == len(self.sections):
                    results = native_results
                    self.actual_render_profile = self.render_profile
                else:
                    results = preview_results
                    self.deadline_action = "native_render_failed_use_1080p"
                    self._add_warning(
                        "render_profile_fallback",
                        f"Native {self.render_profile.name} did not produce a complete section set; returning complete {self.preview_render_profile.name}",
                        errors=native_errors,
                    )
            else:
                results = preview_results
                self.deadline_action = "skip_native_render_for_deadline"
                self._add_warning(
                    "render_profile_fallback",
                    f"Estimated native {self.render_profile.name} render cannot finish within remaining budget; returning complete {self.preview_render_profile.name}",
                    estimated_native_seconds=estimated_native_seconds,
                    remaining_seconds=remaining,
                )

        # Update final section video choices before merge.
        self.section_videos.update(results)

        total_sections = len(self.sections)
        print(f"\n馃搳 娓叉煋缁熻:")
        print(f"   鎬诲皬鑺傛暟: {total_sections}")
        print(f"   鎴愬姛鐜? {successful_count/total_sections*100:.1f}%" if total_sections > 0 else "   鎴愬姛鐜? 0%")

        pinned_cache_path = self.output_dir / "pinned_final_sections.json"
        try:
            pinned_sections = (
                json.loads(pinned_cache_path.read_text(encoding="utf-8"))
                if pinned_cache_path.exists()
                else {}
            )
        except Exception:
            pinned_sections = {}
        for section in self.sections:
            section_id = section.id
            quality = self.visual_quality_results.get(section_id) or {}
            if (
                not quality.get("passed")
                or section_id not in results
                or self.actual_render_profile.name != self.requested_render_profile.name
            ):
                continue
            video_path = Path(results[section_id]).resolve()
            try:
                stored_path = str(video_path.relative_to(self.output_dir.resolve()))
            except ValueError:
                stored_path = str(video_path)
            pinned_sections[section_id] = {
                "video_path": stored_path,
                "profile": self.actual_render_profile.name,
                "fingerprint": render_fingerprint(
                    (self.output_dir / f"{section_id}.py").read_text(encoding="utf-8"),
                    json.loads((self.output_dir / f"{section_id}_steps.json").read_text(encoding="utf-8")),
                    self.render_profile,
                ),
            }
        temporary_pin_path = pinned_cache_path.with_suffix(".json.tmp")
        temporary_pin_path.write_text(
            json.dumps(pinned_sections, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temporary_pin_path.replace(pinned_cache_path)

        if successful_count == 0:
            raise RuntimeError("all section renders failed")
        if failed_count > 0 or successful_count != total_sections:
            raise RuntimeError(f"{total_sections - successful_count} 涓珷鑺傛覆鏌撳け璐ワ紱绂佹鍚堝苟缂虹珷鎴愮墖")
        print("馃帀 鎵€鏈夊垎鑺傝棰戞覆鏌撴垚鍔燂紒")

        return results

    def merge_videos(self, output_filename: str = None) -> str:
        # Merge section videos in storyboard order and validate final media.
        if not self.section_videos:
            raise ValueError("娌℃湁鍙敤瑙嗛杩涜鍚堝苟")
        if self.duration is None:
            self._ensure_duration_resolved()

        if output_filename is None:
            safe_name = topic_to_safe_name(self.learning_topic)
            output_filename = f"{safe_name}.mp4"

        output_path = self.output_dir / output_filename

        print(f"馃敆 寮€濮嬪悎骞跺垎鑺傝棰?..")

        video_list_file = self.output_dir / "video_list.txt"
        ordered_ids = []
        if self.sections:
            ordered_ids = [s.id for s in self.sections]
        else:
            # 澶囬€夋柟妗堬細濡傛灉缂哄け sections 瀵硅薄锛屼娇鐢ㄨ嚜鐒舵帓搴?(Natural Sort)
            # 杩欓噷绠€鍗曞疄鐜颁竴涓?key function 澶勭悊 trailing numbers
            def natural_keys(text):
                return [int(c) if c.isdigit() else c for c in re.split(r'(\d+)', text)]
            ordered_ids = sorted(self.section_videos.keys(), key=natural_keys)
        
        target_ids = ordered_ids if ordered_ids else sorted(self.section_videos.keys())
        missing = [section_id for section_id in target_ids if section_id not in self.section_videos]
        if missing:
            raise ValueError(f"strict merge refused missing sections: {missing}")

        with open(video_list_file, "w", encoding="utf-8") as f:
            for section_id in target_ids:
                video_path = Path(self.section_videos[section_id]).resolve()
                section_media = validate_rendered_media(
                    video_path,
                    self.actual_render_profile,
                    require_audio=True,
                )
                if section_media["video_codec"] != "h264":
                    raise ValueError(f"{section_id} 瑙嗛缂栫爜涓嶆槸 H.264: {section_media['video_codec']}")
                escaped = str(video_path).replace("'", "'\\''")
                f.write(f"file '{escaped}'\n")

        ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
        last_error = None
        for attempt in range(1, self.max_attempts + 1):
            self.retry_summary["merge_attempts"] = attempt
            try:
                result = subprocess.run(
                    [ffmpeg_exe, "-y", "-f", "concat", "-safe", "0", "-i", str(video_list_file), "-c", "copy", str(output_path)],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                )
                if result.returncode != 0:
                    raise RuntimeError(result.stderr or "FFmpeg concat failed")
                media = validate_rendered_media(
                    output_path,
                    self.actual_render_profile,
                    require_audio=True,
                )
                if media["video_codec"] != "h264":
                    raise ValueError(f"鎴愮墖瑙嗛缂栫爜涓嶆槸 H.264: {media['video_codec']}")
                if media["pixel_format"] != "yuv420p":
                    raise ValueError(f"鎴愮墖鍍忕礌鏍煎紡涓嶆槸 yuv420p: {media['pixel_format']}")
                if media["audio_codec"] != "aac":
                    raise ValueError(f"鎴愮墖闊抽缂栫爜涓嶆槸 AAC: {media['audio_codec']}")
                self.media_metadata = media
                break
            except Exception as exc:
                last_error = str(exc)
                print(f"鈿狅笍 鍚堝苟鎴栧獟浣撻獙鏀剁 {attempt}/{self.max_attempts} 娆″け璐? {last_error}")
        else:
            raise RuntimeError(f"鍚堝苟鍜屽獟浣撻獙鏀跺湪 {self.max_attempts} 娆″皾璇曞悗浠嶅け璐? {last_error}")

        self.actual_duration_seconds = float(self.media_metadata["duration"])
        self.media_metadata["long_silences"] = None
        target_seconds = float(self.duration * 60)
        duration_range = (target_seconds * 0.85, target_seconds * 1.30)
        if not duration_range[0] <= self.actual_duration_seconds <= duration_range[1]:
            self._add_warning(
                "duration_target_missed",
                f"Final video duration {self.actual_duration_seconds:.2f}s is outside the target range, but the video is complete and playable.",
                actual_duration_seconds=self.actual_duration_seconds,
                accepted_duration_seconds=list(duration_range),
            )
        return str(output_path)

    def GENERATE_VIDEO(self) -> str:
        # Generate complete video with visual feedback optimization.
        try:
            self.generate_outline()
            self.generate_storyboard()
            self.inject_overview_section()
            self.inject_cover_section()
            self.generate_and_render_sections()
            final_video = self.merge_videos()
            if final_video:
                print(f"馃帀 瑙嗛鐢熸垚鎴愬姛: {final_video}")
                return final_video
            else:
                print(f"鉂?{self.learning_topic} 澶辫触")
                return None
        except Exception as e:
            print(f"鉂?瑙嗛鐢熸垚澶辫触: {e}")
            return None


def process_single_problem(idx: int, problem: Dict[str, str], folder_path: Path, cfg: RunConfig):
    # Process one programming problem in CLI batch mode.
    desc = problem["problem_description"]
    code = problem.get("solution_code", "")
    label = desc[:50] if len(desc) > 50 else desc
    
    print(f"\n馃殌 姝ｅ湪澶勭悊棰樼洰 [{idx}]: {label}")
    start_time = time.time()

    agent = TeachingVideoAgent(
        idx=idx,
        folder=folder_path,
        cfg=cfg,
        problem_description=desc,
        solution_code=code,
    )
    video_path = agent.GENERATE_VIDEO()

    duration_minutes = (time.time() - start_time) / 60
    total_tokens = agent.token_usage["total_tokens"]

    print(f"鉁?棰樼洰 [{idx}] 澶勭悊瀹屾垚銆傝€楁椂: {duration_minutes:.2f} 鍒嗛挓, Token 浣跨敤: {total_tokens}")
    return label, video_path, duration_minutes, total_tokens


def process_batch(batch_data, cfg: RunConfig):
    # Process a batch of problems serially within the batch.
    batch_idx, problem_batch, folder_path = batch_data
    results = []
    print(f"Batch {batch_idx + 1} starts with {len(problem_batch)} problems")

    for local_idx, (idx, problem) in enumerate(problem_batch):
        try:
            if local_idx > 0:
                delay = random.uniform(3, 6)
                print(f"鈴?绗?{batch_idx + 1} 鎵规绛夊緟 {delay:.1f} 绉?..")
                time.sleep(delay)
            results.append(process_single_problem(idx, problem, folder_path, cfg))
        except Exception as e:
            label = problem.get("problem_description", "unknown")[:50]
            print(f"鉂?绗?{batch_idx + 1} 鎵规澶勭悊 {label} 澶辫触: {e}")
            results.append((label, None, 0, 0))
    return batch_idx, results


def run_Code2Video(
    problems: List[Dict[str, str]], folder_path: Path, parallel=True, batch_size=3, max_workers=8, cfg: RunConfig = RunConfig()
):
    # Batch-process programming problems and generate videos.
    all_results = []

    if parallel:
        batches = []
        for i in range(0, len(problems), batch_size):
            batch = [(i + j, p) for j, p in enumerate(problems[i : i + batch_size])]
            batches.append((i // batch_size, batch, folder_path))

        print(f"Parallel batch mode: {len(batches)} batches, batch_size={batch_size}, max_workers={max_workers}")
        with ProcessPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(process_batch, batch, cfg): batch for batch in batches}
            for future in as_completed(futures):
                try:
                    batch_idx, batch_results = future.result()
                    all_results.extend(batch_results)
                    print(f"鉁?绗?{batch_idx + 1} 鎵规瀹屾垚")
                except Exception as e:
                    print(f"鉂?鎵规澶勭悊澶辫触: {e}")
    else:
        print("馃攧 涓茶澶勭悊妯″紡")
        for idx, problem in enumerate(problems):
            try:
                all_results.append(process_single_problem(idx, problem, folder_path, cfg))
            except Exception as e:
                label = problem.get("problem_description", "unknown")[:50]
                print(f"鉂?涓茶澶勭悊 {label} 澶辫触: {e}")
                all_results.append((label, None, 0, 0))

    successful_runs = [r for r in all_results if r[1] is not None]
    total_runs = len(all_results)
    if not successful_runs:
        print("\nAll problems failed; cannot compute averages.")
        return

    total_duration = sum(r[2] for r in successful_runs)
    total_tokens_consumed = sum(r[3] for r in successful_runs)
    num_successful = len(successful_runs)

    print("\n" + "=" * 50)
    print(f"   鎬婚鐩暟: {total_runs}")
    print(f"   鎴愬姛澶勭悊: {num_successful} ({num_successful/total_runs*100:.1f}%)")
    print(f"   骞冲潎鑰楁椂 [鍒哴: {total_duration/num_successful:.2f} 鍒嗛挓/棰樼洰")
    print(f"   骞冲潎 Token 娑堣€? {total_tokens_consumed/num_successful:,.0f} tokens/棰樼洰")
    print("=" * 50)


def get_api_and_output(API_name):
    mapping = {
        "gpt-41": (request_gpt41_token, "Chatgpt41"),
        "gpt-5": (request_gpt5_token, "Chatgpt5"),
        "gpt-4o": (request_gpt4o_token, "Chatgpt4o"),
        "gpt-o4mini": (request_o4mini_token, "Chatgpto4mini"),
    }
    try:
        return mapping[API_name]
    except KeyError:
        raise ValueError("鏃犳晥鐨?API 妯″瀷鍚嶇О")


def build_and_parse_args():
    parser = argparse.ArgumentParser()
    # TODO: Core hyperparameters
    parser.add_argument(
        "--API",
        type=str,
        choices=["gpt-41", "gpt-5", "gpt-4o", "gpt-o4mini"],
        default="gpt-4o",
    )
    parser.add_argument(
        "--folder_prefix",
        type=str,
        default="TEST",
    )
    parser.add_argument("--problems_file", type=str, help="Batch problem JSON file path relative to json_files", default=None)
    parser.add_argument("--iconfinder_api_key", type=str, default="")

    # Basically invariant parameters
    parser.add_argument("--use_feedback", action="store_true", default=False)
    parser.add_argument("--no_feedback", action="store_false", dest="use_feedback")
    parser.add_argument("--use_assets", action="store_true", default=False)
    parser.add_argument("--no_assets", action="store_false", dest="use_assets")

    parser.add_argument("--max_code_token_length", type=int, help="max # token for generating code", default=10000)
    parser.add_argument("--max_fix_bug_tries", type=int, help="宸插純鐢紱鎬诲皾璇曟暟鏈€澶氫负 3", default=3)
    parser.add_argument("--max_regenerate_tries", type=int, help="宸插純鐢紱鎬诲皾璇曟暟鏈€澶氫负 3", default=3)
    parser.add_argument("--max_feedback_gen_code_tries", type=int, help="Deprecated; one code rewrite per visual feedback round", default=1)
    parser.add_argument("--max_mllm_fix_bugs_tries", type=int, help="Deprecated; one render per visual feedback round", default=1)
    parser.add_argument("--feedback_rounds", type=int, default=2)
    parser.add_argument("--duration", type=int, default=None, help="鐩爣鏃堕暱锛堝垎閽燂級锛涗笉浼犳椂鐢?AI 鍦?5-15 鍒嗛挓鍐呴€夋嫨")
    parser.add_argument(
        "--render_profile",
        choices=["1080p30", "4k30", "4k60"],
        default="4k30",
        help="鍘熺敓娓叉煋瑙勬牸",
    )

    parser.add_argument("--parallel", action="store_true", default=False)
    parser.add_argument("--no_parallel", action="store_false", dest="parallel")
    parser.add_argument("--parallel_group_num", type=int, default=3)
    parser.add_argument("--max_concepts", type=int, help="Limit # concepts for a quick run, -1 for all", default=-1)
    parser.add_argument("--problem_description", type=str, help="缂栫▼棰樼洰鎻忚堪锛堝崟棰樻ā寮忥級", default=None)
    parser.add_argument("--solution_code", type=str, help="鏍囧噯绛旀浠ｇ爜锛堝崟棰樻ā寮忥級", default=None)
    
    # 鏂板鍙傛暟锛氭渶澶у苟琛屽伐浣滆繘绋嬫暟
    parser.add_argument("--max_workers", type=int, default=None, help="Force specific number of workers, overriding auto-detection")

    # 鐢ㄦ埛涓€у寲閰嶇疆鍙傛暟 - 鏂扮殑鑷劧璇█鎻忚堪鏂瑰紡
    parser.add_argument(
        "--user_profile",
        type=str,
        default="",
        help="鐢ㄦ埛鐢诲儚鐨勮嚜鐒惰瑷€鎻忚堪锛屼緥濡傦細'鎴戞槸17宀佺殑楂樹腑鐢燂紝鎯宠鐨勫涔犻毦搴︽槸鍏ラ棬绾э紝閫夋嫨鐨勭紪绋嬭瑷€鏄疨ython锛岀洰鏍囨槸鍒╃敤鏆戝亣鎴愬姛鍏ラ棬Python'"
    )
    parser.add_argument(
        "--difficulty",
        type=str,
        choices=["simple", "medium", "hard"],
        default="medium",
        help="鍐呭闅惧害绛夌骇锛坰imple/medium/hard锛夛紝榛樿 medium"
    )

    return parser.parse_args()


if __name__ == "__main__":
    args = build_and_parse_args()

    api, folder_name = get_api_and_output(args.API)
    api = partial(api, max_retries=1)
    folder = Path(__file__).resolve().parent / "CASES" / f"{args.folder_prefix}_{folder_name}"

    _CFG_PATH = pathlib.Path(__file__).with_name("api_config.json")
    with _CFG_PATH.open("r", encoding="utf-8") as _f:
        _CFG = json.load(_f)
    iconfinder_cfg = _CFG.get("iconfinder", {})
    args.iconfinder_api_key = iconfinder_cfg.get("api_key")
    if args.iconfinder_api_key:
        print(f"Iconfinder API 瀵嗛挜: {args.iconfinder_api_key}")
    else:
        print("Warning: Iconfinder API key not found; using default None.")

    # 鍒ゆ柇杩愯妯″紡
    single_mode = bool(args.problem_description)

    if not single_mode and not args.problems_file:
        raise ValueError("蹇呴』鎻愪緵 --problem_description锛堝崟棰樻ā寮忥級鎴?--problems_file锛堟壒閲忔ā寮忥級")

    # 鍒涘缓鐢ㄦ埛涓€у寲閰嶇疆
    # 闅惧害鏄犲皠涓鸿嚜鐒惰瑷€鎻忚堪
    difficulty_desc_map = {
        "simple": "内容难度偏简单入门",
        "medium": "内容难度为中等",
        "hard": "内容难度偏高级进阶",
    }
    difficulty_desc = difficulty_desc_map.get(args.difficulty, "内容难度为中等")

    if args.user_profile:
        profile_text = f"{args.user_profile}，{difficulty_desc}"
        print(f"馃 姝ｅ湪浣跨敤 AI 瑙ｆ瀽鐢ㄦ埛鐢诲儚...")
        print(f"馃摑 鐢ㄦ埛杈撳叆: {profile_text}")
        
        user_profile = create_profile_from_text(profile_text)
        parsed_profile = parse_profile_with_ai_sync(profile_text, api, max_retries=3)
        
        if parsed_profile:
            user_profile.update_with_parsed_profile(parsed_profile)
            print("AI profile parsing succeeded")
            
            summary = parsed_profile.get("user_summary", {})
            print(f"馃搵 瑙ｆ瀽缁撴灉:")
            print(f"   - 骞撮緞娈? {summary.get('age_group', '鏈煡')}")
            print(f"   - 鐭ヨ瘑鑳屾櫙: {summary.get('background', '鏈煡')}")
            print(f"   - 瀛︿範鐩爣: {summary.get('learning_goal', '鏈煡')}")
            print(f"   - 缂栫▼璇█: {summary.get('target_language', 'Python')}")
            print(f"   - 闅惧害鍋忓ソ: {summary.get('difficulty_preference', '涓瓑')}")
        else:
            print("AI profile parsing failed; using default parsed profile")
    else:
        # 鍗充娇娌℃湁鐢ㄦ埛鐢诲儚鏂囨湰锛屼篃灏?difficulty 浼犲叆
        profile_text = difficulty_desc
        print(f"馃搵 鏈彁渚涚敤鎴风敾鍍忥紝浣跨敤闅惧害閰嶇疆: {difficulty_desc}")
        user_profile = create_profile_from_text(profile_text)
        parsed_profile = parse_profile_with_ai_sync(profile_text, api, max_retries=3)
        if parsed_profile:
            user_profile.update_with_parsed_profile(parsed_profile)

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
        preview_render_profile="1080p30",
        user_profile=user_profile,
    )

    if single_mode:
        # ===== 鍗曢妯″紡 =====
        print("Single-problem mode: generating one programming explanation video")
        start_time = time.time()

        agent = TeachingVideoAgent(
            idx=0,
            folder=folder,
            cfg=cfg,
            problem_description=args.problem_description,
            solution_code=args.solution_code or "",
        )
        video_path = agent.GENERATE_VIDEO()

        duration_minutes = (time.time() - start_time) / 60
        total_tokens = agent.token_usage["total_tokens"]

        if video_path:
            print(f"\n馃帀 瑙嗛鐢熸垚鎴愬姛: {video_path}")
        else:
            print(f"\n鉂?瑙嗛鐢熸垚澶辫触")
        print(f"   鑰楁椂: {duration_minutes:.2f} 鍒嗛挓, Token 浣跨敤: {total_tokens}")
    else:
        # ===== 鎵归噺妯″紡锛堜粠 JSON 鏂囦欢璇诲彇棰樼洰鍒楄〃锛?=====
        # JSON 鏂囦欢鏍煎紡: [{"problem_description": "...", "solution_code": "..."}, ...]
        problems_path = Path(__file__).resolve().parent / "json_files" / args.problems_file
        with open(problems_path, "r", encoding="utf-8") as f:
            problems = json.load(f)
            if args.max_concepts is not None and args.max_concepts > 0:
                problems = problems[: args.max_concepts]

        # 楠岃瘉鏍煎紡
        for i, p in enumerate(problems):
            if not isinstance(p, dict) or "problem_description" not in p:
                raise ValueError(
                    f"Problem [{i}] has invalid format; each item must include problem_description."
                    f"\nExpected: {{\"problem_description\": \"...\", \"solution_code\": \"...\"}}"
                )

        print(f"Loaded {len(problems)} problems")

        real_workers = args.max_workers if args.max_workers is not None else get_optimal_workers()

        run_Code2Video(
            problems,
            folder,
            parallel=args.parallel,
            batch_size=max(1, int(len(problems) / args.parallel_group_num)),
            max_workers=real_workers,
            cfg=cfg,
        )

