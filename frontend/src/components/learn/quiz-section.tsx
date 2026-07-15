"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, NotebookPen, Plus, Rocket } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ContentCard } from "@/components/learn/content-card";
import { NewQuizDialog } from "@/components/learn/new-quiz-dialog";
import { QuizRound } from "@/components/learn/quiz-round";
import { meQueryKey } from "@/lib/query/keys";
import { useMe } from "@/lib/query/me";
import {
  taskQuizzesQueryKey,
  useStudyTaskQuizzes,
} from "@/lib/query/study-quiz";
import { cn } from "@/lib/utils";
import type { StudyQuizBrief, StudyTaskStatus } from "@/lib/api/schemas";

function tabSummary(quiz: StudyQuizBrief): string {
  switch (quiz.status) {
    case "QUEUING":
    case "GENERATING":
      return "进行中";
    case "READY":
      return "答题中";
    case "SUBMITTED": {
      if (quiz.total_problems === 0) return "已提交";
      const acc = Math.round(
        (quiz.correct_problems / quiz.total_problems) * 100,
      );
      return `准确率 ${acc}%`;
    }
    case "FAILED":
      return "失败";
  }
}

export function QuizSection({
  taskId,
  taskStatus,
  freeLimit,
  extraGoldCost,
}: {
  taskId: number;
  taskStatus: StudyTaskStatus;
  freeLimit: number;
  extraGoldCost: number;
}) {
  const { data: list = [], isLoading } = useStudyTaskQuizzes(taskId);
  const me = useMe();
  const qc = useQueryClient();

  const sorted = useMemo(
    () => [...list].sort((a, b) => a.created_at - b.created_at),
    [list],
  );

  const [activeQuizId, setActiveQuizId] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (sorted.length === 0) {
      setActiveQuizId(null);
      return;
    }
    if (
      activeQuizId == null ||
      !sorted.some((q) => q.id === activeQuizId)
    ) {
      setActiveQuizId(sorted[sorted.length - 1].id);
    }
  }, [sorted, activeQuizId]);

  const locked = taskStatus === "LOCKED";
  const latest = sorted[sorted.length - 1];
  const canCreateNew =
    !locked &&
    (sorted.length === 0 ||
      latest.status === "SUBMITTED" ||
      latest.status === "FAILED");

  const isFree = sorted.length < freeLimit;
  const goldBalance = me?.gold ?? 0;

  const handleSuccess = (quizId: number) => {
    qc.invalidateQueries({ queryKey: taskQuizzesQueryKey(taskId) });
    qc.invalidateQueries({ queryKey: meQueryKey });
    setActiveQuizId(quizId);
  };

  return (
    <ContentCard
      theme="orange"
      icon={<ClipboardCheck />}
      title="知识点测验"
      subtitle="检验掌握度"
    >
      <div className="relative overflow-hidden rounded-2xl border border-[color-mix(in_oklch,var(--palette-orange-light)_40%,transparent)] bg-gradient-to-br from-palette-orange-lighter/30 to-palette-yellow-light/40 shadow-[inset_0_2px_8px_rgba(0,0,0,0.05)]">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.4)_0%,transparent_60%)]"
        />
        <div className="relative flex flex-col gap-5 px-6 py-8">
          {locked ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <p className="text-sm font-bold text-brand-medium">
                请先完成前置任务后再开始测验
              </p>
            </div>
          ) : isLoading ? (
            <div className="py-10 text-center text-sm text-brand-medium">
              正在加载…
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <NotebookPen
                className="size-10 stroke-palette-orange [filter:drop-shadow(0_4px_12px_color-mix(in_oklch,var(--palette-orange)_30%,transparent))]"
                strokeWidth={1.6}
              />
              <h3 className="text-base font-extrabold text-brand-dark">
                完成学习后，来检验一下掌握程度吧！
              </h3>
              <p className="max-w-md text-xs leading-relaxed text-brand-medium">
                AI 会根据本任务知识点实时生成单选题。
                {freeLimit > 0
                  ? `每个任务前 ${freeLimit} 轮免费，之后每轮扣 ${extraGoldCost} 金币。`
                  : `每轮扣 ${extraGoldCost} 金币。`}
              </p>
              <button
                type="button"
                onClick={() => setDialogOpen(true)}
                className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-palette-yellow to-palette-orange px-7 py-2 text-base font-bold text-brand-dark shadow-[0_4px_16px_color-mix(in_oklch,var(--palette-orange)_35%,transparent)] hover:opacity-90"
              >
                <Rocket className="size-4" strokeWidth={2.2} />
                <span>开始测验</span>
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {sorted.map((quiz, idx) => {
                  const isActive = quiz.id === activeQuizId;
                  const isFailed = quiz.status === "FAILED";
                  return (
                    <button
                      key={quiz.id}
                      type="button"
                      onClick={() => setActiveQuizId(quiz.id)}
                      className={cn(
                        "flex min-w-[96px] flex-col items-center justify-center rounded-2xl px-4 py-2 text-center transition",
                        isActive
                          ? isFailed
                            ? "bg-gradient-to-br from-destructive/80 to-destructive text-white shadow-[0_4px_12px_color-mix(in_oklch,var(--destructive)_30%,transparent)]"
                            : "bg-gradient-to-br from-palette-orange-light to-palette-orange text-white shadow-[0_4px_12px_color-mix(in_oklch,var(--palette-orange)_30%,transparent)]"
                          : "bg-palette-orange-lighter/60 text-brand-medium hover:bg-palette-orange-lighter",
                      )}
                    >
                      <span className="text-sm font-extrabold">
                        测试 {idx + 1}
                      </span>
                      <span
                        className={cn(
                          "text-xs font-semibold",
                          isActive ? "text-white/90" : "text-brand-medium",
                        )}
                      >
                        {tabSummary(quiz)}
                      </span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setDialogOpen(true)}
                  disabled={!canCreateNew}
                  className={cn(
                    "flex min-w-[96px] flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed px-4 py-2 text-sm font-bold transition",
                    canCreateNew
                      ? "border-palette-orange/60 text-palette-orange hover:bg-palette-orange-lighter/40"
                      : "cursor-not-allowed border-border/40 text-brand-light",
                  )}
                  title={
                    !canCreateNew && latest
                      ? "请先完成当前测验"
                      : undefined
                  }
                >
                  <Plus className="size-4" />
                  <span className="text-xs font-bold">新测验</span>
                </button>
              </div>

              {activeQuizId != null ? (
                <QuizRound
                  quizId={activeQuizId}
                  taskId={taskId}
                  onRequestNewQuiz={() => setDialogOpen(true)}
                />
              ) : null}
            </>
          )}
        </div>
      </div>

      <NewQuizDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        taskId={taskId}
        cost={extraGoldCost}
        isFree={isFree}
        goldBalance={goldBalance}
        onSuccess={handleSuccess}
      />
    </ContentCard>
  );
}
