import type { StudySubject } from "@/lib/api/schemas";

export const STATUS_LABEL: Record<StudySubject["status"], string> = {
  PRETEST_QUEUING: "学前测排队中",
  PRETEST_GENERATING: "学前测生成中",
  PRETEST_READY: "学前测就绪",
  PLAN_QUEUING: "计划排队中",
  PLAN_GENERATING: "计划生成中",
  STUDYING: "学习中",
  FINISHED: "已完成",
  FAILED: "失败",
};

export const STATUS_TONE: Record<StudySubject["status"], string> = {
  PRETEST_QUEUING: "bg-palette-yellow-light text-brand-dark",
  PRETEST_GENERATING: "bg-palette-yellow-light text-brand-dark",
  PRETEST_READY: "bg-palette-orange-lighter text-brand-dark",
  PLAN_QUEUING: "bg-palette-blue-mist text-brand-dark",
  PLAN_GENERATING: "bg-palette-blue-mist text-brand-dark",
  STUDYING: "bg-palette-orange-lighter text-brand-dark",
  FINISHED: "bg-palette-green-lighter text-brand-dark",
  FAILED: "bg-danger-surface text-destructive",
};

export const LANGUAGE_LABEL: Record<string, string> = {
  PYTHON: "Python",
  JAVA: "Java",
  CPP: "C++",
  GO: "Go",
  RUST: "Rust",
};
