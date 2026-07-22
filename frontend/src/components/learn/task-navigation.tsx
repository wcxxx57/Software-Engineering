import { ArrowLeft, ArrowRight, LockKeyhole } from "lucide-react";
import Link from "next/link";

import type { StudyTaskBrief } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

export function TaskNavigation({
  previous,
  next,
}: {
  previous: StudyTaskBrief | null;
  next: StudyTaskBrief | null;
}) {
  return (
    <nav aria-label="学习任务切换" className="grid gap-4 sm:grid-cols-2">
      <TaskLink direction="previous" task={previous} />
      <TaskLink direction="next" task={next} />
    </nav>
  );
}

function TaskLink({
  direction,
  task,
}: {
  direction: "previous" | "next";
  task: StudyTaskBrief | null;
}) {
  const isPrevious = direction === "previous";
  const locked = task?.status === "LOCKED";
  const label = isPrevious ? "上一个学习任务" : "下一个学习任务";
  const content = (
    <>
      {isPrevious ? <ArrowLeft className="size-5 shrink-0" /> : null}
      <span className={cn("min-w-0 flex-1", !isPrevious && "text-right")}>
        <span className="block text-xs font-bold text-brand-light">{label}</span>
        <span className="mt-1 block truncate text-sm font-extrabold text-brand-dark">
          {task?.title ?? (isPrevious ? "已经是第一个任务" : "已经是最后一个任务")}
        </span>
        {locked ? (
          <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-light">
            <LockKeyhole className="size-3" /> 完成当前任务后解锁
          </span>
        ) : null}
      </span>
      {!isPrevious ? <ArrowRight className="size-5 shrink-0" /> : null}
    </>
  );
  const className = cn(
    "flex min-h-20 items-center gap-3 rounded-2xl border border-white/70 bg-white/60 px-5 py-4 shadow-[0_4px_14px_color-mix(in_oklch,var(--border-muted)_18%,transparent)] backdrop-blur-md transition",
    task && !locked
      ? "hover:-translate-y-0.5 hover:bg-palette-yellow-mist hover:shadow-[0_8px_20px_color-mix(in_oklch,var(--border-muted)_24%,transparent)]"
      : "cursor-not-allowed opacity-55",
  );

  if (!task || locked) {
    return <div className={className}>{content}</div>;
  }

  return (
    <Link href={`/tasks/${task.id}`} className={className}>
      {content}
    </Link>
  );
}
