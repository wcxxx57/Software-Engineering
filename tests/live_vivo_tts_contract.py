"""Optional live vivo TTS contract check.

Run inside the project container with the local .env passed through Compose.
"""

import json
import sys
import wave
from pathlib import Path

from pydub import AudioSegment

from src.audio_steps import synthesize_tts_audio


def main() -> None:
    output_path = Path(sys.argv[1] if len(sys.argv) > 1 else "data/tts_contract/contract.wav")
    text = sys.argv[2] if len(sys.argv) > 2 else "你好，这是一段教学视频音色测试。"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    resolved_path = synthesize_tts_audio(text, output_path, max_retries=1, timeout=60)

    with wave.open(str(resolved_path), "rb") as wav_file:
        result = {
            "path": str(resolved_path),
            "rate": wav_file.getframerate(),
            "channels": wav_file.getnchannels(),
            "duration_seconds": round(wav_file.getnframes() / wav_file.getframerate(), 3),
        }
    result["rms"] = AudioSegment.from_wav(resolved_path).rms
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
