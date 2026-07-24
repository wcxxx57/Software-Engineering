import ast
import io
import json
import os
import random
import re
import shutil
import subprocess
import time
import uuid
import wave
from pathlib import Path
from typing import Callable, List

import imageio_ffmpeg
import requests
from pydub import AudioSegment
from pydub.silence import detect_leading_silence, detect_silence

from src.gpt_request import cfg
from src.vivo_tts import synthesize_vivo_tts_audio


DEFAULT_TTS_BASE_URL = "https://vip.dmxapi.com/v1"
DEFAULT_TTS_MODEL = "tts-pro"
DEFAULT_TTS_VOICE = "alloy"
DEFAULT_SILENT_CHARS_PER_SECOND = 4.5
DEFAULT_SILENT_MIN_SECONDS = 1.0
DEFAULT_SILENT_MAX_SECONDS = 90.0
SILENT_TTS_PROVIDERS = {"", "none", "silent", "off", "disabled"}


def current_tts_provider() -> str:
    return os.getenv("TTS_PROVIDER", "none").strip().lower()


def extract_response_text(response) -> str:
    try:
        content = response.candidates[0].content.parts[0].text
    except Exception:
        try:
            content = response.choices[0].message.content
        except Exception:
            content = str(response)

    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z0-9_-]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text.strip().strip('"')


def retry_with_backoff(operation_name: str, func: Callable, max_retries: int, base_delay: float):
    last_error = None
    for attempt in range(1, max_retries + 1):
        try:
            return func()
        except Exception as exc:
            last_error = exc
            if attempt >= max_retries:
                raise RuntimeError(f"{operation_name} failed after {max_retries} attempts: {exc}") from exc

            delay = (base_delay * (2 ** (attempt - 1))) + random.uniform(0, base_delay)
            print(
                f"⚠️ {operation_name} failed on attempt {attempt}/{max_retries}: {exc}. "
                f"Retrying in {delay:.2f}s..."
            )
            time.sleep(delay)

    raise RuntimeError(f"{operation_name} failed: {last_error}")


# ── 概述旁白扩写的特殊提示词 ─────────────────────────────────
_OVERVIEW_EXPANSION_EXAMPLES = """
你是教学视频旁白润色器，当前正在处理「课程概述/目录导览」部分的旁白。

任务：
- 将下面这条画面短句扩写成一条更自然、口语化、适合 TTS 播放的单句旁白
- 必须像一位经验丰富的老师在课堂上介绍课程大纲一样自然流畅
- 不要每句都用"接下来"开头，要有变化和衔接感
- 必须保持原意，不要引入新知识点
- 必须是"最小增量扩写"，不要写成长段
- 输出只允许是一句纯文本，不要加引号、编号、解释

参考范例（画面短句 → 优秀旁白）：
- "本视频将分为以下几个部分进行讲解" → "在正式开始之前呢，我们先来看一下本节课的整体脉络"
- "第一部分，基本概念" → "首先，我们会从基本概念入手，帮大家打好基础"
- "第二部分，核心原理" → "在此基础上，第二部分我们来深入了解一下核心原理"
- "第三部分，代码实现" → "理解了原理之后，第三部分我们就来动手写代码"
- "第四部分，实战案例" → "第四部分，我们通过一个实战案例来巩固所学的知识"
- "第五部分，性能优化" → "然后，第五部分我们会讲一讲性能优化的技巧"
- "第六部分，常见问题" → "最后，我们会总结一些常见的问题和注意事项"
- "好的，接下来让我们正式开始具体内容的学习吧" → "好，大致了解了课程安排之后，我们就正式进入第一部分的学习"

画面短句：
"""


def _is_overview_screen_text(screen_text: str) -> bool:
    import re as _re
    if _re.search(r"第[一二三四五六七八九十\d]+部分", screen_text):
        return True
    if "本视频将分为" in screen_text or "本题将分为" in screen_text:
        return True
    if "让我们正式开始" in screen_text or "开始具体内容的学习" in screen_text:
        return True
    return False


def expand_screen_text_to_spoken_script(
    screen_text: str,
    api_func: Callable,
    max_retries: int = 3,
    max_tokens: int = 300,
    *,
    previous_screen_text: str = "",
    previous_spoken_script: str = "",
    next_screen_text: str = "",
    section_title: str = "",
    target_seconds: float | None = None,
) -> str:
    duration_instruction = ""
    if target_seconds and target_seconds > 0:
        duration_instruction = (
            f"- 这句话的目标朗读时长约为 {target_seconds:.1f} 秒；"
            "只能通过有效的题意解释、执行追踪、因果关系或边界说明达到时长，不得使用空洞套话\n"
        )
    overview_instruction = (
        "这是导览旁白：参考上一句，像老师介绍解题路线一样自然讲解；不要求每句都有过渡词，"
        "确实需要承接时再根据章节关系选择表达，并避免相邻句机械重复同一个过渡方式。"
        if _is_overview_screen_text(screen_text)
        else ""
    )
    prompt = f"""
你是中文编程题讲解视频的旁白编剧。屏幕教学文字和 TTS 旁白是两条不同的信息链：屏幕保留精炼内容，旁白负责把题意、代码和执行过程讲成完整、流畅的话。

任务：
- 把“当前画面分组”改写成一句语法完整、自然、适合学习的中文教学旁白
- 当前分组即使只有一行，也必须讲成完整句子；多行分组必须用一句话覆盖整组含义
- 结合前后分组自然承接，但不要求使用过渡词，也不要机械重复“随后”“接下来”“然后”“接着”
- 严格服从题目描述和标准答案代码，只能补充必要连接、执行原因和已有边界，不得发明条件、改写算法或引入新解法
{duration_instruction}- 输出只能是一行纯文本，不要加引号、编号、标签、换行或解释
- 必须只包含一个完整句子，并以“。”、“？”或“！”结尾

本节标题：{section_title or '未提供'}
上一画面分组：{previous_screen_text or '无，这是本节第一组'}
上一句旁白：{previous_spoken_script or '无，这是本节第一句'}
当前画面分组：
{screen_text}
下一画面分组：{next_screen_text or '无，这是本节最后一组'}
{overview_instruction}
""".strip()

    def _request():
        response = api_func(prompt, max_tokens=max_tokens)
        spoken_script = extract_response_text(response)
        spoken_script = re.sub(r"^(旁白|输出|spoken_script|narration)\s*[:：]\s*", "", spoken_script, flags=re.I)
        spoken_script = re.sub(r"\s+", "", spoken_script).strip()
        if not spoken_script:
            raise ValueError("empty spoken_script")
        if previous_spoken_script:
            for marker in ("随后", "接下来", "然后", "接着"):
                if previous_spoken_script.startswith(marker) and spoken_script.startswith(marker):
                    raise ValueError(f"adjacent narration repeats {marker}: {spoken_script}")
        if spoken_script[-1:] not in "。？！?!":
            spoken_script += "。"
        sentence_marks = re.findall(r"[。？！?!]", spoken_script)
        if len(sentence_marks) != 1 or spoken_script[-1] not in "。？！?!":
            raise ValueError(f"spoken_script must be exactly one complete sentence: {spoken_script}")
        return spoken_script

    return retry_with_backoff(
        operation_name=f"spoken script expansion for '{screen_text}'",
        func=_request,
        max_retries=max_retries,
        base_delay=0.5,
    )


def get_tts_endpoint_config() -> tuple[str, str, str, str]:
    api_key = os.getenv("TTS_API_KEY") or os.getenv("OPENAI_API_KEY") or cfg("gpt5", "api_key")
    base_url = os.getenv("TTS_BASE_URL") or cfg("gpt5", "base_url") or DEFAULT_TTS_BASE_URL
    model = os.getenv("TTS_MODEL") or DEFAULT_TTS_MODEL
    voice = os.getenv("TTS_VOICE") or DEFAULT_TTS_VOICE

    if not api_key:
        raise ValueError("Missing TTS API key. Set TTS_API_KEY or OPENAI_API_KEY or config api_key.")
    if not base_url:
        raise ValueError("Missing TTS base URL. Set TTS_BASE_URL or configure gpt5.base_url.")

    return api_key, base_url.rstrip("/"), model, voice


def synthesize_silent_tts_audio(text: str, output_path: Path) -> Path:
    """Create a physical silent WAV so the existing timing/render pipeline still works."""
    chars_per_second = float(
        os.getenv("TTS_SILENT_CHARS_PER_SECOND", str(DEFAULT_SILENT_CHARS_PER_SECOND))
    )
    min_seconds = float(os.getenv("TTS_SILENT_MIN_SECONDS", str(DEFAULT_SILENT_MIN_SECONDS)))
    max_seconds = float(os.getenv("TTS_SILENT_MAX_SECONDS", str(DEFAULT_SILENT_MAX_SECONDS)))
    if chars_per_second <= 0 or min_seconds <= 0 or max_seconds < min_seconds:
        raise ValueError("Invalid silent TTS duration configuration")

    visible_chars = max(1, len(re.sub(r"\s+", "", text)))
    punctuation_count = sum(text.count(mark) for mark in "，。！？；：,.!?;:")
    duration_seconds = visible_chars / chars_per_second + punctuation_count * 0.12
    duration_seconds = min(max(duration_seconds, min_seconds), max_seconds)

    output_path = Path(output_path).resolve().with_suffix(".wav")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    sample_rate = 48_000
    channels = 2
    sample_width = 2
    remaining_frames = max(1, round(duration_seconds * sample_rate))
    silent_frame = b"\x00" * sample_width * channels
    chunk_frames = sample_rate

    with wave.open(str(output_path), "wb") as wav_file:
        wav_file.setnchannels(channels)
        wav_file.setsampwidth(sample_width)
        wav_file.setframerate(sample_rate)
        while remaining_frames > 0:
            frames = min(remaining_frames, chunk_frames)
            wav_file.writeframesraw(silent_frame * frames)
            remaining_frames -= frames

    return output_path


def synthesize_tts_audio(
    text: str,
    output_path: Path,
    max_retries: int = 3,
    timeout: int = 120,
) -> Path:
    output_path = Path(output_path).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    provider = current_tts_provider()
    if provider in SILENT_TTS_PROVIDERS:
        return synthesize_silent_tts_audio(text=text, output_path=output_path)
    if provider in {"vivo", "bluelm", "vivo_bluelm"}:
        return retry_with_backoff(
            operation_name=f"vivo TTS synthesis for {output_path.name}",
            func=lambda: synthesize_vivo_tts_audio(text=text, output_path=output_path, timeout=timeout),
            max_retries=max_retries,
            base_delay=1.0,
        )
    if provider not in {"openai", "dmx"}:
        raise ValueError(f"Unsupported TTS_PROVIDER: {provider}")

    api_key, base_url, model, voice = get_tts_endpoint_config()
    endpoint = f"{base_url}/audio/speech"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    payload_candidates = [
        {
            "model": model,
            "voice": voice,
            "input": text,
            "response_format": "wav",
        },
        {
            "model": model,
            "voice": voice,
            "input": text,
        },
        {
            "model": model,
            "input": text,
            "response_format": "wav",
        },
        {
            "model": model,
            "input": text,
        },
    ]

    def _request():
        last_error = None
        for payload in payload_candidates:
            response = requests.post(endpoint, headers=headers, json=payload, timeout=timeout)
            if response.status_code < 400:
                if not response.content:
                    raise RuntimeError("TTS returned empty audio payload")

                content_type = (response.headers.get("Content-Type") or "").lower()
                audio_bytes = response.content

                if "application/json" in content_type or audio_bytes[:1] in (b"{", b"["):
                    raise RuntimeError(f"TTS returned JSON payload instead of audio: {audio_bytes[:400]!r}")

                resolved_path = resolve_audio_output_path(output_path, content_type, audio_bytes)
                resolved_path.write_bytes(audio_bytes)
                normalized_path = normalize_audio_for_manim(resolved_path, output_path.with_suffix(".wav"))
                if resolved_path != normalized_path and resolved_path.exists():
                    resolved_path.unlink()
                return normalized_path

            error_text = response.text[:400]
            last_error = RuntimeError(
                f"TTS HTTP {response.status_code} with payload keys {sorted(payload.keys())}: {error_text}"
            )

            if response.status_code in (401, 403, 404):
                raise last_error
            if response.status_code == 400:
                continue

            raise last_error

        raise last_error or RuntimeError("TTS request failed with unknown error")

    return retry_with_backoff(
        operation_name=f"TTS synthesis for {output_path.name}",
        func=_request,
        max_retries=max_retries,
        base_delay=1.0,
    )


def measure_audio_duration(audio_path: Path) -> float:
    audio_path = Path(audio_path).resolve()
    if audio_path.suffix.lower() == ".wav":
        with wave.open(str(audio_path), "rb") as wav_file:
            frame_rate = wav_file.getframerate()
            frame_count = wav_file.getnframes()
            if frame_rate <= 0:
                raise ValueError(f"Invalid frame rate in {audio_path}")
            return frame_count / float(frame_rate)

    audio = AudioSegment.from_file(audio_path)
    return len(audio) / 1000.0


def validate_tts_audio_clip(audio_path: Path, maximum_silence_seconds: float = 3.5) -> float:
    """Return the physical duration and validate audible providers for abnormal silence."""
    audio_path = Path(audio_path).resolve()
    audio = AudioSegment.from_file(audio_path)
    if len(audio) < 250:
        raise ValueError(f"TTS clip is too short: {audio_path}")
    if current_tts_provider() in SILENT_TTS_PROVIDERS:
        return len(audio) / 1000.0
    if audio.rms == 0:
        raise ValueError(f"invalid or silent TTS clip: {audio_path}")
    silence_threshold = max(-50.0, audio.dBFS - 22.0)
    if detect_silence(
        audio,
        min_silence_len=int(round(maximum_silence_seconds * 1000)),
        silence_thresh=silence_threshold,
    ):
        raise ValueError(f"TTS clip contains silence longer than {maximum_silence_seconds}s: {audio_path}")
    return len(audio) / 1000.0


def normalize_audio_for_manim(source_path: Path, target_path: Path) -> Path:
    source_path = Path(source_path).resolve()
    target_path = Path(target_path).resolve()

    audio = AudioSegment.from_file(source_path)
    if len(audio) < 250:
        raise RuntimeError(f"TTS audio is too short to be valid: {source_path} ({len(audio)} ms)")
    if audio.rms == 0:
        if current_tts_provider() not in SILENT_TTS_PROVIDERS:
            raise RuntimeError(f"TTS audio is silent: {source_path}")
        normalized = audio.set_frame_rate(48000).set_channels(2).set_sample_width(2)
        normalized.export(target_path, format="wav")
        return target_path

    normalized = audio.set_frame_rate(48000).set_channels(2).set_sample_width(2)
    silence_threshold = max(-50.0, normalized.dBFS - 22.0)
    leading = detect_leading_silence(normalized, silence_threshold=silence_threshold, chunk_size=10)
    trailing = detect_leading_silence(normalized.reverse(), silence_threshold=silence_threshold, chunk_size=10)
    keep_ms = 90
    trim_start = max(0, leading - keep_ms)
    trim_end = min(len(normalized), len(normalized) - trailing + keep_ms)
    if trim_end - trim_start >= 250:
        normalized = normalized[trim_start:trim_end]
    normalized.export(target_path, format="wav")
    return target_path


def resolve_audio_output_path(output_path: Path, content_type: str, audio_bytes: bytes) -> Path:
    output_path = Path(output_path).resolve()
    if audio_bytes.startswith(b"RIFF") and audio_bytes[8:12] == b"WAVE":
        return output_path.with_suffix(".wav")

    if audio_bytes.startswith(b"ID3") or audio_bytes[:2] in {b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"}:
        return output_path.with_suffix(".mp3")

    if audio_bytes.startswith(b"OggS") or "ogg" in content_type:
        return output_path.with_suffix(".ogg")

    if "mpeg" in content_type or "mp3" in content_type:
        return output_path.with_suffix(".mp3")

    if "wav" in content_type or "wave" in content_type:
        return output_path.with_suffix(".wav")

    raise RuntimeError(
        f"Unsupported TTS audio format. content_type={content_type!r}, first_bytes={audio_bytes[:16]!r}"
    )


def reset_section_audio_dir(section_audio_dir: Path) -> Path:
    section_audio_dir = Path(section_audio_dir).resolve()
    if section_audio_dir.exists():
        shutil.rmtree(section_audio_dir)
    section_audio_dir.mkdir(parents=True, exist_ok=True)
    return section_audio_dir


def paginate_highlight_groups(section) -> List[List[dict]]:
    """按布局分页，保证一个同步高亮组不会被拆到两页。"""
    groups = getattr(section, "highlight_groups", None) or [[index] for index in range(len(section.lecture_lines))]
    page_limit = 4 if getattr(section, "layout_mode", "no_code") in {"with_code", "full_code"} else 8
    pages: List[List[dict]] = []
    current_page: List[dict] = []
    current_count = 0
    for group in groups:
        if len(group) > page_limit:
            raise ValueError(f"高亮组 {group} 超过单页 {page_limit} 行限制")
        if current_page and current_count + len(group) > page_limit:
            pages.append(current_page)
            current_page = []
            current_count = 0
        current_page.append({
            "highlight_indices": list(group),
            "screen_texts": [section.lecture_lines[index] for index in group],
        })
        current_count += len(group)
    if current_page:
        pages.append(current_page)
    return pages


def _group_descriptors(section) -> List[dict]:
    descriptors: List[dict] = []
    for page_index, page_groups in enumerate(paginate_highlight_groups(section)):
        page_line_indices = [index for group in page_groups for index in group["highlight_indices"]]
        page_screen_texts = [section.lecture_lines[index] for index in page_line_indices]
        for step_index_within_page, group in enumerate(page_groups):
            screen_texts = list(group["screen_texts"])
            descriptors.append(
                {
                    "page_index": page_index,
                    "page_line_indices": page_line_indices,
                    "page_screen_texts": page_screen_texts,
                    "step_index_within_page": step_index_within_page,
                    "highlight_indices": list(group["highlight_indices"]),
                    "screen_texts": screen_texts,
                    "screen_text": "\n".join(screen_texts),
                    "semantic_text": "".join(screen_texts),
                }
            )
    return descriptors


def build_section_steps(
    section,
    output_root: Path,
    api_func: Callable,
    expansion_max_retries: int = 3,
    tts_max_retries: int = 3,
    target_audio_seconds: float | None = None,
) -> List[dict]:
    output_root = Path(output_root).resolve()
    audio_dir = output_root / "audio" / section.id
    audio_dir.parent.mkdir(parents=True, exist_ok=True)
    staging_dir = audio_dir.parent / f".{section.id}.{uuid.uuid4().hex}.building"
    staging_dir.mkdir(parents=True, exist_ok=False)
    section_steps = []
    descriptors = _group_descriptors(section)
    if not descriptors:
        raise ValueError(f"{section.id} has no semantic narration groups")

    per_group_target = None
    if target_audio_seconds and target_audio_seconds > 0:
        per_group_target = target_audio_seconds / len(descriptors)

    try:
        for flat_index, descriptor in enumerate(descriptors):
            previous_text = descriptors[flat_index - 1]["semantic_text"] if flat_index else ""
            next_text = descriptors[flat_index + 1]["semantic_text"] if flat_index + 1 < len(descriptors) else ""
            spoken_script = expand_screen_text_to_spoken_script(
                screen_text=descriptor["semantic_text"],
                api_func=api_func,
                max_retries=expansion_max_retries,
                previous_screen_text=previous_text,
                previous_spoken_script=(section_steps[-1]["spoken_script"] if section_steps else ""),
                next_screen_text=next_text,
                section_title=getattr(section, "title", ""),
                target_seconds=per_group_target,
            )
            filename = f"step_{flat_index:02d}.wav"
            staged_audio_path = staging_dir / filename

            def synthesize_valid_step() -> float:
                synthesize_tts_audio(
                    text=spoken_script,
                    output_path=staged_audio_path,
                    max_retries=1,
                )
                return validate_tts_audio_clip(staged_audio_path)

            audio_duration = retry_with_backoff(
                operation_name=f"validated TTS synthesis for {section.id}/{filename}",
                func=synthesize_valid_step,
                max_retries=tts_max_retries,
                base_delay=1.0,
            )

            section_steps.append(
                {
                    "screen_text": descriptor["screen_text"],
                    "screen_texts": descriptor["screen_texts"],
                    "spoken_script": spoken_script,
                    "audio_path": str((audio_dir / filename).resolve()),
                    "audio_duration": audio_duration,
                    "target_audio_seconds": per_group_target,
                    "page_index": descriptor["page_index"],
                    "page_line_indices": descriptor["page_line_indices"],
                    "page_screen_texts": descriptor["page_screen_texts"],
                    "step_index_within_page": descriptor["step_index_within_page"],
                    "highlight_indices": descriptor["highlight_indices"],
                }
            )

        backup_dir = audio_dir.parent / f".{section.id}.{uuid.uuid4().hex}.backup"
        if audio_dir.exists():
            audio_dir.replace(backup_dir)
        try:
            staging_dir.replace(audio_dir)
        except Exception:
            if backup_dir.exists() and not audio_dir.exists():
                backup_dir.replace(audio_dir)
            raise
        finally:
            if backup_dir.exists():
                shutil.rmtree(backup_dir)
        return section_steps
    except Exception:
        if staging_dir.exists():
            shutil.rmtree(staging_dir)
        raise


def repair_cached_step_audio(
    section_steps: List[dict],
    *,
    max_retries: int = 3,
    duration_tolerance: float = 0.08,
) -> bool:
    """Repair only missing/stale WAV files while preserving valid cached clips."""
    changed = False
    for step in section_steps:
        audio_path = Path(str(step.get("audio_path") or "")).resolve()
        expected_duration = float(step.get("audio_duration") or 0)
        try:
            actual_duration = validate_tts_audio_clip(audio_path) if audio_path.is_file() else -1.0
        except Exception:
            actual_duration = -1.0
        if actual_duration >= 0:
            if abs(actual_duration - expected_duration) > duration_tolerance:
                step["audio_duration"] = actual_duration
                changed = True
            continue

        spoken_script = str(step.get("spoken_script") or "").strip()
        if not spoken_script:
            raise ValueError(f"Cannot repair narration without spoken_script: {audio_path}")
        audio_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = audio_path.with_name(f".{audio_path.stem}.{uuid.uuid4().hex}.repair.wav")
        try:
            def synthesize_valid_repair() -> float:
                synthesize_tts_audio(text=spoken_script, output_path=temporary_path, max_retries=1)
                return validate_tts_audio_clip(temporary_path)

            repaired_duration = retry_with_backoff(
                operation_name=f"repair cached TTS for {audio_path.name}",
                func=synthesize_valid_repair,
                max_retries=max_retries,
                base_delay=1.0,
            )
            temporary_path.replace(audio_path)
            step["audio_duration"] = repaired_duration
            changed = True
        finally:
            temporary_path.unlink(missing_ok=True)
    return changed


def save_section_steps(section_steps: List[dict], output_path: Path) -> Path:
    output_path = Path(output_path).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(section_steps, ensure_ascii=False, indent=2), encoding="utf-8")
    return output_path


def _extract_constant_number(node) -> float | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        value = _extract_constant_number(node.operand)
        if value is not None:
            return -value
    return None


def _extract_steps_alias_offset(node) -> int | None:
    if isinstance(node, ast.Name) and node.id == "steps":
        return 0

    if isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name) and node.value.id == "steps":
        slice_node = node.slice
        if isinstance(slice_node, ast.Slice):
            if slice_node.lower is None:
                return 0
            lower = _extract_constant_number(slice_node.lower)
            if lower is not None:
                return int(lower)

    return None


def _extract_step_index_from_call(
    call: ast.Call,
    alias_offsets: dict[str, int],
    step_aliases: dict[str, int] | None = None,
) -> int | None:
    if len(call.args) < 2:
        return None

    candidate = call.args[1]
    if not isinstance(candidate, ast.Subscript):
        return None

    value = candidate.value
    if isinstance(value, ast.Name) and step_aliases and value.id in step_aliases:
        return step_aliases[value.id]
    if not isinstance(value, ast.Subscript):
        return None
    if not isinstance(value.value, ast.Name):
        return None

    relative_index = _extract_constant_number(value.slice)
    if relative_index is None:
        return None

    base_name = value.value.id
    if base_name == "steps":
        return int(relative_index)
    if base_name in alias_offsets:
        return alias_offsets[base_name] + int(relative_index)

    return None


def _extract_step_index_from_value(candidate, alias_offsets: dict[str, int]) -> int | None:
    if not isinstance(candidate, ast.Subscript):
        return None

    if isinstance(candidate.value, ast.Subscript):
        inner = candidate.value
        if not isinstance(inner.value, ast.Name):
            return None

        base_name = inner.value.id
        step_index = _extract_constant_number(inner.slice)
        if step_index is None:
            return None

        if base_name == "steps":
            return int(step_index)
        if base_name in alias_offsets:
            return alias_offsets[base_name] + int(step_index)
        return None

    if isinstance(candidate.value, ast.Name):
        base_name = candidate.value.id
        step_index = _extract_constant_number(candidate.slice)
        if step_index is None:
            return None

        if base_name == "steps":
            return int(step_index)
        if base_name in alias_offsets:
            return alias_offsets[base_name] + int(step_index)

    return None


def _extract_step_index_from_subscript_arg(
    call: ast.Call,
    alias_offsets: dict[str, int],
    arg_index: int = 0,
) -> int | None:
    if len(call.args) <= arg_index:
        return None
    return _extract_step_index_from_value(call.args[arg_index], alias_offsets)


def _timeline_events_from_statements(
    statements,
    step_count: int,
    events: list[tuple[str, float]],
    alias_offsets: dict[str, int],
    step_aliases: dict[str, int] | None = None,
):
    if step_aliases is None:
        step_aliases = {}

    for stmt in statements:
        if isinstance(stmt, ast.Assign):
            alias_offset = _extract_steps_alias_offset(stmt.value)
            for target in stmt.targets:
                if not isinstance(target, ast.Name):
                    continue
                if alias_offset is not None:
                    alias_offsets[target.id] = alias_offset
                    step_aliases.pop(target.id, None)
                    continue

                step_index = _extract_step_index_from_value(stmt.value, alias_offsets)
                if step_index is not None and 0 <= step_index < step_count:
                    step_aliases[target.id] = step_index
                    alias_offsets.pop(target.id, None)
                else:
                    step_aliases.pop(target.id, None)
                    alias_offsets.pop(target.id, None)
            continue

        if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Call) and isinstance(stmt.value.func, ast.Attribute):
            call = stmt.value
            attr = call.func.attr

            if attr == "play_synced_step":
                step_index = _extract_step_index_from_call(call, alias_offsets, step_aliases)
                if step_index is None or not (0 <= step_index < step_count):
                    raise ValueError("Unable to resolve step index from play_synced_step call")
                events.append(("audio", float(step_index)))
                continue

            if attr == "play_narrated_step":
                step_index = _extract_step_index_from_subscript_arg(call, alias_offsets, arg_index=0)
                if step_index is None or not (0 <= step_index < step_count):
                    raise ValueError("Unable to resolve step index from play_narrated_step call")
                events.append(("audio", float(step_index)))
                continue

            if attr == "add_sound":
                step_index = _extract_step_index_from_subscript_arg(call, alias_offsets)
                if step_index is not None and 0 <= step_index < step_count:
                    events.append(("audio", float(step_index)))
                continue

            if attr == "wait":
                if call.args:
                    wait_duration = _extract_constant_number(call.args[0])
                    if wait_duration is not None and wait_duration > 0:
                        events.append(("silence", wait_duration))
                continue

            if attr == "play":
                run_time = 1.0
                for keyword in call.keywords:
                    if keyword.arg == "run_time":
                        constant = _extract_constant_number(keyword.value)
                        if constant is not None and constant > 0:
                            run_time = constant
                        break
                if run_time > 0:
                    events.append(("silence", run_time))
                continue

            if attr == "replace_lecture_lines":
                continue

        if isinstance(stmt, ast.If):
            condition_is_true = False
            test = stmt.test
            if (
                isinstance(test, ast.Compare)
                and len(test.ops) == 1
                and isinstance(test.ops[0], ast.Gt)
                and isinstance(test.left, ast.Call)
                and isinstance(test.left.func, ast.Name)
                and test.left.func.id == "len"
                and len(test.left.args) == 1
                and isinstance(test.left.args[0], ast.Name)
                and test.left.args[0].id == "steps"
                and len(test.comparators) == 1
            ):
                threshold = _extract_constant_number(test.comparators[0])
                if threshold is not None:
                    condition_is_true = step_count > threshold
            elif isinstance(test, ast.Name) and test.id == "steps":
                condition_is_true = step_count > 0

            branch = stmt.body if condition_is_true else stmt.orelse
            _timeline_events_from_statements(
                branch,
                step_count,
                events,
                alias_offsets.copy(),
                step_aliases.copy(),
            )


def build_section_narration_track(section_steps: List[dict], code_path: Path, output_path: Path) -> Path:
    code_path = Path(code_path).resolve()
    output_path = Path(output_path).resolve()

    tree = ast.parse(code_path.read_text(encoding="utf-8"))
    construct_func = None
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name != "TeachingScene":
            for child in node.body:
                if isinstance(child, ast.FunctionDef) and child.name == "construct":
                    construct_func = child
                    break
        if construct_func is not None:
            break

    if construct_func is None:
        raise ValueError(f"No construct() method found in {code_path}")

    events: list[tuple[str, float]] = []
    _timeline_events_from_statements(construct_func.body, len(section_steps), events, {})

    audio_track = AudioSegment.silent(duration=0, frame_rate=48000)
    for event_type, payload in events:
        if event_type == "audio":
            step = section_steps[int(payload)]
            segment = AudioSegment.from_file(step["audio_path"])
            audio_track += segment
        elif event_type == "silence":
            audio_track += AudioSegment.silent(duration=int(round(payload * 1000)), frame_rate=48000)

    normalized = audio_track.set_frame_rate(48000).set_channels(2).set_sample_width(2)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    normalized.export(output_path, format="wav")
    return output_path


def remux_video_with_audio(video_path: Path, audio_path: Path, output_path: Path) -> Path:
    video_path = Path(video_path).resolve()
    audio_path = Path(audio_path).resolve()
    output_path = Path(output_path).resolve()

    ffprobe_exe = shutil.which("ffprobe")
    if not ffprobe_exe:
        raise RuntimeError("ffprobe is required for physical media duration validation")
    probe = subprocess.run(
        [ffprobe_exe, "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(video_path)],
        capture_output=True,
        text=True,
    )
    if probe.returncode != 0:
        raise RuntimeError(f"Failed to measure video duration: {probe.stderr}")
    video_duration = float(probe.stdout.strip())
    audio_duration = measure_audio_duration(audio_path)
    allowed_drift = max(1.0, audio_duration * 0.03)
    if abs(video_duration - audio_duration) > allowed_drift:
        raise RuntimeError(
            f"Audio/video duration mismatch: video={video_duration:.3f}s, "
            f"audio={audio_duration:.3f}s, allowed={allowed_drift:.3f}s"
        )

    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    result = subprocess.run(
        [
            ffmpeg_exe,
            "-y",
            "-i",
            str(video_path),
            "-i",
            str(audio_path),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            str(output_path),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 or not output_path.exists():
        raise RuntimeError(f"Failed to remux audio into video: {video_path}: {result.stderr}")
    return output_path
