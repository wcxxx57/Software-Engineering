"use client";

import { useTransition } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Coins,
  Gift,
  NotebookPen,
  Rocket,
} from "lucide-react";
import { toast } from "sonner";

import { createStudyQuizAction } from "@/app/(learn)/tasks/[id]/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function NewQuizDialog({
  open,
  onOpenChange,
  taskId,
  cost,
  isFree,
  goldBalance,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: number;
  cost: number;
  isFree: boolean;
  goldBalance: number;
  onSuccess: (quizId: number) => void;
}) {
  const [isPending, startTransition] = useTransition();

  const after = goldBalance - (isFree ? 0 : cost);
  const insufficient = !isFree && after < 0;
  const submitDisabled = isPending || insufficient;

  function handleConfirm() {
    if (submitDisabled) return;
    startTransition(async () => {
      const result = await createStudyQuizAction(taskId);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(
        isFree ? "已加入生成队列，请稍候" : "已扣费并加入生成队列，请稍候",
      );
      onOpenChange(false);
      onSuccess(result.data.quiz_id);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader className="items-center text-center">
          <div className="mb-3 flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-palette-yellow-light to-palette-orange-lighter shadow-[0_4px_12px_color-mix(in_oklch,var(--palette-orange)_20%,transparent)]">
            <NotebookPen
              className="size-8 stroke-palette-orange"
              strokeWidth={1.8}
            />
          </div>
          <DialogTitle className="text-lg font-extrabold text-brand-dark">
            生成新一轮知识点测验
          </DialogTitle>
          <DialogDescription className="text-sm text-brand-medium">
            AI 将基于本任务知识点出一组单选题
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {isFree ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl bg-palette-green-lighter px-5 py-3 text-sm font-semibold text-brand-dark">
              <Gift className="size-5 stroke-palette-green" strokeWidth={2} />
              <span>本轮免费</span>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-center gap-2 rounded-2xl bg-palette-yellow-light px-5 py-3">
                <Coins className="size-5 stroke-palette-orange" strokeWidth={2.2} />
                <span className="text-2xl font-black text-palette-orange">
                  -{cost}
                </span>
                <span className="text-sm font-semibold text-brand-medium">
                  金币消耗
                </span>
              </div>
              <div
                className={`flex items-center justify-center gap-2 rounded-2xl bg-palette-yellow-light/60 px-4 py-2 text-sm font-semibold ${
                  insufficient ? "text-destructive" : "text-brand-dark"
                }`}
              >
                <span>操作后余额</span>
                <ArrowRight className="size-3.5" strokeWidth={2.4} />
                <Coins className="size-3.5 stroke-palette-orange" strokeWidth={2.2} />
                <span className="text-base font-black">{after}</span>
              </div>
              {insufficient ? (
                <div className="inline-flex items-center justify-center gap-1 rounded-2xl bg-danger-surface px-4 py-2 text-center text-xs font-semibold text-destructive">
                  <AlertTriangle className="size-3.5" strokeWidth={2.4} />
                  余额不足，还差 {Math.abs(after)} 金币
                </div>
              ) : null}
              <div className="rounded-2xl bg-palette-green-lighter px-4 py-2 text-center text-xs font-semibold text-brand-dark">
                若生成失败，系统会自动退还消耗
              </div>
            </>
          )}
        </div>

        <DialogFooter className="sm:justify-center">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            取消
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={submitDisabled}
            className="bg-gradient-to-br from-palette-yellow to-palette-orange font-bold text-brand-dark hover:opacity-90"
          >
            {isPending ? (
              "处理中…"
            ) : isFree ? (
              <>
                <Rocket className="size-4" strokeWidth={2.2} />
                开始测验
              </>
            ) : (
              <>
                <Coins className="size-4" strokeWidth={2.2} />
                确认消耗
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
