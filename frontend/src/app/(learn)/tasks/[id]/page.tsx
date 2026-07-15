import { BookOpen, Loader2 } from "lucide-react";
import { redirect } from "next/navigation";

import { ContentCard } from "@/components/learn/content-card";
import { ExplanationViewer } from "@/components/learn/explanation-viewer";
import { InteractiveHtmlViewer } from "@/components/learn/interactive-html-viewer";
import { MarkmapCard } from "@/components/learn/markmap-card";
import { QuizSection } from "@/components/learn/quiz-section";
import { ResourceGenerateCard } from "@/components/learn/resource-generate-card";
import { TaskCompleteCard } from "@/components/learn/task-complete-card";
import { TaskSidebar } from "@/components/learn/task-sidebar";
import { VideoViewer } from "@/components/learn/video-viewer";
import { serverFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { getPublicConfig } from "@/lib/api/public-config";
import {
  studyStageDetailSchema,
  studyTaskSchema,
  type StudyStageDetail,
  type StudyTask,
} from "@/lib/api/schemas";

export default async function TaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const taskId = Number(id);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    redirect("/dashboard");
  }

  let task: StudyTask;
  try {
    task = await serverFetch<StudyTask>(`/study-tasks/${taskId}`, {
      schema: studyTaskSchema,
    });
  } catch (err) {
    if (err instanceof ApiError) {
      redirect("/dashboard");
    }
    throw err;
  }

  let stage: StudyStageDetail | null = null;
  try {
    stage = await serverFetch<StudyStageDetail>(
      `/study-stages/${task.study_stage_id}`,
      { schema: studyStageDetailSchema },
    );
  } catch {
    stage = null;
  }

  const config = await getPublicConfig();

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-canvas">
      <main className="flex flex-1 flex-col gap-10 overflow-y-auto px-8 py-10 sm:px-16 sm:py-14 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-border-muted [&::-webkit-scrollbar-thumb:hover]:bg-border-strong [&::-webkit-scrollbar-track]:bg-transparent">
        <header className="flex flex-col gap-3">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-xl bg-gradient-to-br from-palette-yellow-light to-palette-orange-light px-[18px] py-1.5 text-sm font-extrabold tracking-wide text-brand-deep shadow-[0_4px_12px_color-mix(in_oklch,var(--palette-orange)_30%,transparent)]">
            <BookOpen className="size-4" strokeWidth={2.2} />
            <span>学习任务</span>
          </span>
          <h1 className="bg-gradient-to-br from-brand-dark to-palette-orange bg-clip-text text-4xl font-black leading-tight tracking-tight text-transparent sm:text-5xl [text-shadow:0_4px_12px_color-mix(in_oklch,var(--brand-gold)_20%,transparent)]">
            {task.title}
          </h1>
          <p
            className="max-w-[720px] text-base font-medium leading-[1.7] text-brand-medium"
            style={{ whiteSpace: "pre-wrap" }}
          >
            {task.description}
          </p>
        </header>

        {task.knowledge_explanation_id != null ? (
          <>
            <MarkmapCard id={task.knowledge_explanation_id} />
            <ExplanationViewer id={task.knowledge_explanation_id} />
          </>
        ) : (
          <ExplanationPendingCard />
        )}

        {task.knowledge_video_id != null ? (
          <VideoViewer source={{ kind: "task", taskId: task.id }} />
        ) : (
          <ResourceGenerateCard
            taskId={task.id}
            taskStatus={task.status}
            kind="knowledge-video"
          />
        )}

        {task.interactive_html_id != null ? (
          <InteractiveHtmlViewer source={{ kind: "task", taskId: task.id }} />
        ) : (
          <ResourceGenerateCard
            taskId={task.id}
            taskStatus={task.status}
            kind="interactive-html"
          />
        )}

        <QuizSection
          taskId={task.id}
          taskStatus={task.status}
          freeLimit={config.resource.study_quiz_free_limit_per_task}
          extraGoldCost={config.resource.study_quiz_extra_gold_cost}
        />

        <TaskCompleteCard
          taskId={task.id}
          taskStatus={task.status}
          nextTaskId={
            stage?.tasks
              .filter((t) => t.sort_order > task.sort_order)
              .sort((a, b) => a.sort_order - b.sort_order)[0]?.id ?? null
          }
        />
      </main>

      <TaskSidebar task={task} stage={stage} />
    </div>
  );
}

function ExplanationPendingCard() {
  return (
    <ContentCard
      theme="purple"
      icon={<Loader2 className="animate-spin" />}
      title="深度解析"
      subtitle="文字化讲解"
    >
      <div className="rounded-2xl border border-dashed border-[color-mix(in_oklch,var(--palette-purple)_30%,transparent)] bg-white/50 px-6 py-10 text-center">
        <p className="text-sm font-bold text-brand-dark">讲稿正在生成中…</p>
        <p className="mt-2 text-xs leading-relaxed text-brand-medium">
          创建学习主题时已为本任务自动派发讲稿生成，请稍候片刻刷新查看。
        </p>
      </div>
    </ContentCard>
  );
}
