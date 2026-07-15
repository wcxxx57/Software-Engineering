"use client";

import { Check, Lock } from "lucide-react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useSubjectStages } from "@/lib/query/study-stage";
import { cn } from "@/lib/utils";
import type {
  StudyStageDetail,
  StudySubject,
  StudyTaskBrief,
} from "@/lib/api/schemas";

const STAR_PATH =
  "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z";

export function JourneyTimeline({ subject }: { subject: StudySubject }) {
  const overallProgress =
    subject.total_stages > 0
      ? Math.round((subject.finished_stages / subject.total_stages) * 100)
      : 0;
  const stagesQuery = useSubjectStages(subject.id);
  const finished = subject.status === "FINISHED";

  return (
    <Card className="flex flex-col gap-6 rounded-3xl border border-border/30 bg-white/70 p-6 shadow-[var(--shadow-soft)] backdrop-blur-sm">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-lg font-bold text-brand-dark">
            {finished ? "已完成" : "学习中"}
          </h3>
          <span className="text-sm font-bold text-brand-medium">
            Day {subject.finished_stages}/{subject.total_stages}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-border/15">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-500",
              finished
                ? "bg-gradient-to-r from-palette-green to-palette-green-light"
                : "bg-gradient-to-r from-palette-orange to-palette-yellow",
            )}
            style={{ width: `${overallProgress}%` }}
          />
        </div>
      </div>

      {stagesQuery.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
        </div>
      ) : stagesQuery.isError ? (
        <p className="text-sm text-destructive">
          加载阶段失败：{stagesQuery.error.message}
        </p>
      ) : stagesQuery.data.length === 0 ? (
        <p className="text-sm text-brand-medium">暂无阶段。</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {stagesQuery.data.map((stage, idx) => (
            <StageRow
              key={stage.id}
              stage={stage}
              isLast={idx === stagesQuery.data.length - 1}
            />
          ))}
        </ol>
      )}
    </Card>
  );
}

function StageRow({
  stage,
  isLast,
}: {
  stage: StudyStageDetail;
  isLast: boolean;
}) {
  const stageProgress =
    stage.total_tasks > 0
      ? Math.round((stage.finished_tasks / stage.total_tasks) * 100)
      : 0;

  return (
    <li className="relative flex gap-4">
      <div className="relative flex w-20 flex-col items-center">
        <StarAnchor
          status={stage.status}
          sortOrder={stage.sort_order}
          progress={stageProgress / 100}
        />
        {!isLast && (
          <div
            className="my-1 w-0.5 flex-1 border-l-2 border-dashed border-border/40"
            aria-hidden
          />
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 pt-1 pb-6">
        <div className="flex flex-col gap-1">
          <span
            className={cn(
              "text-base font-bold",
              stage.status === "LOCKED"
                ? "text-brand-light"
                : "text-brand-dark",
            )}
          >
            {stage.title}
          </span>
          <span
            className="text-xs leading-relaxed text-brand-medium"
            style={{ whiteSpace: "pre-wrap" }}
          >
            {stage.description}
          </span>
        </div>

        {stage.tasks.length === 0 ? (
          <p className="text-xs text-brand-light">暂无任务。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {stage.tasks.map((task) => (
              <TaskPill key={task.id} task={task} />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function StarAnchor({
  status,
  sortOrder,
  progress,
}: {
  status: StudyStageDetail["status"];
  sortOrder: number;
  progress: number;
}) {
  const locked = status === "LOCKED";
  const finished = status === "FINISHED";
  // Studying 阶段按 progress 填充；finished 完全填充；locked 不填充
  const fillRatio = finished ? 1 : locked ? 0 : Math.max(0.08, progress);
  const clipId = `star-clip-${sortOrder}`;
  const gradientId = `star-grad-${sortOrder}`;

  return (
    <div className="relative size-20 select-none">
      <svg
        viewBox="0 0 24 24"
        className="absolute inset-0 size-full"
        aria-hidden
      >
        <defs>
          <clipPath id={clipId}>
            <path d={STAR_PATH} />
          </clipPath>
          <linearGradient id={gradientId} x1="0" y1="1" x2="0" y2="0">
            <stop
              offset="0%"
              stopColor={
                finished
                  ? "var(--palette-green-light)"
                  : "var(--palette-orange)"
              }
            />
            <stop
              offset="100%"
              stopColor={
                finished
                  ? "var(--palette-green)"
                  : "var(--palette-yellow)"
              }
            />
          </linearGradient>
        </defs>
        {/* 底色（locked 时显灰，否则浅暖色） */}
        <rect
          x="0"
          y="0"
          width="24"
          height="24"
          fill={
            locked
              ? "color-mix(in oklch, var(--color-border) 35%, transparent)"
              : "var(--palette-yellow-light)"
          }
          clipPath={`url(#${clipId})`}
        />
        {/* 进度填充：从底部上升 */}
        <rect
          x="0"
          y={24 - 24 * fillRatio}
          width="24"
          height={24 * fillRatio}
          fill={`url(#${gradientId})`}
          clipPath={`url(#${clipId})`}
          style={{ transition: "y 0.6s, height 0.6s" }}
        />
        {/* 描边 */}
        <path
          d={STAR_PATH}
          fill="none"
          stroke={
            locked
              ? "color-mix(in oklch, var(--color-border) 60%, transparent)"
              : "var(--palette-orange)"
          }
          strokeWidth="0.6"
          strokeLinejoin="round"
        />
      </svg>
      <div
        className={cn(
          "pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0",
          locked ? "text-brand-light" : "text-brand-dark",
        )}
      >
        {locked ? (
          <Lock className="size-6" />
        ) : finished ? (
          <Check className="size-7" strokeWidth={3} />
        ) : (
          <>
            <span className="text-[10px] font-bold tracking-widest opacity-60">
              DAY
            </span>
            <span className="text-xl font-black leading-none">
              {sortOrder}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function TaskPill({ task }: { task: StudyTaskBrief }) {
  const locked = task.status === "LOCKED";
  const finished = task.status === "FINISHED";

  const pillClass = cn(
    "flex w-full items-center gap-2 rounded-full border-2 px-4 py-2 text-sm font-semibold transition",
    "shadow-[0_1px_3px_color-mix(in_oklch,var(--color-border)_25%,transparent)]",
    finished &&
      "border-palette-blue-light/60 bg-palette-blue-mist/70 text-brand-dark",
    !finished &&
      !locked &&
      "border-palette-yellow/50 bg-white text-brand-dark hover:-translate-y-0.5 hover:border-palette-orange/70 hover:bg-palette-orange-lighter/30",
    locked &&
      "cursor-not-allowed border-transparent bg-border/20 text-brand-light",
  );

  const dotClass = cn(
    "flex size-4 shrink-0 items-center justify-center rounded-full border-2",
    finished && "border-palette-blue bg-palette-blue",
    !finished && !locked && "border-palette-orange",
    locked && "border-brand-light/50",
  );

  const label = (
    <>
      <span className={dotClass}>
        {finished && (
          <span className="size-1.5 rounded-full bg-canvas" />
        )}
      </span>
      <span>{task.title}</span>
    </>
  );

  if (locked) {
    return (
      <li>
        <span className={pillClass}>{label}</span>
      </li>
    );
  }
  return (
    <li>
      <Link href={`/tasks/${task.id}`} className={pillClass}>
        {label}
      </Link>
    </li>
  );
}
