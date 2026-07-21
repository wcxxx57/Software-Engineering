"""Deterministic render profiles and physical media validation."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from typing import Any, Iterable

import imageio_ffmpeg


@dataclass(frozen=True)
class RenderProfile:
    name: str
    width: int
    height: int
    fps: int

    @property
    def manim_args(self) -> list[str]:
        return ["-r", f"{self.width},{self.height}", "--fps", str(self.fps)]


RENDER_PROFILES: dict[str, RenderProfile] = {
    "1080p30": RenderProfile("1080p30", 1920, 1080, 30),
    "4k30": RenderProfile("4k30", 3840, 2160, 30),
    "4k60": RenderProfile("4k60", 3840, 2160, 60),
}


def get_render_profile(value: str | None) -> RenderProfile:
    key = str(value or "4k30").strip().lower()
    try:
        return RENDER_PROFILES[key]
    except KeyError as exc:
        raise ValueError(f"render_profile 必须是 {sorted(RENDER_PROFILES)} 之一") from exc


def render_fingerprint(code: str, section_steps: Iterable[dict[str, Any]], profile: RenderProfile) -> str:
    """Hash every input that can change a rendered section."""
    audio_truth = []
    for step in section_steps:
        audio_path = Path(str(step.get("audio_path") or ""))
        audio_hash = None
        if audio_path.is_file():
            audio_hash = hashlib.sha256(audio_path.read_bytes()).hexdigest()
        audio_truth.append(
            {
                "spoken_script": step.get("spoken_script"),
                "audio_path": str(audio_path),
                "audio_sha256": audio_hash,
                "audio_duration": step.get("audio_duration"),
                "highlight_indices": step.get("highlight_indices"),
            }
        )
    payload = json.dumps(
        {"code": code, "audio": audio_truth, "profile": profile.__dict__},
        ensure_ascii=False,
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()[:20]


def probe_media(video_path: str | Path) -> dict[str, Any]:
    path = Path(video_path).resolve()
    if not path.is_file():
        raise FileNotFoundError(path)
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        raise RuntimeError("ffprobe is required for physical media validation")
    result = subprocess.run(
        [
            ffprobe,
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {path}: {result.stderr}")
    payload = json.loads(result.stdout or "{}")
    streams = payload.get("streams") or []
    video_stream = next((item for item in streams if item.get("codec_type") == "video"), None)
    audio_stream = next((item for item in streams if item.get("codec_type") == "audio"), None)
    if not video_stream:
        raise ValueError(f"Video stream missing: {path}")

    raw_rate = video_stream.get("avg_frame_rate") or video_stream.get("r_frame_rate") or "0/1"
    try:
        fps = float(Fraction(raw_rate))
    except (ValueError, ZeroDivisionError):
        fps = 0.0
    duration_value = (payload.get("format") or {}).get("duration") or video_stream.get("duration")
    return {
        "path": str(path),
        "width": int(video_stream.get("width") or 0),
        "height": int(video_stream.get("height") or 0),
        "fps": fps,
        "duration": float(duration_value or 0.0),
        "video_codec": video_stream.get("codec_name"),
        "pixel_format": video_stream.get("pix_fmt"),
        "has_audio": audio_stream is not None,
        "audio_codec": audio_stream.get("codec_name") if audio_stream else None,
        "audio_sample_rate": int(audio_stream.get("sample_rate") or 0) if audio_stream else 0,
    }


def detect_long_silences(
    video_path: str | Path,
    *,
    minimum_seconds: float = 3.5,
    noise_threshold: str = "-45dB",
) -> list[tuple[float, float]]:
    path = Path(video_path).resolve()
    media = probe_media(path)
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    result = subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-i",
            str(path),
            "-af",
            f"silencedetect=noise={noise_threshold}:d={minimum_seconds}",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"silencedetect failed for {path}: {result.stderr}")

    intervals: list[tuple[float, float]] = []
    pending: float | None = None
    for match in re.finditer(r"silence_(start|end):\s*([0-9.]+)", result.stderr):
        kind, value = match.group(1), float(match.group(2))
        if kind == "start":
            pending = value
        elif pending is not None and value > pending:
            intervals.append((pending, min(value, media["duration"])))
            pending = None
    if pending is not None and media["duration"] > pending:
        intervals.append((pending, media["duration"]))
    return intervals


def validate_rendered_media(
    video_path: str | Path,
    profile: RenderProfile,
    *,
    duration_range: tuple[float, float] | None = None,
    require_audio: bool = True,
    reject_long_silences: bool = False,
) -> dict[str, Any]:
    media = probe_media(video_path)
    errors: list[str] = []
    if (media["width"], media["height"]) != (profile.width, profile.height):
        errors.append(
            f"resolution={media['width']}x{media['height']}, expected={profile.width}x{profile.height}"
        )
    if abs(media["fps"] - profile.fps) > 0.05:
        errors.append(f"fps={media['fps']:.3f}, expected={profile.fps}")
    if require_audio and not media["has_audio"]:
        errors.append("audio stream missing")
    if duration_range and not duration_range[0] <= media["duration"] <= duration_range[1]:
        errors.append(
            f"duration={media['duration']:.3f}s, expected={duration_range[0]:.3f}-{duration_range[1]:.3f}s"
        )
    silences: list[tuple[float, float]] = []
    if reject_long_silences:
        silences = detect_long_silences(video_path)
        if silences:
            longest = max(end - start for start, end in silences)
            errors.append(f"long_silence_count={len(silences)}, longest={longest:.3f}s")
    media["long_silences"] = silences
    if errors:
        raise ValueError(f"Media validation failed for {video_path}: " + "; ".join(errors))
    return media
