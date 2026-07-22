import base64
import json
import math
import struct
import wave

from src import audio_steps, vivo_tts


class FakeWebSocket:
    def __init__(self, messages):
        self.messages = list(messages)
        self.sent = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def recv(self, timeout=None):
        return self.messages.pop(0)

    def send(self, message):
        self.sent.append(message)


def _audible_pcm(duration_seconds=0.3):
    sample_count = int(vivo_tts.SAMPLE_RATE * duration_seconds)
    return b"".join(
        struct.pack("<h", int(9000 * math.sin(2 * math.pi * 440 * index / vivo_tts.SAMPLE_RATE)))
        for index in range(sample_count)
    )


def test_vivo_websocket_pcm_is_normalized_to_wav(monkeypatch, tmp_path):
    monkeypatch.setenv("VIVO_TTS_APP_ID", "test-app-id")
    monkeypatch.setenv("VIVO_TTS_APP_KEY", "test-app-key")
    monkeypatch.setenv("VIVO_TTS_ENGINE_ID", "tts_humanoid_lam")
    monkeypatch.setenv("VIVO_TTS_VOICE", "F245_natural")

    pcm = _audible_pcm()
    socket = FakeWebSocket(
        [
            json.dumps({"error_code": 0, "error_msg": "connect success"}),
            json.dumps(
                {
                    "error_code": 0,
                    "error_msg": "success",
                    "data": {"status": 2, "audio": base64.b64encode(pcm).decode("ascii")},
                }
            ),
        ]
    )
    connection = {}

    def fake_connect(endpoint, **kwargs):
        connection["endpoint"] = endpoint
        connection["kwargs"] = kwargs
        return socket

    monkeypatch.setattr(vivo_tts, "websocket_connect", fake_connect)
    output = vivo_tts.synthesize_vivo_tts_audio("你好，欢迎学习。", tmp_path / "speech.wav")

    with wave.open(str(output), "rb") as wav_file:
        assert wav_file.getframerate() == 48000
        assert wav_file.getnchannels() == 2
        assert wav_file.getnframes() / wav_file.getframerate() >= 0.29

    assert "engineid=tts_humanoid_lam" in connection["endpoint"]
    assert "test-app-key" not in connection["endpoint"]
    assert connection["kwargs"]["additional_headers"]["X-AI-GATEWAY-SIGNATURE"] == "developers-aigc"
    request = json.loads(socket.sent[0])
    assert base64.b64decode(request["text"]).decode("utf-8") == "你好，欢迎学习。"


def test_audio_steps_dispatches_to_vivo(monkeypatch, tmp_path):
    expected = tmp_path / "speech.wav"
    monkeypatch.setenv("TTS_PROVIDER", "vivo")
    monkeypatch.setattr(audio_steps, "synthesize_vivo_tts_audio", lambda **kwargs: expected)

    assert audio_steps.synthesize_tts_audio("测试", expected, max_retries=1) == expected


def test_split_text_respects_utf8_byte_limit():
    chunks = vivo_tts.split_text("蓝心大模型" * 500)
    assert "".join(chunks) == "蓝心大模型" * 500
    assert all(len(chunk.encode("utf-8")) <= vivo_tts.MAX_TEXT_BYTES for chunk in chunks)
