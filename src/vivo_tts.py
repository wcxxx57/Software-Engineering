"""vivo BlueLM WebSocket TTS client.

The service streams 24 kHz, 16-bit, mono PCM frames. This module validates
the stream and converts it into the 48 kHz stereo WAV format used by Manim.
"""

import base64
import hashlib
import json
import os
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import List
from urllib.parse import urlencode

from pydub import AudioSegment
from pydub.silence import detect_leading_silence
from websockets.sync.client import connect as websocket_connect


DEFAULT_BASE_URL = "wss://api-ai.vivo.com.cn"
DEFAULT_ENGINE_ID = "tts_humanoid_lam"
DEFAULT_VOICE = "F245_natural"
SAMPLE_RATE = 24000
MAX_TEXT_BYTES = 2048


@dataclass(frozen=True)
class VivoTTSConfig:
    app_id: str
    app_key: str
    base_url: str
    engine_id: str
    voice: str
    speed: int
    volume: int


def load_vivo_tts_config() -> VivoTTSConfig:
    app_id = os.getenv("VIVO_TTS_APP_ID") or os.getenv("APP_ID")
    app_key = os.getenv("VIVO_TTS_APP_KEY") or os.getenv("APP_KEY")
    if not app_id:
        raise ValueError("Missing vivo TTS AppID. Set VIVO_TTS_APP_ID.")
    if not app_key:
        raise ValueError("Missing vivo TTS AppKey. Set VIVO_TTS_APP_KEY.")

    try:
        speed = int(os.getenv("VIVO_TTS_SPEED", "50"))
        volume = int(os.getenv("VIVO_TTS_VOLUME", "50"))
    except ValueError as exc:
        raise ValueError("VIVO_TTS_SPEED and VIVO_TTS_VOLUME must be integers.") from exc
    if not 0 <= speed <= 100:
        raise ValueError("VIVO_TTS_SPEED must be between 0 and 100.")
    if not 1 <= volume <= 100:
        raise ValueError("VIVO_TTS_VOLUME must be between 1 and 100.")

    return VivoTTSConfig(
        app_id=app_id,
        app_key=app_key,
        base_url=(os.getenv("VIVO_TTS_BASE_URL") or DEFAULT_BASE_URL).rstrip("/"),
        engine_id=os.getenv("VIVO_TTS_ENGINE_ID") or DEFAULT_ENGINE_ID,
        voice=os.getenv("VIVO_TTS_VOICE") or DEFAULT_VOICE,
        speed=speed,
        volume=volume,
    )


def split_text(text: str, max_bytes: int = MAX_TEXT_BYTES) -> List[str]:
    text = text.strip()
    if not text:
        raise ValueError("TTS text must not be empty.")

    chunks: List[str] = []
    current: List[str] = []
    current_bytes = 0
    for character in text:
        character_bytes = len(character.encode("utf-8"))
        if current and current_bytes + character_bytes > max_bytes:
            chunks.append("".join(current))
            current = []
            current_bytes = 0
        current.append(character)
        current_bytes += character_bytes
    if current:
        chunks.append("".join(current))
    return chunks


def build_endpoint(config: VivoTTSConfig) -> str:
    endpoint = config.base_url if config.base_url.endswith("/tts") else f"{config.base_url}/tts"
    params = {
        "engineid": config.engine_id,
        "system_time": str(int(time.time())),
        "user_id": hashlib.sha256(config.app_id.encode("utf-8")).hexdigest()[:32],
        "model": "unknown",
        "product": "unknown",
        "package": "education-video",
        "client_version": "1.0",
        "system_version": "unknown",
        "sdk_version": "1.0",
        "android_version": "unknown",
        "requestId": str(uuid.uuid4()),
    }
    return f"{endpoint}?{urlencode(params)}"


def request_pcm(text: str, timeout: int = 120) -> bytes:
    config = load_vivo_tts_config()
    headers = {
        "Authorization": f"Bearer {config.app_key}",
        "X-AI-GATEWAY-SIGNATURE": "developers-aigc",
        "vaid": config.app_id,
    }
    pcm_chunks: List[bytes] = []

    for text_chunk in split_text(text):
        with websocket_connect(
            build_endpoint(config),
            additional_headers=headers,
            open_timeout=timeout,
            close_timeout=min(timeout, 10),
            proxy=None,
        ) as websocket:
            handshake = json.loads(websocket.recv(timeout=timeout))
            if int(handshake.get("error_code", -1)) != 0:
                raise RuntimeError(
                    f"vivo TTS handshake failed: {handshake.get('error_code')} {handshake.get('error_msg', '')}"
                )

            websocket.send(
                json.dumps(
                    {
                        "aue": 0,
                        "auf": f"audio/L16;rate={SAMPLE_RATE}",
                        "vcn": config.voice,
                        "speed": config.speed,
                        "volume": config.volume,
                        "text": base64.b64encode(text_chunk.encode("utf-8")).decode("ascii"),
                        "encoding": "utf8",
                        "sfl": 1,
                        "reqId": int(time.time_ns() // 1_000_000),
                    },
                    ensure_ascii=False,
                )
            )

            while True:
                message = json.loads(websocket.recv(timeout=timeout))
                error_code = int(message.get("error_code", -1))
                if error_code != 0:
                    raise RuntimeError(
                        f"vivo TTS synthesis failed: {error_code} {message.get('error_msg', '')}"
                    )
                data = message.get("data")
                if not data:
                    continue
                encoded_audio = data.get("audio")
                if encoded_audio:
                    pcm_chunks.append(base64.b64decode(encoded_audio))
                if int(data.get("status", -1)) == 2:
                    break

    pcm_audio = b"".join(pcm_chunks)
    if not pcm_audio:
        raise RuntimeError("vivo TTS returned no PCM audio data.")
    if len(pcm_audio) % 2:
        raise RuntimeError("vivo TTS returned an invalid 16-bit PCM payload.")
    return pcm_audio


def normalize_pcm(pcm_audio: bytes, target_path: Path) -> Path:
    target_path = Path(target_path).resolve().with_suffix(".wav")
    audio = AudioSegment(data=pcm_audio, sample_width=2, frame_rate=SAMPLE_RATE, channels=1)
    if len(audio) < 250:
        raise RuntimeError(f"vivo TTS audio is too short to be valid: {len(audio)} ms")
    if audio.rms == 0:
        raise RuntimeError("vivo TTS audio is silent.")

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


def synthesize_vivo_tts_audio(text: str, output_path: Path, timeout: int = 120) -> Path:
    return normalize_pcm(request_pcm(text=text, timeout=timeout), output_path)
