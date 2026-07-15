"use client";

import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { completeTaskAction } from "@/app/(learn)/tasks/[id]/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useStudyTaskQuizzes } from "@/lib/query/study-quiz";
import type { StudyTaskStatus } from "@/lib/api/schemas";

import { ContentCard } from "./content-card";

const CONSOLIDATION_THRESHOLD = 60;

export function TaskCompleteCard({
  taskId,
  taskStatus,
  nextTaskId,
}: {
  taskId: number;
  taskStatus: StudyTaskStatus;
  nextTaskId: number | null;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const finished = taskStatus === "FINISHED";
  const locked = taskStatus === "LOCKED";

  const { data: quizzes = [] } = useStudyTaskQuizzes(taskId);
  const submittedScores = quizzes
    .filter((q) => q.status === "SUBMITTED" && q.total_problems > 0)
    .map((q) => Math.round((q.correct_problems / q.total_problems) * 100));
  const hasSubmittedQuiz = submittedScores.length > 0;
  const bestScore = hasSubmittedQuiz ? Math.max(...submittedScores) : 0;
  const needConsolidation =
    !finished && !locked && bestScore < CONSOLIDATION_THRESHOLD;

  const onConfirmComplete = () => {
    startTransition(async () => {
      const result = await completeTaskAction(taskId);
      if (result.ok) {
        toast.success("已记录学习进度，继续加油!");
        setConfirmOpen(false);
      } else {
        toast.error(result.message);
        setConfirmOpen(false);
      }
    });
  };

  const ctaClassName =
    "inline-flex items-center justify-center gap-1 rounded-4xl bg-gradient-to-br from-palette-yellow to-palette-orange px-7 py-2 text-base font-bold text-brand-dark shadow-[0_4px_16px_color-mix(in_oklch,var(--palette-orange)_35%,transparent)] hover:opacity-90";

  return (
    <ContentCard
      theme="yellow"
      icon={<CheckCircle2 />}
      title="学完打卡"
      subtitle="完成本任务并解锁下一节"
    >
      <div className="relative overflow-hidden rounded-2xl border border-[color-mix(in_oklch,var(--palette-yellow-light)_50%,transparent)] bg-gradient-to-br from-palette-yellow-light/40 to-palette-orange-lighter/40 shadow-[inset_0_2px_8px_rgba(0,0,0,0.05)]">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.4)_0%,transparent_60%)]"
        />
        <div className="relative flex flex-col items-center gap-4 px-6 py-10 text-center">
          <CheckCircle2
            className="size-14 stroke-brand-gold [filter:drop-shadow(0_4px_12px_color-mix(in_oklch,var(--palette-orange)_30%,transparent))]"
            strokeWidth={1.6}
          />
          <p className="text-sm font-bold text-brand-medium">
            {finished
              ? nextTaskId != null
                ? "本任务已完成，下一节已解锁"
                : "本阶段已学完，回到主控台继续学习之旅"
              : "看完所有内容后，点击下方按钮完成本任务"}
          </p>
          {finished ? (
            nextTaskId != null ? (
              <Link href={`/tasks/${nextTaskId}`} className={ctaClassName}>
                前往下一个任务
                <ArrowRight className="ml-1 size-4" />
              </Link>
            ) : (
              <Link href="/dashboard" className={ctaClassName}>
                返回主控台
                <ArrowRight className="ml-1 size-4" />
              </Link>
            )
          ) : (
            <Button
              type="button"
              disabled={locked || isPending}
              onClick={() => setConfirmOpen(true)}
              className="bg-gradient-to-br from-palette-yellow to-palette-orange px-7 py-2 text-base font-bold text-brand-dark shadow-[0_4px_16px_color-mix(in_oklch,var(--palette-orange)_35%,transparent)] hover:opacity-90 disabled:opacity-60"
            >
              {locked ? "请先完成前置任务" : "我已学完，完成本任务"}
            </Button>
          )}
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {needConsolidation ? "建议先巩固一下" : "完成本任务?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {needConsolidation
                ? hasSubmittedQuiz
                  ? `你的小测最高分仅为 ${bestScore} 分，建议再做一次测验或回看资料巩固掌握度，再标记完成。`
                  : "你还没有完成过本任务的小测。建议先做一次测验检验掌握度，再标记完成。"
                : "完成后将解锁下一任务，无法撤回。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {needConsolidation ? (
            <div className="flex items-start gap-2 rounded-2xl border border-palette-orange/30 bg-palette-orange-lighter/40 px-3 py-2 text-xs font-semibold text-brand-dark">
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0 stroke-palette-orange"
                strokeWidth={2.4}
              />
              <span>
                标记完成后将解锁下一任务且无法撤回。强制完成可能影响后续学习效果。
              </span>
            </div>
          ) : null}
          {needConsolidation ? (
            <AlertDialogFooter>
              <AlertDialogAction
                onClick={onConfirmComplete}
                disabled={isPending}
                variant="outline"
                className="text-destructive hover:bg-destructive/5 hover:text-destructive"
              >
                {isPending ? "处理中…" : "仍要强制完成"}
              </AlertDialogAction>
              <AlertDialogCancel
                disabled={isPending}
                className="bg-gradient-to-br from-palette-yellow to-palette-orange font-bold text-brand-dark hover:opacity-90"
              >
                继续巩固
              </AlertDialogCancel>
            </AlertDialogFooter>
          ) : (
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isPending}>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={onConfirmComplete}
                disabled={isPending}
                className="bg-gradient-to-br from-palette-yellow to-palette-orange font-bold text-brand-dark hover:opacity-90"
              >
                {isPending ? "处理中…" : "确认完成"}
              </AlertDialogAction>
            </AlertDialogFooter>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </ContentCard>
  );
}
