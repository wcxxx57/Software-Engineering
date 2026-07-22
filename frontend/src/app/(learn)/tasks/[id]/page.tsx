import { BookOpen } from "lucide-react";
import { redirect } from "next/navigation";

import { ExplanationGenerateCard } from "@/components/learn/explanation-generate-card";
import { ExplanationViewer } from "@/components/learn/explanation-viewer";
import { MarkmapCard } from "@/components/learn/markmap-card";
import { QuizSection } from "@/components/learn/quiz-section";
import { TaskCompleteCard } from "@/components/learn/task-complete-card";
import { TaskNavigation } from "@/components/learn/task-navigation";
import { TaskSectionNav } from "@/components/learn/task-section-nav";
import { TaskSidebar } from "@/components/learn/task-sidebar";
import { serverFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { getPublicConfig } from "@/lib/api/public-config";
import {
  studyStageDetailSchema,
  studyStageListSchema,
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
  const coreFlowOnly = process.env.CORE_FLOW_ONLY === "true";
  let subjectStages: StudyStageDetail[] = stage ? [stage] : [];
  if (stage) {
    try {
      subjectStages = await serverFetch<StudyStageDetail[]>(
        `/study-subjects/${stage.study_subject_id}/stages`,
        { schema: studyStageListSchema },
      );
    } catch {
      subjectStages = [stage];
    }
  }

  const orderedTasks = subjectStages
    .sort((a, b) => a.sort_order - b.sort_order)
    .flatMap((item) =>
      [...item.tasks].sort((a, b) => a.sort_order - b.sort_order),
    );
  const taskIndex = orderedTasks.findIndex((item) => item.id === task.id);
  const previousTask = taskIndex > 0 ? orderedTasks[taskIndex - 1] : null;
  const nextTask =
    taskIndex >= 0 && taskIndex < orderedTasks.length - 1
      ? orderedTasks[taskIndex + 1]
      : null;

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-canvas">
      <main className="flex flex-1 flex-col gap-10 overflow-y-auto px-8 py-10 sm:px-16 sm:py-14 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-border-muted [&::-webkit-scrollbar-thumb:hover]:bg-border-strong [&::-webkit-scrollbar-track]:bg-transparent">
        <header id="task-top" className="scroll-mt-8 flex flex-col gap-3">
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

        <TaskNavigation previous={previousTask} next={nextTask} />
        <TaskSectionNav
          extended={!coreFlowOnly}
          hasKnowledgeMap={task.knowledge_explanation_id != null}
        />

        {task.knowledge_explanation_id != null ? (
          <>
            <div id="knowledge-map" className="scroll-mt-24">
              <MarkmapCard id={task.knowledge_explanation_id} />
            </div>
            <div id="explanation" className="scroll-mt-24">
              <ExplanationViewer
                id={task.knowledge_explanation_id}
                taskId={task.id}
              />
            </div>
          </>
        ) : (
          <div id="explanation" className="scroll-mt-24">
            <ExplanationGenerateCard
              taskId={task.id}
              taskStatus={task.status}
            />
          </div>
        )}

        {!coreFlowOnly ? <ExtendedLearningResources task={task} /> : null}

        <div id="quiz" className="scroll-mt-24">
          <QuizSection
            taskId={task.id}
            taskStatus={task.status}
            freeLimit={config.resource.study_quiz_free_limit_per_task}
            extraGoldCost={config.resource.study_quiz_extra_gold_cost}
          />
        </div>

        <div id="complete" className="scroll-mt-24">
          <TaskCompleteCard
            taskId={task.id}
            taskStatus={task.status}
            nextTaskId={nextTask?.id ?? null}
          />
        </div>

        <TaskNavigation previous={previousTask} next={nextTask} />
      </main>

      <TaskSidebar task={task} stage={stage} />
    </div>
  );
}

async function ExtendedLearningResources({ task }: { task: StudyTask }) {
  const [
    { InteractiveHtmlViewer },
    { ResourceGenerateCard },
    { VideoViewer },
  ] = await Promise.all([
    import("@/components/learn/interactive-html-viewer"),
    import("@/components/learn/resource-generate-card"),
    import("@/components/learn/video-viewer"),
  ]);

  return (
    <>
      <div id="knowledge-video" className="scroll-mt-24">
        {task.knowledge_video_id != null ? (
          <VideoViewer source={{ kind: "task", taskId: task.id }} />
        ) : (
          <ResourceGenerateCard
            taskId={task.id}
            taskStatus={task.status}
            kind="knowledge-video"
          />
        )}
      </div>
      <div id="interactive-html" className="scroll-mt-24">
        {task.interactive_html_id != null ? (
          <InteractiveHtmlViewer
            source={{ kind: "task", taskId: task.id }}
            title="2D 可视化操作"
            subtitle="播放步骤、缩放画布并用自然语言调整图形"
          />
        ) : (
          <ResourceGenerateCard
            taskId={task.id}
            taskStatus={task.status}
            kind="interactive-html"
          />
        )}
      </div>
    </>
  );
}
