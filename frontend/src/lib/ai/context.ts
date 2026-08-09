import { serverFetch } from "@/lib/api/client";
import {
  aiContextSchema,
  learningProfileSchema,
  knowledgeExplanationSchema,
  studyTaskSchema,
  taskChatContextSchema,
  type AiContext,
  type AiScope,
  type KnowledgeExplanation,
  type LearningProfile,
  type StudyTask,
  type TaskChatContext,
} from "@/lib/api/schemas";

export async function getAiContext(scope: AiScope): Promise<AiContext> {
  const profilePromise = serverFetch<LearningProfile>("/me/learning-profile", {
    schema: learningProfileSchema,
  });

  if (scope.type === "general") {
    return aiContextSchema.parse({
      scope,
      profile: await profilePromise,
      task: null,
    });
  }

  const [profile, task, chatContext] = await Promise.all([
    profilePromise,
    serverFetch<StudyTask>(`/study-tasks/${scope.task_id}`, { schema: studyTaskSchema }),
    serverFetch<TaskChatContext>(`/study-tasks/${scope.task_id}/chat-context`, {
      schema: taskChatContextSchema,
    }),
  ]);

  let pageContextExcerpt: string | null = null;
  if (task.knowledge_explanation_id != null) {
    try {
      const explanation = await serverFetch<KnowledgeExplanation>(
        `/knowledge-explanations/${task.knowledge_explanation_id}`,
        { schema: knowledgeExplanationSchema },
      );
      pageContextExcerpt = explanation.content?.trim().slice(0, 1500) || null;
    } catch {
      // 页面解析可能仍在生成，标题和任务描述已经足够建立最小上下文。
    }
  }

  return aiContextSchema.parse({
    scope,
    profile,
    task: {
      task_id: task.id,
      course_title: chatContext.course_title,
      stage_title: chatContext.stage_title,
      knowledge_point_title: chatContext.knowledge_point_title,
      knowledge_point_prompt: chatContext.knowledge_point_prompt,
      page_context_excerpt: pageContextExcerpt,
      suggested_questions: chatContext.suggested_questions,
      popular_questions: chatContext.popular_questions,
    },
  });
}
