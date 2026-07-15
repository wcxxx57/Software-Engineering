import json
import os
import random
import re
import shutil
import ast
import subprocess
import time
import uuid
import wave
from pathlib import Path
from typing import Callable, List

import requests
from pydub import AudioSegment
from pydub.silence import detect_leading_silence
import imageio_ffmpeg

from src.gpt_request import cfg
from src.vivo_tts import synthesize_vivo_tts_audio


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TTS_BASE_URL = "https://vip.dmxapi.com/v1"
DEFAULT_TTS_MODEL = "tts-pro"
DEFAULT_TTS_VOICE = "alloy"


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
    """判断 screen_text 是否属于概述部分（包含"第X部分"等特征词）。"""
    import re as _re
    if _re.search(r"第[一二三四五六七八九十\d]+部分", screen_text):
        return True
    if "本视频将分为" in screen_text:
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
            "用有效的解释、因果或例子达到时长，不得使用空洞套话\n"
        )
    overview_examples = (
        "这是导览旁白：参考上一句，像老师介绍学习路线一样自然讲解；不要求每句都有过渡词，"
        "确实需要承接时再根据章节关系选择表达，并避免相邻句机械重复同一个过渡方式。"
        if _is_overview_screen_text(screen_text)
        else ""
    )
    prompt = f"""
你是中文教学视频的旁白编剧。屏幕文字和旁白是两条不同的信息链：屏幕保留精炼内容，旁白负责把它讲成完整、流畅的话。

任务：
- 把“当前画面分组”改写成一句语法完整、自然、适合学习的中文教学旁白
- 当前分组即使只有一行，也必须讲成完整句子；多行分组必须用一句话覆盖整组含义
- 结合前后分组自然承接，但不要机械重复“接下来我们来看”等套话
- 保持原意，可以补充必要的连接词、因果关系和简短解释，但不能引入本节没有的新知识点
{duration_instruction}- 输出只能是一行纯文本，不要加引号、编号、标签、换行或解释
- 必须只包含一个完整句子，并以“。”、“？”或“！”结尾

本节标题：{section_title or '未提供'}
上一画面分组：{previous_screen_text or '无，这是本节第一组'}
上一句旁白：{previous_spoken_script or '无，这是本节第一句'}
当前画面分组：
{screen_text}
下一画面分组：{next_screen_text or '无，这是本节最后一组'}
{overview_examples}
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
                    raise ValueError(f"adjacent overview narration repeats {marker}: {spoken_script}")
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


def synthesize_tts_audio(
    text: str,
    output_path: Path,
    max_retries: int = 5,
    timeout: int = 120,
) -> Path:
    output_path = Path(output_path).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    provider = os.getenv("TTS_PROVIDER", "openai").strip().lower()
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

            # 仅对显式参数不兼容做 payload 级降级；鉴权/路径类错误直接抛出
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


def normalize_audio_for_manim(source_path: Path, target_path: Path) -> Path:
    source_path = Path(source_path).resolve()
    target_path = Path(target_path).resolve()

    audio = AudioSegment.from_file(source_path)
    if len(audio) < 250:
        raise RuntimeError(f"TTS audio is too short to be valid: {source_path} ({len(audio)} ms)")
    if audio.rms == 0:
        raise RuntimeError(f"TTS audio is silent: {source_path}")

    normalized = audio.set_frame_rate(48000).set_channels(2).set_sample_width(2)
    # Some TTS providers add a noticeable silent pad to both sides of every
    # request.  Sentence units are concatenated without synthetic waits, so
    # keep a small safety pad while removing only provider-added dead air.
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
    tts_max_retries: int = 5,
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
            staged_audio_path = synthesize_tts_audio(
                text=spoken_script,
                output_path=staging_dir / filename,
                max_retries=tts_max_retries,
            )
            audio_duration = measure_audio_duration(staged_audio_path)

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
    max_retries: int = 5,
    duration_tolerance: float = 0.08,
) -> bool:
    """Repair only missing/stale cached WAVs while preserving timeline duration."""
    changed = False
    for step in section_steps:
        audio_path = Path(str(step.get("audio_path") or "")).resolve()
        expected_duration = float(step.get("audio_duration") or 0)
        actual_duration = measure_audio_duration(audio_path) if audio_path.is_file() else -1.0
        if actual_duration >= 0 and abs(actual_duration - expected_duration) <= duration_tolerance:
            continue

        spoken_script = str(step.get("spoken_script") or "").strip()
        if not spoken_script:
            raise ValueError(f"Cannot repair narration without spoken_script: {audio_path}")
        audio_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = audio_path.with_name(f".{audio_path.stem}.{uuid.uuid4().hex}.repair.wav")
        try:
            synthesize_tts_audio(
                text=spoken_script,
                output_path=temporary_path,
                max_retries=max_retries,
            )
            repaired_duration = measure_audio_duration(temporary_path)
            if expected_duration > 0 and abs(repaired_duration - expected_duration) > duration_tolerance:
                tempo = repaired_duration / expected_duration
                adjusted_path = temporary_path.with_name(f".{temporary_path.stem}.adjusted.wav")
                ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
                filters = []
                remaining = tempo
                while remaining > 2.0:
                    filters.append("atempo=2.0")
                    remaining /= 2.0
                while remaining < 0.5:
                    filters.append("atempo=0.5")
                    remaining /= 0.5
                filters.append(f"atempo={remaining:.8f}")
                result = subprocess.run(
                    [
                        ffmpeg_exe,
                        "-y",
                        "-i",
                        str(temporary_path),
                        "-filter:a",
                        ",".join(filters),
                        "-c:a",
                        "pcm_s16le",
                        str(adjusted_path),
                    ],
                    capture_output=True,
                    text=True,
                )
                if result.returncode != 0:
                    raise RuntimeError(f"Failed to align repaired TTS duration: {result.stderr}")
                temporary_path.unlink(missing_ok=True)
                temporary_path = adjusted_path

                target_ms = int(round(expected_duration * 1000))
                adjusted = AudioSegment.from_file(temporary_path)
                if len(adjusted) > target_ms:
                    adjusted = adjusted[:target_ms]
                elif len(adjusted) < target_ms:
                    adjusted += AudioSegment.silent(duration=target_ms - len(adjusted), frame_rate=adjusted.frame_rate)
                adjusted.export(temporary_path, format="wav")

            temporary_path.replace(audio_path)
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


def _extract_step_index_from_call(call: ast.Call, step_aliases: dict[str, int] | None = None) -> int | None:
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
    if not isinstance(value.value, ast.Name) or value.value.id != "steps":
        return None

    step_index = _extract_constant_number(value.slice)
    if step_index is None:
        return None

    return int(step_index)


def _extract_step_index_from_subscript_arg(call: ast.Call, arg_index: int = 0) -> int | None:
    """
    从 steps[N]["audio_path"] 或 steps[N]["audio_duration"] 形式的参数中提取步骤索引 N。

    用于解析 add_sound(steps[0]["audio_path"]) 和 wait(steps[0]["audio_duration"]) 等调用。
    """
    if len(call.args) <= arg_index:
        return None

    candidate = call.args[arg_index]
    if not isinstance(candidate, ast.Subscript):
        return None

    # candidate 可能是 steps[N]["key"] 形式（双层下标）
    inner = candidate.value
    if isinstance(inner, ast.Subscript):
        # steps[N]["key"] → inner.value 是 steps, inner.slice 是 N
        if not isinstance(inner.value, ast.Name) or inner.value.id != "steps":
            return None
        step_index = _extract_constant_number(inner.slice)
        if step_index is not None:
            return int(step_index)
    elif isinstance(candidate.value, ast.Name) and candidate.value.id == "steps":
        # steps[N] 形式（单层下标）
        step_index = _extract_constant_number(candidate.slice)
        if step_index is not None:
            return int(step_index)

    return None


def _timeline_events_from_statements(
    statements,
    step_count: int,
    events: list[tuple[str, float]],
    step_aliases: dict[str, int] | None = None,
):
    if step_aliases is None:
        step_aliases = {}

    for stmt in statements:
        # Generated scenes sometimes use `step = steps[N]` before passing
        # `step["audio_path"]` to play_synced_step. Track that simple alias so
        # the physical narration track preserves the correct chronological audio.
        if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Name):
            target_name = stmt.targets[0].id
            value = stmt.value
            if isinstance(value, ast.Subscript) and isinstance(value.value, ast.Name) and value.value.id == "steps":
                step_index = _extract_constant_number(value.slice)
                if step_index is not None and 0 <= int(step_index) < step_count:
                    step_aliases[target_name] = int(step_index)
                    continue
            step_aliases.pop(target_name, None)

        if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Call) and isinstance(stmt.value.func, ast.Attribute):
            call = stmt.value
            attr = call.func.attr

            if attr == "play_synced_step":
                step_index = _extract_step_index_from_call(call, step_aliases)
                if step_index is None or not (0 <= step_index < step_count):
                    raise ValueError("Unable to resolve step index from play_synced_step call")
                events.append(("audio", float(step_index)))
                continue

            if attr == "play_narrated_step":
                step_index = _extract_step_index_from_subscript_arg(call, arg_index=0)
                if step_index is None or not (0 <= step_index < step_count):
                    raise ValueError("Unable to resolve step index from play_narrated_step call")
                events.append(("audio", float(step_index)))
                continue

            if attr == "add_sound":
                # 识别 self.add_sound(steps[N]["audio_path"]) 模式
                step_index = _extract_step_index_from_subscript_arg(call, arg_index=0)
                if step_index is not None and 0 <= step_index < step_count:
                    events.append(("audio", float(step_index)))
                continue

            if attr == "wait":
                if call.args:
                    # 先尝试常量数字
                    wait_duration = _extract_constant_number(call.args[0])
                    if wait_duration is not None and wait_duration > 0:
                        events.append(("silence", wait_duration))
                    else:
                        # 尝试识别 steps[N]["audio_duration"] 形式（封面模板使用）
                        step_index = _extract_step_index_from_subscript_arg(call, arg_index=0)
                        if step_index is not None and 0 <= step_index < step_count:
                            # wait 的时长等于该 step 的音频时长，但此处我们不重复
                            # 插入音频（add_sound 已处理），只需静音占位即可跳过
                            pass
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
                events.append(("silence", 0.25))
                continue

        if isinstance(stmt, ast.If):
            # Support the simple `if len(steps) > N:` pattern used by prompt few-shot examples.
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
            # Support the simple `if steps:` truthiness check used by cover template.
            elif isinstance(test, ast.Name) and test.id == "steps":
                condition_is_true = step_count > 0

            branch = stmt.body if condition_is_true else stmt.orelse
            _timeline_events_from_statements(branch, step_count, events, step_aliases.copy())


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
    _timeline_events_from_statements(construct_func.body, len(section_steps), events)

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


def cap_video_silences(
    video_path: Path,
    max_silence_seconds: float = 3.0,
    detection_floor_seconds: float = 3.5,
    noise_threshold: str = "-45dB",
) -> tuple[Path, list[tuple[float, float]]]:
    """Cap long silent intervals while cutting video and audio on the same timeline.

    Generated teaching scenes may contain long visual-only waits even though all
    narration clips are present. Keeping the beginning and end of each pause
    preserves visual breathing room; removing only its middle avoids 5-16 second
    dead-air spans without desynchronising the picture and narration.
    """
    video_path = Path(video_path).resolve()
    if not video_path.is_file():
        raise FileNotFoundError(f"Video not found: {video_path}")
    if max_silence_seconds <= 0:
        raise ValueError("max_silence_seconds must be positive")
    if detection_floor_seconds < max_silence_seconds:
        raise ValueError("detection_floor_seconds must be >= max_silence_seconds")

    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    ffprobe_exe = shutil.which("ffprobe")
    if not ffprobe_exe:
        raise RuntimeError("ffprobe is required for physical silence capping")

    probe = subprocess.run(
        [
            ffprobe_exe,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(video_path),
        ],
        capture_output=True,
        text=True,
    )
    if probe.returncode != 0:
        raise RuntimeError(f"Failed to measure video duration: {probe.stderr}")
    original_duration = float(probe.stdout.strip())

    detection = subprocess.run(
        [
            ffmpeg_exe,
            "-hide_banner",
            "-i",
            str(video_path),
            "-af",
            f"silencedetect=noise={noise_threshold}:d={detection_floor_seconds}",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
    )
    if detection.returncode != 0:
        raise RuntimeError(f"Silence detection failed: {detection.stderr}")

    silence_intervals: list[tuple[float, float]] = []
    pending_start: float | None = None
    for event in re.finditer(r"silence_(start|end):\s*([0-9.]+)", detection.stderr):
        event_type, value = event.group(1), float(event.group(2))
        if event_type == "start":
            pending_start = value
        elif pending_start is not None and value > pending_start:
            silence_intervals.append((pending_start, min(value, original_duration)))
            pending_start = None
    if pending_start is not None and original_duration > pending_start:
        silence_intervals.append((pending_start, original_duration))

    half_pause = max_silence_seconds / 2
    removed_intervals = [
        (start + half_pause, end - half_pause)
        for start, end in silence_intervals
        if end - start > max_silence_seconds and end - half_pause > start + half_pause
    ]
    if not removed_intervals:
        return video_path, []

    keep_intervals: list[tuple[float, float]] = []
    cursor = 0.0
    for remove_start, remove_end in removed_intervals:
        if remove_start - cursor > 0.01:
            keep_intervals.append((cursor, remove_start))
        cursor = max(cursor, remove_end)
    if original_duration - cursor > 0.01:
        keep_intervals.append((cursor, original_duration))
    if not keep_intervals:
        raise RuntimeError("Silence capping would remove the entire video")

    filters: list[str] = []
    concat_inputs: list[str] = []
    for index, (start, end) in enumerate(keep_intervals):
        filters.append(f"[0:v]trim=start={start:.6f}:end={end:.6f},setpts=PTS-STARTPTS[v{index}]")
        filters.append(f"[0:a]atrim=start={start:.6f}:end={end:.6f},asetpts=PTS-STARTPTS[a{index}]")
        concat_inputs.append(f"[v{index}][a{index}]")
    filters.append(f"{''.join(concat_inputs)}concat=n={len(keep_intervals)}:v=1:a=1[vout][aout]")

    temp_path = video_path.with_name(f"{video_path.stem}.silence-capped{video_path.suffix}")
    result = subprocess.run(
        [
            ffmpeg_exe,
            "-y",
            "-i",
            str(video_path),
            "-filter_complex",
            ";".join(filters),
            "-map",
            "[vout]",
            "-map",
            "[aout]",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            str(temp_path),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 or not temp_path.exists():
        if temp_path.exists():
            temp_path.unlink()
        raise RuntimeError(f"Failed to cap long silences: {result.stderr}")

    expected_duration = original_duration - sum(end - start for start, end in removed_intervals)
    measured_duration = float(
        subprocess.check_output(
            [
                ffprobe_exe,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(temp_path),
            ],
            text=True,
        ).strip()
    )
    if abs(measured_duration - expected_duration) > 0.75:
        temp_path.unlink()
        raise RuntimeError(
            f"Silence-capped duration mismatch: measured={measured_duration:.3f}s, "
            f"expected={expected_duration:.3f}s"
        )

    os.replace(temp_path, video_path)
    return video_path, removed_intervals
