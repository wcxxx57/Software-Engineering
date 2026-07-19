import math
import subprocess
import sys
import wave
from pathlib import Path

import imageio_ffmpeg

from prompts.base_class import base_class
from src.cover_scene import generate_cover_manim_code
from src.gpt_request import _sample_video_frames
from src.rendering import detect_long_silences, get_render_profile, validate_rendered_media
from src.utils import replace_base_class


def _tone_wav(path: Path, seconds: float = 1.2, rate: int = 48000) -> Path:
    frames = bytearray()
    for index in range(int(seconds * rate)):
        sample = int(9000 * math.sin(2 * math.pi * 220 * index / rate))
        frames.extend(sample.to_bytes(2, "little", signed=True))
    with wave.open(str(path), "wb") as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(rate)
        stream.writeframes(bytes(frames))
    return path


def test_manim_cover_preview_renders_with_continuous_audio(tmp_path):
    audio = _tone_wav(tmp_path / "voice.wav")
    steps = [{"audio_path": str(audio), "audio_duration": 1.2, "highlight_indices": [0]}]
    code = replace_base_class(
        generate_cover_manim_code("优先队列与二叉堆", "优先队列", steps),
        base_class,
    )
    scene = tmp_path / "cover.py"
    scene.write_text(code, encoding="utf-8")
    media_dir = tmp_path / "media"
    command = [
        sys.executable,
        "-m",
        "manim",
        "render",
        "-r",
        "1920,1080",
        "--fps",
        "30",
        "--media_dir",
        str(media_dir),
        "--disable_caching",
        "-o",
        "cover-smoke.mp4",
        str(scene),
        "CoverScene",
    ]
    result = subprocess.run(command, cwd=tmp_path, capture_output=True, text=True, timeout=180)
    assert result.returncode == 0, result.stderr or result.stdout
    rendered = next(media_dir.rglob("cover-smoke.mp4"))
    media = validate_rendered_media(rendered, get_render_profile("1080p30"), require_audio=True)
    assert media["video_codec"] == "h264"
    assert media["audio_codec"] == "aac"


def test_physical_4k_profile_and_long_silence_detection(tmp_path):
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    output = tmp_path / "native-4k.mp4"
    result = subprocess.run(
        [
            ffmpeg,
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=#fffdf4:s=3840x2160:r=30:d=0.5",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=220:sample_rate=48000:duration=0.5",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(output),
        ],
        capture_output=True,
        text=True,
        timeout=180,
    )
    assert result.returncode == 0, result.stderr
    media = validate_rendered_media(output, get_render_profile("4k30"), require_audio=True)
    assert (media["width"], media["height"], round(media["fps"])) == (3840, 2160, 30)
    assert media["pixel_format"] == "yuv420p"

    silent = tmp_path / "silent.mp4"
    result = subprocess.run(
        [
            ffmpeg,
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=white:s=320x180:r=10:d=4.2",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=48000:cl=stereo:d=4.2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(silent),
        ],
        capture_output=True,
        text=True,
        timeout=180,
    )
    assert result.returncode == 0, result.stderr
    intervals = detect_long_silences(silent, minimum_seconds=3.5)
    assert intervals and intervals[0][1] - intervals[0][0] >= 3.5
    timestamps = [timestamp for timestamp, _ in _sample_video_frames(
        str(silent), interval_seconds=1.0, extra_timestamps=[0.125, 2.375]
    )]
    assert 0.125 in timestamps and 2.375 in timestamps
