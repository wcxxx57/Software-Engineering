"use server";

import { revalidatePath } from "next/cache";

import { serverFetch } from "@/lib/api/client";
import {
  completeStudyTaskResponseSchema,
  createInteractiveHtmlResponseSchema,
  createKnowledgeExplanationResponseSchema,
  createKnowledgeVideoResponseSchema,
  createStudyQuizResponseSchema,
  type CreateInteractiveHtmlResponse,
  type CreateKnowledgeExplanationResponse,
  type CreateKnowledgeVideoResponse,
  type CreateStudyQuizResponse,
  type CompleteStudyTaskResponse,
} from "@/lib/api/schemas";
import { withApiError, type ActionResult } from "@/lib/server/action";

export type CreateKnowledgeVideoActionResult =
  ActionResult<CreateKnowledgeVideoResponse>;
export type CreateKnowledgeExplanationActionResult =
  ActionResult<CreateKnowledgeExplanationResponse>;
export type CreateInteractiveHtmlActionResult =
  ActionResult<CreateInteractiveHtmlResponse>;
export type CreateStudyQuizActionResult = ActionResult<CreateStudyQuizResponse>;
export type CompleteTaskActionResult = ActionResult<CompleteStudyTaskResponse>;

export async function createKnowledgeVideoAction(
  taskId: number,
): Promise<CreateKnowledgeVideoActionResult> {
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return { ok: false, message: "无效的任务" };
  }

  return withApiError(async () => {
    const data = await serverFetch<CreateKnowledgeVideoResponse>(
      `/study-tasks/${taskId}/knowledge-video`,
      {
        method: "POST",
        body: {},
        schema: createKnowledgeVideoResponseSchema,
      },
    );
    revalidatePath(`/tasks/${taskId}`);
    return data;
  });
}

export async function createKnowledgeExplanationAction(
  taskId: number,
): Promise<CreateKnowledgeExplanationActionResult> {
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return { ok: false, message: "无效的任务" };
  }

  return withApiError(async () => {
    const data = await serverFetch<CreateKnowledgeExplanationResponse>(
      `/study-tasks/${taskId}/explanation`,
      {
        method: "POST",
        body: {},
        schema: createKnowledgeExplanationResponseSchema,
      },
    );
    revalidatePath(`/tasks/${taskId}`);
    return data;
  });
}

export async function createInteractiveHtmlAction(
  taskId: number,
): Promise<CreateInteractiveHtmlActionResult> {
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return { ok: false, message: "无效的任务" };
  }

  return withApiError(async () => {
    const data = await serverFetch<CreateInteractiveHtmlResponse>(
      `/study-tasks/${taskId}/interactive-html`,
      {
        method: "POST",
        body: {},
        schema: createInteractiveHtmlResponseSchema,
      },
    );
    revalidatePath(`/tasks/${taskId}`);
    return data;
  });
}

export async function createStudyQuizAction(
  taskId: number,
): Promise<CreateStudyQuizActionResult> {
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return { ok: false, message: "无效的任务" };
  }

  return withApiError(async () => {
    const data = await serverFetch<CreateStudyQuizResponse>(
      `/study-tasks/${taskId}/quizzes`,
      {
        method: "POST",
        body: {},
        schema: createStudyQuizResponseSchema,
      },
    );
    revalidatePath(`/tasks/${taskId}`);
    return data;
  });
}

export async function completeTaskAction(
  taskId: number,
): Promise<CompleteTaskActionResult> {
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return { ok: false, message: "无效的任务" };
  }
  return withApiError(async () => {
    const data = await serverFetch<CompleteStudyTaskResponse>(
      `/study-tasks/${taskId}/complete`,
      {
        method: "POST",
        body: {},
        schema: completeStudyTaskResponseSchema,
      },
    );
    revalidatePath(`/tasks/${taskId}`);
    revalidatePath("/dashboard");
    return data;
  });
}
