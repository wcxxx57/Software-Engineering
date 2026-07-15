"use client";

import { BookOpenText, Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { createKnowledgeExplanationAction } from "@/app/(learn)/tasks/[id]/actions";
import { Button } from "@/components/ui/button";
import type { StudyTaskStatus } from "@/lib/api/schemas";

import { ContentCard } from "./content-card";

export function ExplanationGenerateCard({
  taskId,
  taskStatus,
}: {
  taskId: number;
  taskStatus: StudyTaskStatus;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const locked = taskStatus === "LOCKED";

  const generate = () => {
    startTransition(async () => {
      const result = await createKnowledgeExplanationAction(taskId);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      toast.success("深度解析已加入生成队列");
      router.refresh();
    });
  };

  return (
    <ContentCard
      theme="purple"
      icon={<BookOpenText />}
      title="深度解析"
      subtitle="文字化讲解与知识导图"
    >
      <div className="relative overflow-hidden rounded-2xl border border-[color-mix(in_oklch,var(--palette-purple)_30%,transparent)] bg-white/60 px-6 py-10 text-center">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,color-mix(in_oklch,var(--palette-purple-light)_22%,transparent)_0%,transparent_62%)]"
        />
        <div className="relative flex flex-col items-center gap-4">
          <Sparkles
            className="size-12 text-palette-purple [filter:drop-shadow(0_4px_12px_color-mix(in_oklch,var(--palette-purple)_28%,transparent))]"
            strokeWidth={1.7}
          />
          <div>
            <p className="text-base font-extrabold text-brand-dark">
              深度解析尚未生成
            </p>
            <p className="mt-2 max-w-xl text-sm font-medium leading-relaxed text-brand-medium">
              将根据当前知识点生成结构化讲解、示例、常见误区、练习建议和知识导图。
            </p>
          </div>
          <Button
            type="button"
            disabled={locked || isPending}
            onClick={generate}
            className="inline-flex min-w-36 items-center justify-center gap-2 bg-gradient-to-br from-palette-purple to-palette-purple-dark px-7 py-2 font-bold text-white shadow-[0_4px_16px_color-mix(in_oklch,var(--palette-purple)_30%,transparent)] hover:opacity-90"
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                正在提交
              </>
            ) : locked ? (
              "请先完成前置任务"
            ) : (
              "生成深度解析"
            )}
          </Button>
        </div>
      </div>
    </ContentCard>
  );
}
