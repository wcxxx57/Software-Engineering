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
    normalize_storyboard_payload,
    wrap_storyboard_lecture_lines,
)
from src.cover_scene import generate_cover_manim_code
from src.rendering import (
    get_render_kill_grace_seconds,
    get_render_profile,
    get_render_timeout_seconds,
    render_fingerprint,
    run_process_with_tree_timeout,
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
    find_scene_class_name,
    generate_fallback_scene_code,
    normalize_known_scene_tokens,
    remaining_pipeline_seconds,
)

AUTO_DURATION_MINUTES = (5, 8)
AUTO_DURATION_FALLBACK_MINUTES = 7


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
    # 兼容旧调用方保留下面四个字段；所有实际尝试都会被统一预算限制。
    max_fix_bug_tries: int = 3
    max_regenerate_tries: int = 3
    max_feedback_gen_code_tries: int = 1
    max_mllm_fix_bugs_tries: int = 1
    max_repair_attempts: int = 2
    duration: Optional[int] = None
    render_profile: str = "1080p30"
    preview_render_profile: str = "1080p30"
    pipeline_budget_seconds: int = 2400
    finalize_reserve_seconds: int = 240
    pipeline_started_at: Optional[float] = None
    # 用户个性化配置
    user_profile: Optional[UserProfile] = None
    # 强制大纲难度（入门/中等/进阶），若为空则由画像推断
    forced_difficulty_level: Optional[str] = None
    # 编程题目相关
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
        """1. Global parameter"""
        # 编程题目相关：优先使用直接传入的参数，其次使用 cfg 中的配置
        self.problem_description = problem_description or (cfg.problem_description if cfg else "")
        self.solution_code = solution_code or (cfg.solution_code if cfg else "")
        
        # learning_topic 用于目录命名和日志，从题目描述中提取简短标题
        if self.problem_description:
            first_line = self.problem_description.split('\n')[0].strip()
            first_sentence = re.split(r"[。；;\n]|示例\d+[:：]|限制[:：]", first_line, maxsplit=1)[0].strip()
            main_title = re.split(r"[:：]", first_sentence, maxsplit=1)[0].strip()
            self.learning_topic = main_title[:50] if len(main_title) > 50 else main_title
        else:
            self.learning_topic = "未命名题目"
        self.idx = idx
        self.cfg = cfg or RunConfig()
        self.folder = folder  # 修复：保存 folder 路径，供 get_serializable_state 使用

        if not self.cfg.api:
            raise ValueError(f"❌ 错误: TeachingVideoAgent 初始化失败。必须在 RunConfig 中提供有效的 'api' 回调函数。")

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
        
        # 用户个性化配置
        self.user_profile = cfg.user_profile or get_default_profile()

        """2. Path for output"""
        self.output_dir = get_output_dir(idx=idx, knowledge_point=self.learning_topic, base_dir=folder)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        static_root = Path(__file__).resolve().parent
        self.assets_dir = static_root / "assets" / "icon"
        self.assets_dir.mkdir(exist_ok=True)

        """3. ScopeRefine & Anchor Visual"""
        self.scope_refine_fixer = ScopeRefineFixer(self.API, self.max_code_token_length)
        self.extractor = GridPositionExtractor()

        """4. External Database"""
        knowledge_ref_mapping_path = static_root / "json_files" / "long_video_ref_mapping.json"
        with open(knowledge_ref_mapping_path) as f:
            self.KNOWLEDGE2PATH = json.load(f)
        self.knowledge_ref_img_folder = static_root / "assets" / "reference"
        self.GRID_IMG_PATH = self.knowledge_ref_img_folder / "GRID.png"

        """5. Data structure"""
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

        """6. For Efficiency"""
        self.token_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

        legacy_limits = {
            "max_fix_bug_tries": cfg.max_fix_bug_tries,
            "max_regenerate_tries": cfg.max_regenerate_tries,
            "max_feedback_gen_code_tries": cfg.max_feedback_gen_code_tries,
            "max_mllm_fix_bugs_tries": cfg.max_mllm_fix_bugs_tries,
        }
        if any(int(value) > self.max_attempts for value in legacy_limits.values()):
            print("⚠️ 旧重试参数已弃用；当前统一为首次尝试 + 最多 2 次修复")

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
        )
        code_path = self.output_dir / f"{section.id}.py"
        code_path.write_text(code, encoding="utf-8")
        self.section_codes[section.id] = code
        self.section_fallbacks[section.id] = {"reason": reason, "template": "code_progress"}
        self._add_warning(
            "section_template_fallback",
            f"{section.id} 三个代码版本均不可用，已采用稳定保底模板",
            section_id=section.id,
            reason=reason,
        )

    def _request_api_and_track_tokens(self, prompt, max_tokens=10000):
        """packages API requests and automatically accumulates token usage"""
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
            minimum=AUTO_DURATION_MINUTES[0],
            maximum=AUTO_DURATION_MINUTES[1],
            fallback=AUTO_DURATION_FALLBACK_MINUTES,
        )
        print(f"⏱️ 视频目标时长：{self.duration} 分钟（{self.duration_source}）")

    def _validate_outline_payload(self, payload):
        return validate_outline(
            payload,
            target_minutes=self.duration,
            evidence_types={"题目条件", "标准答案代码", "算法定义", "不变量", "执行追踪", "复杂度推导", "边界案例"},
        )

    def _validate_storyboard_payload(self, payload):
        payload = normalize_storyboard_payload(payload, solution_code=self.solution_code)
        return validate_storyboard(
            payload,
            outline_sections=self.outline.sections,
            target_minutes=self.duration,
            max_new_terms=max_new_terms_from_profile(self.user_profile),
            solution_code=self.solution_code,
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
                problem_description=self.problem_description,
                solution_code=self.solution_code,
                duration=self.duration, 
                reference_image_path=refer_img_path,
                user_profile=self.user_profile,
                forced_difficulty_level=self.forced_difficulty_level,
            )

            print(f"📝 正在生成大纲...")

            for attempt in range(1, self.max_regenerate_tries + 1):
                self.retry_summary["outline_attempts"] = attempt
                api_func = self._request_api_and_track_tokens if refer_img_path else self._request_api_and_track_tokens
                validation_note = ""
                if attempt > 1 and 'outline_errors' in locals() and outline_errors:
                    validation_note = "\n\n上一次输出未通过校验，请逐项修正：\n- " + "\n- ".join(outline_errors)
                response = api_func(prompt1 + validation_note, max_tokens=self.max_code_token_length)
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
                    cached_storyboard = wrap_storyboard_lecture_lines(json.load(f))
                cached_storyboard, cache_errors = self._validate_storyboard_payload(cached_storyboard)
                if cache_errors:
                    print("♻️ 分镜缓存已过期：" + "; ".join(cache_errors))
                    continue
                if cache_file == storyboard_file and self.use_assets:
                    cached_storyboard = wrap_storyboard_lecture_lines(
                        self._enhance_storyboard_with_assets(cached_storyboard)
                    )
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
                solution_code=self.solution_code,
                reference_image_path=refer_img_path,
                user_profile=self.user_profile
            )

            for attempt in range(1, self.max_regenerate_tries + 1):
                self.retry_summary["storyboard_attempts"] = attempt
                api_func = self._request_api_and_track_tokens
                validation_note = ""
                if attempt > 1 and 'storyboard_errors' in locals() and storyboard_errors:
                    validation_note = "\n\n上一次输出未通过校验，请逐项修正：\n- " + "\n- ".join(storyboard_errors)
                response = api_func(prompt2 + validation_note, max_tokens=self.max_code_token_length)
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
                    candidate = wrap_storyboard_lecture_lines(json.loads(json_str))
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
                        self.enhanced_storyboard = wrap_storyboard_lecture_lines(
                            self._enhance_storyboard_with_assets(storyboard_data)
                        )
                    else:
                        self.enhanced_storyboard = storyboard_data
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

        normalized_path = enhanced_storyboard_file if self.use_assets else storyboard_file
        with open(normalized_path, "w", encoding="utf-8") as f:
            json.dump(self.enhanced_storyboard, f, ensure_ascii=False, indent=2)

        print(f"== 分镜处理完成，共生成 {len(self.sections)} 个小节")
        return self.sections

    def _enhance_storyboard_with_assets(self, storyboard_data: dict) -> dict:
        """Enhance storyboard: smart analysis and download assets"""
        print("🤖 正在增强分镜：智能分析并下载素材...")

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
            print("✅ 分镜已增强素材")
            return enhanced_storyboard

        except Exception as e:
            print(f"⚠️ 素材下载失败，使用原始分镜: {e}")
            return storyboard_data

    def inject_cover_section(self) -> None:
        """
        在 sections 列表最前面注入一个「封面」section。

        封面展示题目短名（大标题）+ 解题主题（副标题），并播放介绍旁白。
        使用确定性模板生成 Manim 代码，保证稳定性。
        """
        if not self.outline:
            print("⚠️ 大纲尚未生成，跳过封面注入")
            return

        if any(section.id == "section_cover" for section in self.sections):
            print("🎬 封面 section 已存在，跳过注入")
            return

        intro_text = f"本视频将带你讲解：{self.outline.topic}"

        cover_section = Section(
            id="section_cover",
            title=self.outline.topic,
            lecture_lines=[intro_text],
            animations=["Gradient background", "Create decoration lines", "FadeIn title", "FadeIn subtitle", "Play intro audio"],
            estimated_duration=10,
        )

        self.sections.insert(0, cover_section)
        print(f"🎬 已注入封面 section（题目：{self.outline.topic}）")

    def _generate_cover_code(self, section: Section) -> str:
        """为封面 section 使用确定性模板生成 Manim 代码。"""
        section_steps = self.prepare_section_steps(section)

        code = generate_cover_manim_code(
            topic=self.outline.topic,
            short_title=self.learning_topic,
            section_steps=section_steps,
        )

        code = replace_base_class(code, base_class)

        code_file = self.output_dir / f"{section.id}.py"
        with open(code_file, "w", encoding="utf-8") as f:
            f.write(code)

        self.section_codes[section.id] = code
        print(f"🎬 封面 section 代码已生成（模板化，含 TTS 旁白）")
        return code

    def inject_overview_section(self) -> None:
        """
        在 sections 列表最前面注入一个「解题导览」概述 section。

        该方法使用 AI 合并精简 section titles，然后生成 lecture_lines。
        概述 section 后续会正常走 TTS 管线和模板化代码生成（跳过 LLM Stage 3）。
        """
        if not self.outline or not self.sections:
            print("⚠️ 大纲或分节尚未生成，跳过概述注入")
            return

        if any(section.id == "section_overview" for section in self.sections):
            print("📋 概述 section 已存在，跳过注入")
            return

        section_titles = [
            s.title for s in self.sections
            if s.id not in ("section_overview", "section_cover")
        ]

        print("🤖 正在使用 AI 合并精简章节标题...")
        merged_titles = _merge_section_titles_with_ai(
            section_titles=section_titles,
            topic=self.outline.topic,
            api_func=self._request_api_and_track_tokens,
        )
        print(f"📋 合并后共 {len(merged_titles)} 条概要: {merged_titles}")

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
        print(f"📋 已注入概述 section（{len(overview_lines)} 条讲解行）")

    def _generate_overview_code(self, section: Section) -> str:
        """为概述 section 使用确定性模板生成 Manim 代码（跳过 LLM）。"""
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

            match = _re.match(r"^第[一二三四五六七八九十\d]+部分，(.+)$", line)
            if match:
                merged_titles.append(match.group(1).strip())
                continue

            cleaned = _re.sub(r"^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]\s*", "", line)
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
            print(f"📂 发现 {section.id} 的现有代码，正在读取...")
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
            print(f"♻️ {section.id} 代码与当前旁白步骤不一致，只重生成该节代码")

        if not feedback_improvements:
            if section.id == "section_cover":
                return self._generate_cover_code(section)
            if section.id == "section_overview":
                return self._generate_overview_code(section)

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
            versions_used = self._section_versions_used(section.id)
            if versions_used >= self.max_attempts:
                raise RuntimeError(f"{section.id} 已用完三个代码版本，不能继续视觉改写")
            try:
                modifier = GridCodeModifier(current_code)
                modified_code = modifier.parse_feedback_and_modify(feedback_improvements)
                modified_code = fix_png_path(modified_code, self.assets_dir)
                if modified_code.strip() == current_code.strip():
                    raise ValueError("结构化修改器未产生可验证的局部代码变化")
                modified_code, _ = normalize_known_scene_tokens(modified_code)
                find_scene_class_name(modified_code)
                with open(code_file, "w", encoding="utf-8") as f:
                    f.write(modified_code)

                self.section_codes[section.id] = modified_code
                self._set_section_versions_used(section.id, versions_used + 1)
                return modified_code
            except Exception as e:
                raise ValueError(f"视觉局部补丁不可应用，保留原章节: {e}") from e

        else:
            section_steps = self.prepare_section_steps(section)
            code_gen_prompt = get_prompt3_code(
                regenerate_note=regenerate_note, 
                section=section, 
                section_steps=section_steps,
                base_class=base_class,
                user_profile=self.user_profile,
                estimated_duration=section.estimated_duration,  # 传递预计时长
                solution_code=self.solution_code  # 传递标准答案代码
            )

        response = self._request_api_and_track_tokens(code_gen_prompt, max_tokens=self.max_code_token_length)
        if response is None:
            print(f"❌ 通过 API 生成 {section.id} 代码失败。")
            if not feedback_improvements and attempt < self.max_regenerate_tries:
                return self.generate_section_code(
                    section=section,
                    attempt=attempt + 1,
                    error_message="代码生成 API 未返回内容",
                )
            raise RuntimeError(f"{section.id} 代码生成 API 未返回内容")

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
            print(f"🧩 {section.id} 本地补全固定设计令牌: {', '.join(token_fixes)}")

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
                    print(f"♻️ {section.id} 仅修复缺失或损坏的旁白音频，保留其余音频缓存")
                self.section_steps[section.id] = section_steps
                return section_steps
            print(f"♻️ {section.id} 语义组或旁白预算已变化，只重建当前章节")

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
        """按 AI 已选总时长分配章节旁白预算，并以落盘 WAV 的物理时长调整。"""
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
            print(
                f"🎙️ 第 {round_index + 1}/{max_rounds} 轮旁白物理时长 {measured_total:.2f}s；"
                f"AI 目标 {target_final_seconds:.2f}s"
            )
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
            f"旁白经过 {max_rounds} 次尝试后为 {self.actual_narration_seconds:.2f}s，"
            f"仍偏离目标 {acceptable_range[0]:.2f}-{acceptable_range[1]:.2f}s；继续生成完整视频"
        )
        print(f"⚠️ {message}")
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
        """Render one section while sharing the section's three-version budget."""
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
                    print(f"✅ {section_id} 命中内容指纹缓存: {profile.name}/{fingerprint}")
                    return True, None
                except Exception as exc:
                    print(f"♻️ {section_id} 指纹缓存无效，将重新渲染: {exc}")

            try:
                if not preferred_scene:
                    raise ValueError(last_error or "没有找到可执行的具体 Scene")
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
                timeout_seconds = get_render_timeout_seconds(profile)
                kill_grace_seconds = get_render_kill_grace_seconds()
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
                    f"🔧 {self.learning_topic} 渲染 {section_id} [{profile.name}] "
                    f"({fix_attempt + 1}/{max_fix_attempts}, {fingerprint})"
                )
                result = run_process_with_tree_timeout(
                    cmd,
                    cwd=self.output_dir,
                    timeout_seconds=timeout_seconds,
                    kill_grace_seconds=kill_grace_seconds,
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
            except subprocess.TimeoutExpired as exc:
                timeout_output = (exc.stderr or exc.output or "").strip()
                last_error = (
                    f"Manim {profile.name} section render timed out after "
                    f"{timeout_seconds}s; renderer process tree was terminated"
                )
                if timeout_output:
                    last_error += f"\n{timeout_output[-4000:]}"
            except Exception as exc:
                last_error = str(exc)

            print(f"❌ {section_id} {profile.name} 渲染失败: {last_error}")
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
                last_error = f"修复代码预检失败: {exc}"
                break
            if fixed_code.strip() == self.section_codes[section_id].strip():
                last_error = "修复未产生代码变化"
                break
            self.section_codes[section_id] = fixed_code
            code_path.write_text(fixed_code, encoding="utf-8")
            versions_used += 1
            self._set_section_versions_used(section_id, versions_used)
            force_render = True

        return False, last_error

    def get_mllm_feedback(self, section: Section, video_path: str, round_number: int = 1) -> VideoFeedback:
        print(f"🤖 {self.learning_topic} 使用 MLLM 分析视频 ({round_number}/{self.feedback_rounds}): {section.id}")

        current_code = self.section_codes[section.id]
        positions = self.extractor.extract_grid_positions(current_code)
        position_table = self.extractor.generate_position_table(positions)
        if section.id in {"section_cover", "section_overview"}:
            analysis_prompt = f"""
你是严格的视频布局质检员。当前片段是封面或全屏导览，不使用普通左文右图模板。
逐秒检查全部联系表，只把真实可见问题判为问题：文字或图形遮挡、元素被裁切、低对比度、
字符乱码、页面切换后的旧元素残留、后续页面元素提前出现、当前页面元素延迟消失、
完整页面在整句旁白期间缓慢淡入或淡出，以及逐句旁白字幕或横跨底部的字幕框。
片段标题：{section.title}
画面文字：{'；'.join(section.lecture_lines)}
只输出合法 JSON：{{"layout":{{"has_issues":false,"improvements":[]}}}}
若确有问题，improvements 最多三项，每项包含 problem、solution、timestamp、line_number、object_affected。
"""
        else:
            analysis_prompt = get_prompt4_layout_feedback(section=section, position_table=position_table)
        analysis_prompt += """

交付前只检查会破坏可用性的硬问题，不评价美观度、教学深度或可选润色。
如能用固定网格定位调用修复，请在 improvement 中额外返回 line_number 和 new_code；
new_code 必须是该行完整的 self.place_at_grid(...) 或 self.place_in_area(...) 调用。
"""
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
                good_enough_reason="交付前仅检查重叠、裁切、残留、乱码、缺失和音画不完整等硬问题。",
                evaluation_scores={"hard_visual_integrity": 20.0 if not has_layout_issues else 0.0},
            )
            self.video_feedbacks[f"{section.id}_round{round_number}"] = feedback
            return feedback

        except Exception as e:
            print(f"❌ {self.learning_topic} MLLM 分析失败: {str(e)}")
            return VideoFeedback(
                section_id=section.id,
                video_path=video_path,
                has_issues=True,
                suggested_improvements=[],
                raw_response=f"Error: {str(e)}",
            )

    def optimize_with_feedback(self, section: Section, feedback: VideoFeedback) -> bool:
        """事务式应用反馈；代码一旦变化，就使用新指纹强制重新渲染。"""
        if not feedback.has_issues or not feedback.suggested_improvements:
            print(f"✅ {self.learning_topic} {section.id} 无需优化")
            return True

        original_code_content = self.section_codes[section.id]
        original_video_path = self.section_videos.get(section.id)
        code_path = self.output_dir / f"{section.id}.py"

        print(f"🎯 {self.learning_topic} 根据本轮视觉反馈修订 {section.id}")
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
                print(f"⚠️ {section.id} 视觉修订破坏标准答案展示，立即回滚: {snippets_error}")
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
                print(f"⚠️ {section.id} 视觉修订破坏旁白时间轴，立即回滚: {timeline_error}")
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
                print(f"✨ {self.learning_topic} {section.id} 新代码已按新指纹重新渲染")
                return True
            raise RuntimeError("视觉修订后的代码未能成功渲染")
        except Exception as exc:
            print(f"⚠️ {self.learning_topic} {section.id} 本轮视觉优化失败，回滚: {exc}")
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
                        print(f"✅ {section.id} 内容指纹与显式验收记录一致，复用源码")
                        return section.id, None
            self.generate_section_code(section, attempt=1)
            return section.id, None
        except Exception as exc:
            try:
                self._install_fallback_code(section, f"代码生成三次仍失败: {exc}")
                return section.id, None
            except Exception as fallback_error:
                return section.id, fallback_error

    def generate_codes(self) -> Dict[str, str]:
        if not self.sections:
            raise ValueError(f"{self.learning_topic} 请先生成教学小节")
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
                    print(f"❌ {self.learning_topic} {section_id} 代码生成失败: {err}")
                    section = next(item for item in self.sections if item.id == section_id)
                    try:
                        self._install_fallback_code(section, str(err))
                        print(f"🛟 {section_id} 已在代码生成阶段切换稳定保底模板")
                    except Exception as fallback_exc:
                        failures.append((section_id, f"{err}; fallback={fallback_exc}"))

        missing = [section.id for section in self.sections if section.id not in self.section_codes]
        if failures or missing:
            raise RuntimeError(f"分节代码生成不完整: failures={failures}, missing={missing}")

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
                            raise ValueError("显式验收记录与当前代码、音频或渲染规格不一致")
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
                        print(f"✅ {section_id} 复用显式验收的最终章节缓存")
                        return True
                except Exception as exc:
                    print(f"♻️ {section_id} 显式最终缓存无效，将正常渲染: {exc}")

            success, last_error = self.debug_and_fix_code(
                section_id,
                max_fix_attempts=self.max_attempts,
                render_profile=self.preview_render_profile,
            )
            if not success:
                print(f"⚠️ {self.learning_topic} {section_id} 三个代码版本均不可用，切换稳定保底模板")
                self._install_fallback_code(section, last_error or "预览渲染失败")
                success, last_error = self.debug_and_fix_code(
                    section_id,
                    max_fix_attempts=1,
                    render_profile=self.preview_render_profile,
                    force_render=True,
                    allow_code_repair=False,
                )
                if not success:
                    print(f"❌ {self.learning_topic} {section_id} 保底模板仍无法渲染: {last_error}")
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
                        print(f"⚠️ {section_id} 视觉评价不可用；保留已完成章节，稍后仍可继续优化")
                        review_completed = False
                        break
                    if not feedback.has_issues and feedback.is_good_enough:
                        passed_visual_qa = True
                        review_completed = True
                        break
                    if not feedback.suggested_improvements:
                        print(f"⚠️ {section_id} 硬问题反馈没有可验证的局部补丁，保留原预览")
                        break
                    if not self.optimize_with_feedback(section, feedback):
                        break
                    review_completed = False

                # 视觉审查已完成或预算已耗尽；结果只用于警告，不阻塞交付。
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
            print(f"❌ {self.learning_topic} {section_id} 渲染过程异常: {str(e)}")
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
            print(f"❌ {self.learning_topic} {section_id} 渲染过程异常: {str(e)}")
            return section_id, False, None, {"passed": False, "error": str(e)}

    def generate_and_render_sections(
        self,
        max_render_workers: Optional[int] = None,
    ) -> Dict[str, str]:
        """Pipeline section code generation directly into the 1080p baseline renderer.

        Narration remains a deliberate all-section barrier. Once it is ready, each
        section is submitted to the render pool as soon as its source (or fallback
        source) has been persisted; slow code-generation requests no longer keep
        already-ready sections idle.
        """
        if not self.sections:
            raise ValueError(f"{self.learning_topic} 请先生成教学小节")

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

        print(
            f"🔄 启动章节流水线：代码生成并发 {code_workers}，"
            f"1080p 渲染并发 {render_workers}"
        )
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
                            print(f"🛟 {section_id} 已切换稳定保底模板")
                        except Exception as fallback_exc:
                            code_failures.append((section_id, f"{error}; fallback={fallback_exc}"))
                            continue

                    task_data = (section, self.__class__, self.get_serializable_state(), False)
                    render_future = render_executor.submit(self.render_section_worker, task_data)
                    render_futures[render_future] = section_id
                    print(f"🎬 {section_id} 代码已落盘，立即开始 1080p 渲染")

            for render_future in as_completed(render_futures):
                section_id = render_futures[render_future]
                try:
                    sid, success, video_path, quality = render_future.result()
                    self.visual_quality_results[sid] = quality
                    if quality.get("preview_render_seconds") is not None:
                        self.preview_render_seconds.append(float(quality["preview_render_seconds"]))
                    if success and video_path:
                        baseline_results[sid] = video_path
                        print(f"✅ {sid} 1080p 基线渲染成功: {video_path}")
                    else:
                        print(f"⚠️ {sid} 1080p 基线渲染失败")
                except Exception as exc:
                    print(f"❌ {section_id} 1080p 基线渲染过程错误: {exc}")

        if code_failures:
            print(f"⚠️ 流水线中有章节无法形成代码或保底代码: {code_failures}")

        missing_codes = [section.id for section in self.sections if section.id not in self.section_codes]
        if missing_codes:
            print(f"⚠️ 流水线缺少章节代码，将由完整性检查终止缺章交付: {missing_codes}")

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
            print(f"🎥 先并行生成完整 1080p 基线 (最多 {max_workers} 个进程)...")
        else:
            print(f"🔄 已接收流水线生成的 {len(baseline_results)}/{len(self.sections)} 个 1080p 基线章节")

        tasks = []
        for section in self.sections:
            try:
                task_data = (section, self.__class__, self.get_serializable_state(), False)
                tasks.append(task_data)
            except Exception as e:
                print(f"⚠️ 为 {section.id} 准备任务数据时出错: {str(e)}")
                continue

        if not tasks:
            print("❌ 没有有效任务可执行")
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
                            print(f"⚠️ 提交 {section_id} 任务时出错: {str(e)}")
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
                                print(f"✅ {sid} 视频渲染成功: {video_path}")
                            else:
                                failed_count += 1
                                print(f"⚠️ {sid} 视频渲染失败")

                        except Exception as e:
                            failed_count += 1
                            print(f"❌ {section_id} 视频渲染过程错误: {str(e)}")

            except Exception as e:
                print(f"❌ 并行渲染过程中出现严重错误: {str(e)}")
        if successful_count == len(self.sections) and self.use_feedback:
            if self.remaining_pipeline_seconds() > self.finalize_reserve_seconds:
                visual_workers = max(1, int(os.getenv("C2V_VISUAL_WORKERS", "2")))
                visual_tasks = [(section, self.__class__, self.get_serializable_state(), True) for section in self.sections]
                print(f"🔎 1080p 基线完整，开始最多两轮硬问题视觉检查（并发 {visual_workers}）")
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
                                f"{sid} 视觉复查未完成，继续使用已成功的 1080p 基线",
                                section_id=sid,
                            )
            else:
                self.deadline_action = "skip_visual_review_for_deadline"
                self._add_warning("visual_review_skipped", "剩余预算不足，跳过视觉复查并保留完整基线")

        for section_id, quality in self.visual_quality_results.items():
            self.retry_summary.setdefault("sections", {})[section_id] = quality.get("retry_summary", {})
            if quality.get("section_fallback"):
                self.section_fallbacks[section_id] = quality["section_fallback"]
            for warning in quality.get("warnings", []):
                self._add_warning(
                    str(warning.get("code") or "section_warning"),
                    str(warning.get("message") or "章节生成存在非阻塞问题"),
                    **{key: value for key, value in warning.items() if key not in {"code", "message"}},
                )
            if quality.get("feedback_enabled") and not quality.get("passed"):
                self._add_warning(
                    "visual_quality_not_passed",
                    f"{section_id} 已完成渲染，但两轮内未完全通过视觉审查",
                    section_id=section_id,
                )

        if failed_count > 0 or successful_count != len(self.sections):
            raise RuntimeError(f"{len(self.sections) - successful_count} 个章节渲染失败；禁止合并缺章成片")

        self.actual_render_profile = self.preview_render_profile

        # 更新结果并输出统计信息
        self.section_videos.update(results)

        total_sections = len(self.sections)
        print(f"\n📊 渲染统计:")
        print(f"   总小节数: {total_sections}")
        print(f"   成功率: {successful_count/total_sections*100:.1f}%" if total_sections > 0 else "   成功率: 0%")

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
            raise RuntimeError("所有分节视频渲染失败")
        if failed_count > 0 or successful_count != total_sections:
            raise RuntimeError(f"{total_sections - successful_count} 个章节渲染失败；禁止合并缺章成片")
        print("🎉 所有分节视频渲染成功！")

        return results

    def merge_videos(self, output_filename: str = None) -> str:
        """严格按章节顺序合并最终规格视频，并使用物理媒体事实验收。"""
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
            raise ValueError(f"严格合并禁止缺章：{missing}")

        with open(video_list_file, "w", encoding="utf-8") as f:
            for section_id in target_ids:
                video_path = Path(self.section_videos[section_id]).resolve()
                section_media = validate_rendered_media(
                    video_path,
                    self.actual_render_profile,
                    require_audio=True,
                )
                if section_media["video_codec"] != "h264":
                    raise ValueError(f"{section_id} 视频编码不是 H.264: {section_media['video_codec']}")
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
                    raise ValueError(f"成片视频编码不是 H.264: {media['video_codec']}")
                if media["pixel_format"] != "yuv420p":
                    raise ValueError(f"成片像素格式不是 yuv420p: {media['pixel_format']}")
                if media["audio_codec"] != "aac":
                    raise ValueError(f"成片音频编码不是 AAC: {media['audio_codec']}")
                self.media_metadata = media
                break
            except Exception as exc:
                last_error = str(exc)
                print(f"⚠️ 合并或媒体验收第 {attempt}/{self.max_attempts} 次失败: {last_error}")
        else:
            raise RuntimeError(f"合并和媒体验收在 {self.max_attempts} 次尝试后仍失败: {last_error}")

        self.actual_duration_seconds = float(self.media_metadata["duration"])
        self.media_metadata["long_silences"] = None
        target_seconds = float(self.duration * 60)
        duration_range = (target_seconds * 0.85, target_seconds * 1.30)
        if not duration_range[0] <= self.actual_duration_seconds <= duration_range[1]:
            self._add_warning(
                "duration_target_missed",
                f"成片时长 {self.actual_duration_seconds:.2f}s 偏离目标范围，但视频完整可播放",
                actual_duration_seconds=self.actual_duration_seconds,
                accepted_duration_seconds=list(duration_range),
            )
        return str(output_path)

    def GENERATE_VIDEO(self) -> str:
        """Generate complete video with MLLM feedback optimization"""
        try:
            self.generate_outline()
            self.generate_storyboard()
            self.inject_overview_section()
            self.inject_cover_section()
            self.generate_and_render_sections()
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


def process_single_problem(idx: int, problem: Dict[str, str], folder_path: Path, cfg: RunConfig):
    """处理单个编程题目（CLI 批量模式下使用）
    
    Args:
        idx: 题目索引
        problem: 包含 problem_description 和 solution_code 的字典
        folder_path: 输出目录
        cfg: 运行配置
    """
    desc = problem["problem_description"]
    code = problem.get("solution_code", "")
    label = desc[:50] if len(desc) > 50 else desc
    
    print(f"\n🚀 正在处理题目 [{idx}]: {label}")
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

    print(f"✅ 题目 [{idx}] 处理完成。耗时: {duration_minutes:.2f} 分钟, Token 使用: {total_tokens}")
    return label, video_path, duration_minutes, total_tokens


def process_batch(batch_data, cfg: RunConfig):
    """Process a batch of problems (serial within a batch)"""
    batch_idx, problem_batch, folder_path = batch_data
    results = []
    print(f"第 {batch_idx + 1} 批次开始处理 {len(problem_batch)} 个题目")

    for local_idx, (idx, problem) in enumerate(problem_batch):
        try:
            if local_idx > 0:
                delay = random.uniform(3, 6)
                print(f"⏳ 第 {batch_idx + 1} 批次等待 {delay:.1f} 秒...")
                time.sleep(delay)
            results.append(process_single_problem(idx, problem, folder_path, cfg))
        except Exception as e:
            label = problem.get("problem_description", "unknown")[:50]
            print(f"❌ 第 {batch_idx + 1} 批次处理 {label} 失败: {e}")
            results.append((label, None, 0, 0))
    return batch_idx, results


def run_Code2Video(
    problems: List[Dict[str, str]], folder_path: Path, parallel=True, batch_size=3, max_workers=8, cfg: RunConfig = RunConfig()
):
    """批量处理编程题目，生成讲解视频
    
    Args:
        problems: 题目列表，每个元素为 {"problem_description": "...", "solution_code": "..."}
        folder_path: 输出目录
        parallel: 是否并行
        batch_size: 每批处理数量
        max_workers: 最大并行进程数
        cfg: 运行配置
    """
    all_results = []

    if parallel:
        batches = []
        for i in range(0, len(problems), batch_size):
            batch = [(i + j, p) for j, p in enumerate(problems[i : i + batch_size])]
            batches.append((i // batch_size, batch, folder_path))

        print(
            f"🔄 并行批处理模式: {len(batches)} 个批次，每批 {batch_size} 个题目，{max_workers} 个并发批次"
        )
        with ProcessPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(process_batch, batch, cfg): batch for batch in batches}
            for future in as_completed(futures):
                try:
                    batch_idx, batch_results = future.result()
                    all_results.extend(batch_results)
                    print(f"✅ 第 {batch_idx + 1} 批次完成")
                except Exception as e:
                    print(f"❌ 批次处理失败: {e}")
    else:
        print("🔄 串行处理模式")
        for idx, problem in enumerate(problems):
            try:
                all_results.append(process_single_problem(idx, problem, folder_path, cfg))
            except Exception as e:
                label = problem.get("problem_description", "unknown")[:50]
                print(f"❌ 串行处理 {label} 失败: {e}")
                all_results.append((label, None, 0, 0))

    successful_runs = [r for r in all_results if r[1] is not None]
    total_runs = len(all_results)
    if not successful_runs:
        print("\n所有题目处理失败，无法计算平均值。")
        return

    total_duration = sum(r[2] for r in successful_runs)
    total_tokens_consumed = sum(r[3] for r in successful_runs)
    num_successful = len(successful_runs)

    print("\n" + "=" * 50)
    print(f"   总题目数: {total_runs}")
    print(f"   成功处理: {num_successful} ({num_successful/total_runs*100:.1f}%)")
    print(f"   平均耗时 [分]: {total_duration/num_successful:.2f} 分钟/题目")
    print(f"   平均 Token 消耗: {total_tokens_consumed/num_successful:,.0f} tokens/题目")
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
        raise ValueError("无效的 API 模型名称")


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
    parser.add_argument("--problems_file", type=str, help="批量题目 JSON 文件路径（相对于 json_files 目录）", default=None)
    parser.add_argument("--iconfinder_api_key", type=str, default="")

    # Basically invariant parameters
    parser.add_argument("--use_feedback", action="store_true", default=False)
    parser.add_argument("--no_feedback", action="store_false", dest="use_feedback")
    parser.add_argument("--use_assets", action="store_true", default=False)
    parser.add_argument("--no_assets", action="store_false", dest="use_assets")

    parser.add_argument("--max_code_token_length", type=int, help="max # token for generating code", default=10000)
    parser.add_argument("--max_fix_bug_tries", type=int, help="已弃用；总尝试数最多为 3", default=3)
    parser.add_argument("--max_regenerate_tries", type=int, help="已弃用；总尝试数最多为 3", default=3)
    parser.add_argument("--max_feedback_gen_code_tries", type=int, help="已弃用；每轮视觉反馈只改写一次", default=1)
    parser.add_argument("--max_mllm_fix_bugs_tries", type=int, help="已弃用；每轮视觉反馈只渲染一次", default=1)
    parser.add_argument("--feedback_rounds", type=int, default=2)
    parser.add_argument("--duration", type=int, default=None, help="目标时长（分钟）；不传时由 AI 在 5-8 分钟内选择")
    parser.add_argument(
        "--render_profile",
        choices=["1080p30"],
        default="1080p30",
        help="固定渲染规格：1920x1080/30fps",
    )

    parser.add_argument("--parallel", action="store_true", default=False)
    parser.add_argument("--no_parallel", action="store_false", dest="parallel")
    parser.add_argument("--parallel_group_num", type=int, default=3)
    parser.add_argument("--max_concepts", type=int, help="Limit # concepts for a quick run, -1 for all", default=-1)
    parser.add_argument("--problem_description", type=str, help="编程题目描述（单题模式）", default=None)
    parser.add_argument("--solution_code", type=str, help="标准答案代码（单题模式）", default=None)
    
    # 新增参数：最大并行工作进程数
    parser.add_argument("--max_workers", type=int, default=None, help="Force specific number of workers, overriding auto-detection")

    # 用户个性化配置参数 - 新的自然语言描述方式
    parser.add_argument(
        "--user_profile",
        type=str,
        default="",
        help="用户画像的自然语言描述，例如：'我是17岁的高中生，想要的学习难度是入门级，选择的编程语言是Python，目标是利用暑假成功入门Python'"
    )
    parser.add_argument(
        "--difficulty",
        type=str,
        choices=["simple", "medium", "hard"],
        default="medium",
        help="内容难度等级（simple/medium/hard），默认 medium"
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
        print(f"Iconfinder API 密钥: {args.iconfinder_api_key}")
    else:
        print("警告: 配置文件中未找到 Iconfinder API 密钥。使用默认值 (None)。")

    # 判断运行模式
    single_mode = bool(args.problem_description)

    if not single_mode and not args.problems_file:
        raise ValueError("必须提供 --problem_description（单题模式）或 --problems_file（批量模式）")

    # 创建用户个性化配置
    # 难度映射为自然语言描述
    difficulty_desc_map = {
        "simple": "内容难度偏简单入门",
        "medium": "内容难度为中等",
        "hard": "内容难度偏高级进阶",
    }
    difficulty_desc = difficulty_desc_map.get(args.difficulty, "内容难度为中等")

    if args.user_profile:
        # 将 difficulty 自然语言描述追加到用户画像文本
        profile_text = f"{args.user_profile}，{difficulty_desc}"
        print(f"🧠 正在使用 AI 解析用户画像...")
        print(f"📝 用户输入: {profile_text}")
        
        user_profile = create_profile_from_text(profile_text)
        parsed_profile = parse_profile_with_ai_sync(profile_text, api, max_retries=3)
        
        if parsed_profile:
            user_profile.update_with_parsed_profile(parsed_profile)
            print(f"✅ AI 解析成功！")
            
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
        # 即使没有用户画像文本，也将 difficulty 传入
        profile_text = difficulty_desc
        print(f"📋 未提供用户画像，使用难度配置: {difficulty_desc}")
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
        # ===== 单题模式 =====
        print(f"🔄 单题模式: 生成单个编程题讲解视频")
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
            print(f"\n🎉 视频生成成功: {video_path}")
        else:
            print(f"\n❌ 视频生成失败")
        print(f"   耗时: {duration_minutes:.2f} 分钟, Token 使用: {total_tokens}")
    else:
        # ===== 批量模式（从 JSON 文件读取题目列表） =====
        # JSON 文件格式: [{"problem_description": "...", "solution_code": "..."}, ...]
        problems_path = Path(__file__).resolve().parent / "json_files" / args.problems_file
        with open(problems_path, "r", encoding="utf-8") as f:
            problems = json.load(f)
            if args.max_concepts is not None and args.max_concepts > 0:
                problems = problems[: args.max_concepts]

        # 验证格式
        for i, p in enumerate(problems):
            if not isinstance(p, dict) or "problem_description" not in p:
                raise ValueError(
                    f"题目 [{i}] 格式错误：每个元素必须是包含 'problem_description' 字段的字典。"
                    f"\n期望格式: {{\"problem_description\": \"...\", \"solution_code\": \"...\"}}"
                )

        print(f"📋 已加载 {len(problems)} 个题目")

        real_workers = args.max_workers if args.max_workers is not None else get_optimal_workers()

        run_Code2Video(
            problems,
            folder,
            parallel=args.parallel,
            batch_size=max(1, int(len(problems) / args.parallel_group_num)),
            max_workers=real_workers,
            cfg=cfg,
        )
