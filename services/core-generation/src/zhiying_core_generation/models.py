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
    knowledge_node_key: str | None = None

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
    knowledge_node_keys: list[str] = Field(min_length=1)


class PlanStage(BaseModel):
    title: str = Field(min_length=2)
    description: str = Field(min_length=3)
    tasks: list[PlanTask]


class PlanPayload(BaseModel):
    stages: list[PlanStage]


class LearnerProfile(BaseModel):
    age: int | None = Field(default=None, ge=0, le=150)
    gender: str | None = None
    introduction: str = ""
    experience_points: int = Field(default=0, ge=0)
    total_checkins: int = Field(default=0, ge=0)
    streak_checkins: int = Field(default=0, ge=0)


class LearningContext(BaseModel):
    subject: str = ""
    target: str = ""
    language: str = ""
    total_stages: int = Field(default=0, ge=0)
    finished_stages: int = Field(default=0, ge=0)
    stage_total_tasks: int = Field(default=0, ge=0)
    stage_finished_tasks: int = Field(default=0, ge=0)
    pretest_total_problems: int = Field(default=0, ge=0)
    pretest_answered_problems: int = Field(default=0, ge=0)
    pretest_correct_problems: int = Field(default=0, ge=0)
    task_title: str | None = None
    task_description: str | None = None


class PretestRequest(BaseModel):
    task_id: int
    prompt: str
    total_stages: int = Field(gt=0)
    language: str
    target: str
    learner_profile: LearnerProfile = Field(default_factory=LearnerProfile)
    authoritative_outline: CurriculumOutline


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
    knowledge_node_key: str | None = None


class PlanRequest(BaseModel):
    task_id: int
    prompt: str
    total_stages: int = Field(gt=0)
    language: str
    target: str
    pretest_results: list[PretestResult]
    learner_profile: LearnerProfile = Field(default_factory=LearnerProfile)
    learner_history: LearnerHistory = Field(default_factory=lambda: LearnerHistory())
    authoritative_outline: CurriculumOutline


class QuizRequest(BaseModel):
    task_id: int
    prompt: str


class KnowledgeExplanationRequest(BaseModel):
    task_id: int
    prompt: str
    learner_profile: LearnerProfile = Field(default_factory=LearnerProfile)
    learning_context: LearningContext | None = None


class ExplanationPayload(BaseModel):
    content: str = Field(min_length=100)


class CurriculumNode(BaseModel):
    node_key: str = Field(min_length=1)
    parent_node_key: str | None = None
    title: str = Field(min_length=1)
    description: str = ""
    depth: int = Field(ge=0)
    sort_order: int = Field(ge=0)


class CurriculumSource(BaseModel):
    platform: str
    institution: str
    source_url: str


class CurriculumOutline(BaseModel):
    template_id: int
    canonical_name: str
    version: int = Field(gt=0)
    sources: list[CurriculumSource]
    nodes: list[CurriculumNode] = Field(min_length=1)


class CurriculumTemplateSummary(BaseModel):
    template_id: int
    canonical_name: str
    version: int
    language: str
    aliases: list[str]
    knowledge_points: list[str]


class LearnerHistory(BaseModel):
    completed_subjects: list[str] = Field(default_factory=list)
    completed_knowledge_node_keys: list[str] = Field(default_factory=list)
    weak_knowledge_node_keys: list[str] = Field(default_factory=list)


class CurriculumAcquisitionRequest(BaseModel):
    task_id: int
    prompt: str
    language: str
    target: str
    available_templates: list[CurriculumTemplateSummary]


class CurriculumSelectionPayload(BaseModel):
    existing_template_id: int | None = None
    reason: str = Field(min_length=1, max_length=300)


class AcquiredCurriculumPayload(BaseModel):
    canonical_name: str = Field(min_length=2)
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    language: str
    aliases: list[str] = Field(min_length=1)
    platform: str
    institution: str
    instructor: str | None = None
    source_url: str
    raw_outline: str
    match_score: float = Field(ge=0, le=1)
    nodes: list[CurriculumNode] = Field(min_length=6)


class GeneratedCurriculumPayload(BaseModel):
    canonical_name: str = Field(min_length=2)
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    language: str
    aliases: list[str] = Field(min_length=1)
    raw_outline: str = Field(min_length=50)
    nodes: list[CurriculumNode] = Field(min_length=6)


class PretestSizingPayload(BaseModel):
    problem_count: int = Field(gt=0)
    reason: str = Field(min_length=1, max_length=200)


class ExplanationSizingPayload(BaseModel):
    target_chars: int = Field(gt=0)
    detail_level: Literal["concise", "standard", "deep"]
    reason: str = Field(min_length=1, max_length=200)


PretestRequest.model_rebuild()
PlanRequest.model_rebuild()
