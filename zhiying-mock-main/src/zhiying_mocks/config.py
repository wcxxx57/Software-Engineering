"""Environment-driven configuration.

Per-service overrides follow the naming convention
``MOCK_<SERVICE>_GENERATING_DELAY_MS`` / ``MOCK_<SERVICE>_FINISHED_DELAY_MS`` /
``MOCK_<SERVICE>_FAILURE_RATE`` where ``<SERVICE>`` is the service name in
upper snake case (e.g. ``KNOWLEDGE_VIDEO``). Missing per-service values fall
back to the global ``MOCK_*`` defaults.
"""

from __future__ import annotations

import os

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    rabbitmq_url: str = "amqp://dev:dev@localhost:5672/%2f"
    backend_base_url: str = "http://localhost:9000"

    mock_generating_delay_ms: int = 500
    mock_finished_delay_ms: int = 3000
    mock_failure_rate: float = 0.0
    mock_prefetch: int = 16

    mock_video_object_key: str = "knowledge-videos/mock-placeholder.mp4"
    mock_code_video_object_key: str = "code-videos/mock-placeholder.mp4"
    mock_html_object_key: str = "interactive-html/mock-placeholder/index.html"

    mock_pretest_problem_count: int = 10
    mock_quiz_problem_count: int = 5
    mock_plan_tasks_per_stage: int = 3

    knowledge_video_api_key: str = "sk-knowledge-video-dev"
    code_video_api_key: str = "sk-code-video-dev"
    interactive_html_api_key: str = "sk-interactive-html-dev"
    knowledge_explanation_api_key: str = "sk-knowledge-explanation-dev"
    pretest_api_key: str = "sk-pretest-dev"
    plan_api_key: str = "sk-plan-dev"
    quiz_api_key: str = "sk-quiz-dev"

    callback_timeout_s: float = Field(default=10.0)

    health_host: str = "0.0.0.0"
    health_port: int = 9200

    def generating_delay_ms(self, service: str) -> int:
        return _env_int(
            f"MOCK_{service.upper()}_GENERATING_DELAY_MS",
            self.mock_generating_delay_ms,
        )

    def finished_delay_ms(self, service: str) -> int:
        return _env_int(
            f"MOCK_{service.upper()}_FINISHED_DELAY_MS",
            self.mock_finished_delay_ms,
        )

    def failure_rate(self, service: str) -> float:
        return _env_float(
            f"MOCK_{service.upper()}_FAILURE_RATE",
            self.mock_failure_rate,
        )


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default
