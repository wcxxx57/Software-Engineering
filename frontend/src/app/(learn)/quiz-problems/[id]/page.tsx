import { ArrowLeft, BookOpen, Check, CircleHelp, Lightbulb, X } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { serverFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { quizProblemReviewSchema, type QuizProblemReview } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

const choices = ["A", "B", "C", "D"] as const;

export default async function QuizProblemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const problemId = Number(id);
  if (!Number.isInteger(problemId) || problemId <= 0) redirect("/mistakes");

  let problem: QuizProblemReview;
  try {
    problem = await serverFetch<QuizProblemReview>(`/quiz-problems/${problemId}`, {
      schema: quizProblemReviewSchema,
    });
  } catch (error) {
    if (error instanceof ApiError) redirect("/mistakes");
    throw error;
  }

  const hasAnswered = problem.chosen_answer != null;
  const isCorrect = hasAnswered && problem.chosen_answer === problem.answer;

  return (
    <main className="min-h-dvh bg-canvas px-6 py-8 sm:px-12 sm:py-12">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-7">
        <Link
          href="/mistakes"
          className="inline-flex w-fit items-center gap-1.5 rounded-full border border-white/80 bg-white/75 px-4 py-2 text-sm font-bold text-brand-dark shadow-[0_4px_12px_color-mix(in_oklch,var(--border-muted)_25%,transparent)] transition hover:-translate-y-px hover:bg-white"
        >
          <ArrowLeft className="size-4" />
          返回收藏夹
        </Link>

        <header className="rounded-[28px] border border-white/70 bg-gradient-to-br from-white/90 to-palette-yellow-mist/60 p-6 shadow-[0_8px_24px_color-mix(in_oklch,var(--border-muted)_22%,transparent)] sm:p-8">
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-palette-yellow-light px-3 py-1.5 text-brand-dark">
              <CircleHelp className="size-3.5" />
              收藏题目
            </span>
            <span className="rounded-full bg-palette-blue-mist px-3 py-1.5 text-palette-blue">
              {problem.source.subject_name}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-palette-purple-mist px-3 py-1.5 text-palette-purple">
              <BookOpen className="size-3.5" />
              {problem.source.knowledge_point_title}
            </span>
          </div>
          <h1 className="mt-5 text-2xl font-black leading-relaxed text-brand-dark sm:text-3xl" style={{ whiteSpace: "pre-wrap" }}>
            {problem.content}
          </h1>
          <p className="mt-3 text-sm font-medium text-brand-medium">来自：{problem.source.stage_title} · {problem.source.task_title}</p>
        </header>

        <section className="flex flex-col gap-3" aria-label="题目选项">
          {choices.map((letter) => (
            <Choice key={letter} letter={letter} problem={problem} reveal={hasAnswered} />
          ))}
        </section>

        <section className="rounded-[24px] border border-palette-yellow/50 bg-gradient-to-br from-palette-yellow-light/55 to-palette-orange-lighter/40 p-6 shadow-[0_5px_18px_color-mix(in_oklch,var(--palette-orange)_18%,transparent)] sm:p-7">
          <div className="flex items-center gap-2 text-base font-extrabold text-brand-dark">
            <Lightbulb className="size-5 text-palette-orange" />
            题目解析
          </div>
          {hasAnswered ? (
            <p className={cn("mt-3 text-sm font-bold", isCorrect ? "text-palette-green" : "text-destructive")}>
              {isCorrect ? "你的回答正确" : `你的答案：${problem.chosen_answer}；正确答案：${problem.answer}`}
            </p>
          ) : (
            <p className="mt-3 text-sm font-bold text-brand-medium">这道题尚未作答，正确答案为 {problem.answer}</p>
          )}
          <p className="mt-4 whitespace-pre-wrap text-base font-medium leading-8 text-brand-dark">{problem.explanation}</p>
        </section>
      </div>
    </main>
  );
}

function Choice({
  letter,
  problem,
  reveal,
}: {
  letter: (typeof choices)[number];
  problem: QuizProblemReview;
  reveal: boolean;
}) {
  const value = problem[`choice_${letter.toLowerCase()}` as "choice_a" | "choice_b" | "choice_c" | "choice_d"];
  const selected = problem.chosen_answer === letter;
  const correct = problem.answer === letter;
  const state = reveal
    ? selected && correct
      ? "border-palette-green bg-palette-green-lighter/35"
      : selected
        ? "border-destructive bg-danger-surface/45"
        : correct
          ? "border-palette-green/70 bg-palette-green-lighter/25"
          : "border-border/30 bg-white/75"
    : "border-palette-yellow-light/80 bg-white/85";

  return (
    <div className={cn("flex items-center gap-4 rounded-2xl border-2 px-5 py-4 shadow-[var(--shadow-soft)]", state)}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-palette-yellow-light text-sm font-black text-brand-dark">{letter}</span>
      <p className="flex-1 whitespace-pre-wrap text-sm font-semibold leading-relaxed text-brand-dark">{value}</p>
      {reveal && selected && correct ? <Check className="size-5 text-palette-green" /> : null}
      {reveal && selected && !correct ? <X className="size-5 text-destructive" /> : null}
      {reveal && !selected && correct ? <Lightbulb className="size-5 text-palette-green" /> : null}
    </div>
  );
}
