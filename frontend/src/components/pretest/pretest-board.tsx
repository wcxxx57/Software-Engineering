"use client";

import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  savePretestAnswerAction,
  submitPretestAction,
} from "@/app/(learn)/pretest/actions";
import type {
  PretestProblem,
  StudySubject,
} from "@/lib/api/schemas";

type AnswerLetter = "A" | "B" | "C" | "D";
type Confidence = "NOT_SURE" | "SOMEWHAT_SURE" | "VERY_SURE";

const CONFIDENCE_OPTIONS: {
  key: Confidence;
  label: string;
  className: string;
  activeClassName: string;
}[] = [
  {
    key: "NOT_SURE",
    label: "我不会",
    className:
      "bg-danger-surface/50 text-destructive hover:bg-danger-surface/70",
    activeClassName:
      "bg-danger-surface text-destructive ring-2 ring-destructive/40",
  },
  {
    key: "SOMEWHAT_SURE",
    label: "我不确定",
    className:
      "bg-palette-yellow-light/60 text-brand-dark hover:bg-palette-yellow-light",
    activeClassName:
      "bg-palette-yellow text-brand-dark ring-2 ring-palette-orange/40",
  },
  {
    key: "VERY_SURE",
    label: "我会",
    className:
      "bg-palette-blue-mist/60 text-brand-dark hover:bg-palette-blue-mist",
    activeClassName:
      "bg-palette-blue-lighter text-brand-dark ring-2 ring-palette-blue/40",
  },
];

const OPTION_LETTERS: AnswerLetter[] = ["A", "B", "C", "D"];

type Draft = {
  chosen_answer: AnswerLetter | null;
  confidence: Confidence | null;
};

function buildInitialAnswers(problems: PretestProblem[]): Map<number, Draft> {
  const map = new Map<number, Draft>();
  for (const p of problems) {
    map.set(p.id, {
      chosen_answer: p.chosen_answer ?? null,
      confidence: p.confidence ?? null,
    });
  }
  return map;
}

function firstUnansweredIndex(
  problems: PretestProblem[],
  answers: Map<number, Draft>,
): number {
  for (let i = 0; i < problems.length; i++) {
    const a = answers.get(problems[i].id);
    if (!a || a.chosen_answer === null || a.confidence === null) return i;
  }
  return Math.max(0, problems.length - 1);
}

export function PretestBoard({
  subject,
  problems,
}: {
  subject: StudySubject;
  problems: PretestProblem[];
}) {
  const [answers, setAnswers] = useState<Map<number, Draft>>(() =>
    buildInitialAnswers(problems),
  );
  const initialIndex = useMemo(
    () => firstUnansweredIndex(problems, answers),
    // intentionally only runs once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [pending, startTransition] = useTransition();

  const total = problems.length;
  const current = problems[currentIndex];
  const draft = answers.get(current.id) ?? {
    chosen_answer: null,
    confidence: null,
  };
  const isLast = currentIndex === total - 1;
  const canProceed =
    draft.chosen_answer !== null && draft.confidence !== null;
  const progress = Math.round(((currentIndex + 1) / total) * 100);

  function updateDraft(patch: Partial<Draft>) {
    setAnswers((prev) => {
      const next = new Map(prev);
      const current = next.get(problems[currentIndex].id) ?? {
        chosen_answer: null,
        confidence: null,
      };
      next.set(problems[currentIndex].id, { ...current, ...patch });
      return next;
    });
  }

  function handleSelectAnswer(letter: AnswerLetter) {
    if (pending) return;
    updateDraft({ chosen_answer: letter });
  }

  function handleSelectConfidence(c: Confidence) {
    if (pending) return;
    updateDraft({ confidence: c });
  }

  function handleNext() {
    if (!canProceed || pending) return;
    const problemId = current.id;
    const snapshot = answers.get(problemId)!;
    startTransition(async () => {
      const result = await savePretestAnswerAction(subject.id, problemId, {
        chosen_answer: snapshot.chosen_answer,
        confidence: snapshot.confidence,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setCurrentIndex((i) => Math.min(i + 1, total - 1));
    });
  }

  function handlePrev() {
    if (pending || currentIndex === 0) return;
    setCurrentIndex((i) => Math.max(0, i - 1));
  }

  function handleSubmit() {
    if (pending) return;
    const problemId = current.id;
    const snapshot = answers.get(problemId)!;
    startTransition(async () => {
      // Save the current question if it's fully answered, then submit.
      if (
        snapshot.chosen_answer !== null &&
        snapshot.confidence !== null
      ) {
        const saved = await savePretestAnswerAction(subject.id, problemId, {
          chosen_answer: snapshot.chosen_answer,
          confidence: snapshot.confidence,
        });
        if (!saved.ok) {
          toast.error(saved.message);
          return;
        }
      }
      // submitPretestAction redirects to /dashboard on success;
      // we only reach the next line on failure.
      const result = await submitPretestAction(subject.id);
      toast.error(result.message);
    });
  }

  return (
    <Card className="relative w-full max-w-[650px] overflow-hidden rounded-3xl border border-border/30 bg-white/85 p-0 shadow-[var(--shadow-soft)] backdrop-blur-md">
      <div className="h-1 w-full bg-gradient-to-r from-palette-orange via-palette-yellow to-palette-blue-light" />
      <div className="flex flex-col gap-6 p-8 sm:p-10">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/dashboard"
            aria-label="返回"
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon-sm" }),
              "rounded-full text-brand-medium",
            )}
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="flex flex-col items-end gap-0.5 text-right">
            <span className="text-xs font-medium text-brand-medium">
              {subject.subject}
            </span>
            <span className="text-sm font-bold text-brand-dark">
              学前测验 · 第 {currentIndex + 1} / {total} 题
            </span>
          </div>
        </div>

        <div className="h-2 w-full overflow-hidden rounded-full bg-border/15">
          <div
            className="h-full rounded-full bg-gradient-to-r from-palette-orange to-palette-yellow transition-[width] duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div
          className="text-base leading-relaxed font-semibold text-brand-dark"
          style={{ whiteSpace: "pre-wrap" }}
        >
          {current.content}
        </div>

        <div className="flex flex-col gap-2.5">
          {OPTION_LETTERS.map((letter) => {
            const text = current[
              `choice_${letter.toLowerCase()}` as
                | "choice_a"
                | "choice_b"
                | "choice_c"
                | "choice_d"
            ];
            const selected = draft.chosen_answer === letter;
            return (
              <button
                key={letter}
                type="button"
                disabled={pending}
                onClick={() => handleSelectAnswer(letter)}
                className={cn(
                  "flex items-center gap-4 rounded-2xl border-2 bg-white px-4 py-3.5 text-left transition",
                  "shadow-[var(--shadow-soft)] disabled:cursor-not-allowed disabled:opacity-60",
                  selected
                    ? "border-palette-orange bg-palette-orange-lighter/40"
                    : "border-palette-yellow-light/80 hover:-translate-y-0.5 hover:border-palette-orange/60 hover:bg-palette-orange-lighter/20",
                )}
              >
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold transition",
                    selected
                      ? "bg-gradient-to-br from-palette-yellow to-palette-orange text-brand-dark"
                      : "bg-palette-yellow-light/70 text-brand-medium",
                  )}
                >
                  {letter}
                </span>
                <span
                  className="flex-1 text-sm leading-relaxed text-brand-dark"
                  style={{ whiteSpace: "pre-wrap" }}
                >
                  {text}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-3 border-t border-dashed border-border/40 pt-5">
          <span className="text-sm font-bold text-brand-dark">
            你对这道题的把握程度：
          </span>
          <div className="flex flex-col gap-2 sm:flex-row">
            {CONFIDENCE_OPTIONS.map((opt) => {
              const active = draft.confidence === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  disabled={pending}
                  onClick={() => handleSelectConfidence(opt.key)}
                  className={cn(
                    "flex flex-1 items-center justify-center rounded-full px-4 py-3 text-sm font-bold shadow-[var(--shadow-soft)] transition",
                    "disabled:cursor-not-allowed disabled:opacity-60",
                    active ? opt.activeClassName : opt.className,
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="rounded-full"
              disabled={pending || currentIndex === 0}
              onClick={handlePrev}
            >
              上一题
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="rounded-full"
              disabled={pending}
              onClick={handleSubmit}
            >
              提前结束并生成
            </Button>
          </div>
          <div className="sm:ml-auto sm:flex-1">
            {isLast ? (
              <Button
                type="button"
                size="lg"
                className="w-full rounded-full bg-gradient-to-br from-palette-yellow to-palette-orange text-brand-dark hover:opacity-90"
                disabled={!canProceed || pending}
                onClick={handleSubmit}
              >
                <Sparkles className="size-4" />
                提交并生成专属计划
              </Button>
            ) : (
              <Button
                type="button"
                size="lg"
                className="w-full rounded-full bg-gradient-to-br from-palette-yellow to-palette-orange text-brand-dark hover:opacity-90"
                disabled={!canProceed || pending}
                onClick={handleNext}
              >
                下一题
                <ArrowRight className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
