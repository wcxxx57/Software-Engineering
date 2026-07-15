import { ArrowLeft, Bot, Check, Send } from "lucide-react";
import Link from "next/link";

import type { StudyStageDetail, StudyTask } from "@/lib/api/schemas";

export function TaskSidebar({
  task,
  stage,
}: {
  task: StudyTask;
  stage: StudyStageDetail | null;
}) {
  const finished = stage?.finished_tasks ?? 0;
  const total = stage?.total_tasks ?? 0;

  const upcoming = stage?.tasks
    .filter(
      (t) => t.sort_order > task.sort_order && t.status !== "FINISHED",
    )
    .sort((a, b) => a.sort_order - b.sort_order)[0];

  const nextLabel =
    stage == null ? "—" : upcoming ? upcoming.title : "本阶段已全部完成";

  const stageDone = stage?.status === "FINISHED";

  return (
    <aside className="flex w-[clamp(320px,30vw,450px)] flex-shrink-0 flex-col border-l-2 border-border-strong/15 bg-[color-mix(in_oklch,var(--bg-canvas)_60%,transparent)] backdrop-blur-xl">
      <SidebarTopSection
        finished={finished}
        total={total}
        nextLabel={nextLabel}
        stageDone={stageDone}
      />
      <AICompanion />
    </aside>
  );
}

function SidebarTopSection({
  finished,
  total,
  nextLabel,
  stageDone,
}: {
  finished: number;
  total: number;
  nextLabel: string;
  stageDone: boolean;
}) {
  return (
    <div className="relative flex-shrink-0 border-b border-dashed border-border-strong/30">
      <div
        aria-hidden
        className="absolute inset-0 z-0 overflow-hidden bg-gradient-to-br from-[color-mix(in_oklch,var(--palette-yellow-light)_30%,transparent)] to-[color-mix(in_oklch,var(--palette-orange-lighter)_30%,transparent)]"
      >
        <svg width="100%" height="100%" style={{ opacity: 0.5 }}>
          <defs>
            <pattern
              id="task-sidebar-dot-pattern"
              x="0"
              y="0"
              width="20"
              height="20"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="2" cy="2" r="1.5" fill="var(--brown-light)" />
            </pattern>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill="url(#task-sidebar-dot-pattern)"
          />
        </svg>
      </div>

      <div className="relative z-10 flex h-16 items-center px-6">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 rounded-full border border-white/80 bg-white/60 px-3.5 py-1.5 text-[13px] font-bold text-brand-dark shadow-[0_4px_12px_color-mix(in_oklch,var(--border-strong)_40%,transparent)] backdrop-blur-md transition-all duration-200 hover:-translate-y-px hover:bg-white/90 hover:text-brand-medium hover:shadow-[0_6px_16px_color-mix(in_oklch,var(--border-strong)_50%,transparent)]"
        >
          <ArrowLeft className="size-3.5" />
          返回主控台
        </Link>
      </div>

      <div className="relative z-10 px-5 pb-6 pt-2">
        <div className="rounded-[20px] border border-white/70 bg-white/55 p-5 shadow-[0_4px_12px_color-mix(in_oklch,var(--border-strong)_15%,transparent)] backdrop-blur-md">
          <h3 className="mb-5 text-[15px] font-extrabold uppercase tracking-[0.1em] text-brand-light">
            当前阶段进度
          </h3>
          <div className="flex items-center gap-5">
            <ProgressRing
              value={finished}
              total={total}
              showBadge={stageDone}
            />
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 text-[19px] font-extrabold text-brand-deep">
                下一节点
              </div>
              <div className="truncate text-sm text-brand-medium">
                {nextLabel}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProgressRing({
  value,
  total,
  showBadge,
}: {
  value: number;
  total: number;
  showBadge: boolean;
}) {
  const ratio = total <= 0 ? 0 : Math.max(0, Math.min(1, value / total));
  const dash = `${Math.round(ratio * 100)}, 100`;
  return (
    <div className="relative flex size-[76px] items-center justify-center rounded-full bg-canvas p-1 shadow-[0_4px_8px_color-mix(in_oklch,var(--border-strong)_20%,transparent)]">
      <svg viewBox="0 0 36 36" className="size-full -rotate-90">
        <path
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          fill="none"
          strokeWidth={3}
          className="stroke-border-strong/20"
        />
        <path
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          fill="none"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={dash}
          className="stroke-palette-orange [filter:drop-shadow(0_2px_4px_color-mix(in_oklch,var(--palette-orange)_40%,transparent))]"
        />
      </svg>
      <div className="absolute text-lg font-extrabold text-brand-dark">
        {value}/{total}
      </div>
      {showBadge && (
        <div className="absolute -bottom-0.5 -right-0.5 z-10 flex size-[22px] items-center justify-center rounded-full border-2 border-canvas bg-gradient-to-br from-palette-blue-lighter to-palette-blue-light text-white shadow-[0_2px_4px_color-mix(in_oklch,var(--palette-blue)_30%,transparent)]">
          <Check className="size-3" strokeWidth={3} />
        </div>
      )}
    </div>
  );
}

function AICompanion() {
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden p-5">
      <div className="mb-5 flex items-center gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-xl bg-[var(--chat-orange-surface)] text-brand-dark shadow-[0_4px_8px_color-mix(in_oklch,var(--palette-orange)_50%,transparent)]">
          <Bot className="size-[18px]" />
        </div>
        <h4 className="text-base font-extrabold text-brand-dark">AI 伴学</h4>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto pb-20">
        <div className="flex max-w-[85%] items-start gap-2.5">
          <div className="rounded-2xl rounded-bl-[4px] bg-palette-orange-lighter px-4 py-3 text-sm font-medium leading-relaxed text-brand-deep">
            嗨呀！这里是 AI 伴学功能预览，正在搭建中。👏
            <br />
            未来你可以在这里就当前学习内容向我提问。
          </div>
        </div>
        <div className="flex max-w-[85%] items-start gap-2.5 self-end">
          <div className="rounded-2xl rounded-br-[4px] bg-[var(--chat-yellow-surface)] px-4 py-3 text-sm font-medium leading-relaxed text-brand-deep">
            好的，期待上线～
          </div>
        </div>
      </div>

      <div className="absolute inset-x-5 bottom-5 flex h-14 items-center rounded-[20px] border-2 border-[color-mix(in_oklch,var(--palette-orange)_40%,transparent)] bg-[color-mix(in_oklch,var(--bg-canvas)_80%,transparent)] py-1 pl-5 pr-2 shadow-[0_8px_16px_color-mix(in_oklch,var(--border-strong)_15%,transparent),inset_0_2px_4px_rgba(255,255,255,0.8)] backdrop-blur-md">
        <input
          type="text"
          placeholder="AI 伴学功能开发中…"
          disabled
          className="flex-1 border-none bg-transparent text-sm font-medium text-brand-dark outline-none placeholder:text-brand-light disabled:cursor-not-allowed"
        />
        <button
          type="button"
          disabled
          aria-label="发送"
          className="flex size-10 items-center justify-center rounded-[14px] bg-[var(--chat-orange-accent)] text-brand-dark opacity-60 shadow-[0_2px_8px_color-mix(in_oklch,var(--palette-orange)_50%,transparent)] disabled:cursor-not-allowed"
        >
          <Send className="size-[18px]" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
