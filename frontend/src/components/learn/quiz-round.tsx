"use client";

import type { ComponentType, SVGProps } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Lightbulb,
  Loader2,
  Rocket,
  Star,
  X,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { meQueryKey } from "@/lib/query/keys";
import {
  usePatchQuizAnswer,
  useStudyQuiz,
  useSubmitQuiz,
  useToggleProblemBookmark,
} from "@/lib/query/study-quiz";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

const OPTION_LETTERS = ["A", "B", "C", "D"] as const;
type AnswerLetter = (typeof OPTION_LETTERS)[number];

export function QuizRound({
  quizId,
  taskId,
  onRequestNewQuiz,
}: {
  quizId: number;
  taskId: number;
  onRequestNewQuiz: () => void;
}) {
  const { data: quiz, isLoading } = useStudyQuiz(quizId);
  const patchAnswer = usePatchQuizAnswer(quizId);
  const submitQuiz = useSubmitQuiz(quizId, taskId);
  const toggleBookmark = useToggleProblemBookmark(quizId);
  const qc = useQueryClient();

  const [currentIndex, setCurrentIndex] = useState(0);

  const sortedProblems = useMemo(
    () =>
      quiz
        ? [...quiz.problems].sort((a, b) => a.sort_order - b.sort_order)
        : [],
    [quiz],
  );

  if (isLoading || !quiz) {
    return <LoadingPanel message="正在加载小测…" />;
  }

  if (quiz.status === "QUEUING" || quiz.status === "GENERATING") {
    return (
      <LoadingPanel
        message={
          quiz.status === "QUEUING"
            ? "已加入队列，等待 AI 排期…"
            : "AI 正在生成测试题目…"
        }
      />
    );
  }

  if (quiz.status === "FAILED") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-destructive/40 bg-danger-surface/40 px-6 py-10 text-center">
        <XCircle className="size-10 stroke-destructive" strokeWidth={1.6} />
        <p className="text-sm font-bold text-brand-dark">本轮测验生成失败</p>
        <p className="text-xs leading-relaxed text-brand-medium">
          消耗已退还。可点击下方按钮再开一轮，按现行规则扣费。
        </p>
        <Button
          type="button"
          onClick={onRequestNewQuiz}
          className="bg-gradient-to-br from-palette-yellow to-palette-orange font-bold text-brand-dark hover:opacity-90"
        >
          再开一轮
        </Button>
      </div>
    );
  }

  const total = sortedProblems.length;
  if (total === 0) {
    return <LoadingPanel message="正在加载题目…" />;
  }

  const safeIndex = Math.min(Math.max(0, currentIndex), total - 1);
  const current = sortedProblems[safeIndex];
  const submitted = quiz.status === "SUBMITTED";
  const answeredCount = sortedProblems.filter(
    (p) => p.chosen_answer != null,
  ).length;
  const allAnswered = answeredCount === total;

  const correctCount = submitted
    ? sortedProblems.filter((p) => p.chosen_answer === p.answer).length
    : 0;
  const wrongCount = submitted ? total - correctCount : 0;
  const accuracy = submitted ? Math.round((correctCount / total) * 100) : 0;

  const handleSelect = (letter: AnswerLetter) => {
    if (submitted || patchAnswer.isPending) return;
    patchAnswer.mutate({ problemEntryId: current.id, answer: letter });
  };

  const handleSubmit = () => {
    if (!allAnswered || submitQuiz.isPending) return;
    submitQuiz.mutate(undefined, {
      onSuccess: (data) => {
        const correct = (data as { correct_problems?: number }).correct_problems;
        toast.success(
          typeof correct === "number"
            ? `提交成功，答对 ${correct} / ${total} 题`
            : "提交成功",
        );
        setCurrentIndex(0);
      },
    });
  };

  const handleToggleFav = () => {
    if (toggleBookmark.isPending) return;
    toggleBookmark.mutate(current.id, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: meQueryKey });
      },
    });
  };

  const goPrev = () => setCurrentIndex((i) => Math.max(0, i - 1));
  const goNext = () =>
    setCurrentIndex((i) => Math.min(total - 1, i + 1));

  const progress = ((safeIndex + 1) / total) * 100;

  return (
    <div className="flex flex-col gap-5">
      {submitted ? (
        <div className="flex flex-wrap items-center justify-center gap-3 rounded-2xl bg-gradient-to-br from-palette-yellow-light/60 to-palette-orange-lighter/40 px-5 py-3 text-sm font-bold text-brand-dark">
          <span className="text-palette-green">正确 {correctCount}</span>
          <span className="text-brand-light">·</span>
          <span className="text-destructive">错误 {wrongCount}</span>
          <span className="text-brand-light">·</span>
          <span>准确率 {accuracy}%</span>
        </div>
      ) : null}

      <div className="h-2 w-full overflow-hidden rounded-full bg-border/15">
        <div
          className="h-full rounded-full bg-gradient-to-r from-palette-orange to-palette-yellow transition-[width] duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="relative flex items-center justify-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          disabled={safeIndex === 0}
          onClick={goPrev}
          aria-label="上一题"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="text-sm font-bold text-brand-medium">
          {safeIndex + 1} / {total}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          disabled={safeIndex === total - 1}
          onClick={goNext}
          aria-label="下一题"
        >
          <ChevronRight className="size-4" />
        </Button>
        {submitted ? (
          <button
            type="button"
            onClick={handleToggleFav}
            disabled={toggleBookmark.isPending}
            className={cn(
              "absolute right-0 inline-flex size-9 items-center justify-center rounded-full border transition",
              current.bookmarked
                ? "border-palette-yellow bg-palette-yellow-light text-palette-orange"
                : "border-border/40 bg-white text-brand-light hover:border-palette-yellow hover:text-palette-orange",
            )}
            aria-label={
              current.bookmarked ? "取消收藏" : "加入收藏"
            }
          >
            <Star
              className={cn(
                "size-4",
                current.bookmarked && "fill-current",
              )}
            />
          </button>
        ) : null}
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
          const isSelected = current.chosen_answer === letter;
          const isCorrect = current.answer === letter;

          let stateClass =
            "border-palette-yellow-light/80 bg-white hover:-translate-y-0.5 hover:border-palette-orange/60 hover:bg-palette-orange-lighter/20";
          let badge: {
            label: string;
            Icon: ComponentType<SVGProps<SVGSVGElement>>;
            className: string;
          } | null = null;

          if (submitted) {
            if (isSelected && isCorrect) {
              stateClass =
                "border-palette-green bg-palette-green-lighter/40";
              badge = {
                label: "回答正确",
                Icon: Check,
                className: "bg-palette-green-lighter text-palette-green",
              };
            } else if (isSelected && !isCorrect) {
              stateClass = "border-destructive bg-danger-surface/40";
              badge = {
                label: "你的答案",
                Icon: X,
                className: "bg-danger-surface text-destructive",
              };
            } else if (!isSelected && isCorrect) {
              stateClass =
                "border-palette-green/60 bg-palette-green-lighter/30";
              badge = {
                label: "正确答案",
                Icon: Lightbulb,
                className: "bg-palette-green-lighter text-palette-green",
              };
            } else {
              stateClass = "border-border/30 bg-white opacity-70";
            }
          } else if (isSelected) {
            stateClass =
              "border-palette-orange bg-palette-orange-lighter/40";
          }

          return (
            <button
              key={letter}
              type="button"
              disabled={submitted || patchAnswer.isPending}
              onClick={() => handleSelect(letter)}
              className={cn(
                "flex items-center gap-4 rounded-2xl border-2 px-4 py-3.5 text-left shadow-[var(--shadow-soft)] transition",
                "disabled:cursor-default",
                stateClass,
              )}
            >
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold transition",
                  isSelected
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
              {badge ? (
                <span
                  className={cn(
                    "ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold",
                    badge.className,
                  )}
                >
                  <badge.Icon className="size-3" strokeWidth={3} />
                  {badge.label}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {submitted ? null : (
        <div className="flex justify-center">
          <Button
            type="button"
            size="lg"
            disabled={!allAnswered || submitQuiz.isPending}
            onClick={handleSubmit}
            className="rounded-full bg-gradient-to-br from-palette-yellow to-palette-orange px-8 font-bold text-brand-dark hover:opacity-90"
          >
            {submitQuiz.isPending ? (
              "提交中…"
            ) : allAnswered ? (
              <>
                <Rocket className="size-4" strokeWidth={2.2} />
                提交答案
              </>
            ) : (
              <>
                <ClipboardList className="size-4" strokeWidth={2.2} />
                还有 {total - answeredCount} 题未答
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

function LoadingPanel({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-palette-orange/30 bg-palette-yellow-light/30 px-6 py-12 text-center">
      <Loader2 className="size-10 animate-spin stroke-palette-orange" strokeWidth={1.6} />
      <p className="text-sm font-bold text-brand-dark">{message}</p>
      <p className="text-xs leading-relaxed text-brand-medium">
        生成完成后页面会自动刷新。
      </p>
    </div>
  );
}
