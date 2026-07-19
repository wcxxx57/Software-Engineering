from __future__ import annotations

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    rabbitmq_url: str = "amqp://dev:dev@localhost:5672/%2f"
    backend_base_url: str = "http://localhost:9000"

    llm_base_url: str = "https://api.openai.com/v1"
    llm_api_key: str
    llm_model: str = "gpt-4.1-mini"
    llm_timeout_s: float = 120.0
    llm_max_retries: int = 3
    llm_temperature: float = 0.3

    pretest_problem_count: int = 10
    pretest_problem_count_min: int = 6
    pretest_problem_count_max: int = 14
    explanation_target_chars: int = 2600
    explanation_target_chars_min: int = 1200
    explanation_target_chars_max: int = 4800
    explanation_length_max_attempts: int = 2
    quiz_problem_count: int = 5
    plan_tasks_per_stage: int = 3
    worker_prefetch: int = 2

    pretest_api_key: str
    plan_api_key: str
    quiz_api_key: str
    knowledge_explanation_api_key: str

    callback_timeout_s: float = 15.0
    callback_max_retries: int = 3
    health_host: str = "0.0.0.0"
    health_port: int = 9300

    @field_validator(
        "llm_api_key",
        "pretest_api_key",
        "plan_api_key",
        "quiz_api_key",
        "knowledge_explanation_api_key",
    )
    @classmethod
    def must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be blank")
        return value

    @field_validator(
        "pretest_api_key",
        "plan_api_key",
        "quiz_api_key",
        "knowledge_explanation_api_key",
    )
    @classmethod
    def callback_key_must_start_with_sk(cls, value: str) -> str:
        if not value.startswith("sk-"):
            raise ValueError("callback API keys must start with sk-")
        return value

    @field_validator(
        "llm_max_retries",
        "pretest_problem_count",
        "pretest_problem_count_min",
        "pretest_problem_count_max",
        "explanation_target_chars",
        "explanation_target_chars_min",
        "explanation_target_chars_max",
        "explanation_length_max_attempts",
        "quiz_problem_count",
        "plan_tasks_per_stage",
        "worker_prefetch",
        "callback_max_retries",
    )
    @classmethod
    def positive_integer(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("must be positive")
        return value

    @model_validator(mode="after")
    def adaptive_bounds_are_consistent(self) -> Settings:
        if not (
            self.pretest_problem_count_min
            <= self.pretest_problem_count
            <= self.pretest_problem_count_max
        ):
            raise ValueError("PRETEST_PROBLEM_COUNT must be within its min/max bounds")
        if not (
            self.explanation_target_chars_min
            <= self.explanation_target_chars
            <= self.explanation_target_chars_max
        ):
            raise ValueError("EXPLANATION_TARGET_CHARS must be within its min/max bounds")
        return self
