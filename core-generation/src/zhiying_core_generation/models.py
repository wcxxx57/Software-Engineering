from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

Answer = Literal["A", "B", "C", "D"]


class Problem(BaseModel):
    content: str = Field(min_length=3)
    choice_a: str = Field(min_length=1)
    choice_b: str = Field(min_length=1)
    choice_c: str = Field(min_length=1)
    choice_d: str = Field(min_length=1)
    answer: Answer
    explanation: str = Field(min_length=1)

    @model_validator(mode="after")
    def choices_must_be_distinct(self) -> Problem:
        choices = {self.choice_a, self.choice_b, self.choice_c, self.choice_d}
        if len(choices) != 4:
            raise ValueError("all four choices must be distinct")
        return self


class ProblemsPayload(BaseModel):
    problems: list[Problem]


class PlanTask(BaseModel):
    title: str = Field(min_length=2)
    description: str = Field(min_length=3)


class PlanStage(BaseModel):
    title: str = Field(min_length=2)
    description: str = Field(min_length=3)
    tasks: list[PlanTask]


class PlanPayload(BaseModel):
    stages: list[PlanStage]


class PretestRequest(BaseModel):
    task_id: int
    prompt: str
    total_stages: int = Field(gt=0)
    language: str
    target: str


class PretestResult(BaseModel):
    problem_id: int
    content: str
    choice_a: str
    choice_b: str
    choice_c: str
    choice_d: str
    answer: Answer
    chosen_answer: Answer | None = None
    confidence: str | None = None


class PlanRequest(BaseModel):
    task_id: int
    prompt: str
    total_stages: int = Field(gt=0)
    language: str
    target: str
    pretest_results: list[PretestResult]


class QuizRequest(BaseModel):
    task_id: int
    prompt: str


class KnowledgeExplanationRequest(BaseModel):
    task_id: int
    prompt: str


class ExplanationPayload(BaseModel):
    content: str = Field(min_length=100)
