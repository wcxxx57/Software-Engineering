"use client";

import { ArrowLeft, Check } from "lucide-react";
import Link from "next/link";

import { AiChatLauncher } from "@/components/ai/ai-chat-launcher";
import { AiChatPanel } from "@/components/panels/ai-chat-panel";
import { buildPreviewAiContext } from "@/lib/ai/preview-context";
import type { StudyStageDetail, StudyTask, TaskChatContext } from "@/lib/api/schemas";

export function TaskSidebar({ task, stage, previewChatContext }: { task: StudyTask; stage: StudyStageDetail | null; previewChatContext?: TaskChatContext }) {
  const finished = stage?.finished_tasks ?? 0;
  const total = stage?.total_tasks ?? 0;
  const upcoming = stage?.tasks.filter((item) => item.sort_order > task.sort_order && item.status !== "FINISHED").sort((a, b) => a.sort_order - b.sort_order)[0];

  return (
    <aside className="flex w-full shrink-0 flex-col border-t-2 border-border-strong/15 bg-[color-mix(in_oklch,var(--bg-canvas)_60%,transparent)] backdrop-blur-xl lg:w-[clamp(320px,30vw,450px)] lg:border-l-2 lg:border-t-0">
      <div className="relative shrink-0 border-b border-dashed border-border-strong/30 bg-gradient-to-br from-palette-yellow-light/30 to-palette-orange-lighter/30 px-5 pb-6 pt-4">
        <Link href="/dashboard" className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-white/80 bg-white/60 px-3.5 py-1.5 text-[13px] font-bold text-brand-dark shadow-[0_4px_12px_color-mix(in_oklch,var(--border-strong)_40%,transparent)] backdrop-blur-md transition hover:bg-white/90"><ArrowLeft className="size-3.5" />返回主控台</Link>
        <div className="rounded-[20px] border border-white/70 bg-white/55 p-5 shadow-[0_4px_12px_color-mix(in_oklch,var(--border-strong)_15%,transparent)] backdrop-blur-md">
          <h3 className="mb-4 text-[15px] font-extrabold tracking-[0.1em] text-brand-light">当前阶段进度</h3>
          <div className="flex items-center gap-4">
            <ProgressRing value={finished} total={total} done={stage?.status === "FINISHED"} />
            <div className="min-w-0"><p className="text-base font-extrabold text-brand-deep">下一节点</p><p className="mt-1 truncate text-sm text-brand-medium">{upcoming?.title ?? "本阶段已全部完成"}</p></div>
          </div>
        </div>
      </div>
      <AICompanion taskId={task.id} previewChatContext={previewChatContext} />
    </aside>
  );
}

function ProgressRing({ value, total, done }: { value: number; total: number; done: boolean }) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
  return (
    <div className="relative flex size-[76px] shrink-0 items-center justify-center rounded-full bg-canvas p-1 shadow-[0_4px_8px_color-mix(in_oklch,var(--border-strong)_20%,transparent)]">
      <svg viewBox="0 0 36 36" className="size-full -rotate-90"><path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" strokeWidth={3} className="stroke-border-strong/20"/><path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" strokeWidth={3} strokeLinecap="round" strokeDasharray={`${Math.round(ratio * 100)}, 100`} className="stroke-palette-orange"/></svg>
      <span className="absolute text-lg font-extrabold text-brand-dark">{value}/{total}</span>
      {done ? <span className="absolute -bottom-0.5 -right-0.5 flex size-[22px] items-center justify-center rounded-full border-2 border-canvas bg-palette-blue text-white"><Check className="size-3" strokeWidth={3} /></span> : null}
    </div>
  );
}

function AICompanion({ taskId, previewChatContext }: { taskId: number; previewChatContext?: TaskChatContext }) {
  const previewContext = previewChatContext ? buildPreviewAiContext(taskId, previewChatContext) : undefined;
  return (
    <>
      <div className="hidden min-h-0 flex-1 flex-col lg:flex">
        <AiChatPanel taskId={taskId} previewContext={previewContext} className="min-h-[440px] flex-1 rounded-none border-0 bg-transparent shadow-none" />
      </div>
      <AiChatLauncher taskId={taskId} previewContext={previewContext} className="lg:hidden" />
    </>
  );
}
