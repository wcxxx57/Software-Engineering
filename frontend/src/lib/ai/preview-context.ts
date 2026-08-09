import type { AiContext, TaskChatContext } from "@/lib/api/schemas";

/**
 * The iteration-4 preview uses a synthetic task instead of a row in the
 * backend database. Keep its learning profile and task context in one shared
 * builder so the compact drawer and the full-screen preview cannot drift.
 */
export function buildPreviewAiContext(taskId: number, chat: TaskChatContext): AiContext {
  return {
    is_preview: true,
    scope: { type: "task", task_id: taskId },
    profile: {
      user_id: 0,
      username: "预览学习者",
      age_band: null,
      introduction: "",
      level: 1,
      experience_points: 100,
      total_checkins: 0,
      streak_checkins: 0,
      active_subject: {
        id: 0,
        subject: chat.course_title,
        language: "PYTHON",
        target: "掌握当前课程知识点",
        total_stages: 1,
        finished_stages: 0,
        total_tasks: 1,
        finished_tasks: 0,
        progress_percent: 0,
        current_stage_title: chat.stage_title,
        current_task_title: chat.knowledge_point_title,
        quiz_total_problems: 0,
        quiz_correct_problems: 0,
        quiz_accuracy_percent: null,
        weak_points: [],
      },
    },
    task: {
      task_id: taskId,
      course_title: chat.course_title,
      stage_title: chat.stage_title,
      knowledge_point_title: chat.knowledge_point_title,
      knowledge_point_prompt: chat.knowledge_point_prompt,
      page_context_excerpt: null,
      suggested_questions: chat.suggested_questions,
      popular_questions: chat.popular_questions,
    },
  };
}
