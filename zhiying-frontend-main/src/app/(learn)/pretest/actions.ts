"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { serverFetch } from "@/lib/api/client";
import { ApiError, ApiSchemaError, humanizeApiError } from "@/lib/api/errors";
import {
  problemAnswer,
  pretestConfidence,
  type PretestProblem,
} from "@/lib/api/schemas";
import { withApiError, type ActionResult } from "@/lib/server/action";

export type SavePretestAnswerActionResult = ActionResult;

export async function savePretestAnswerAction(
  subjectId: number,
  pretestProblemId: number,
  input: {
    chosen_answer: PretestProblem["chosen_answer"];
    confidence: PretestProblem["confidence"];
  },
): Promise<SavePretestAnswerActionResult> {
  if (!Number.isInteger(subjectId) || subjectId <= 0) {
    return { ok: false, message: "无效的学习主题" };
  }
  if (!Number.isInteger(pretestProblemId) || pretestProblemId <= 0) {
    return { ok: false, message: "无效的题目" };
  }
  const answer = problemAnswer.nullable().safeParse(input.chosen_answer);
  const confidence = pretestConfidence.nullable().safeParse(input.confidence);
  if (!answer.success || !confidence.success) {
    return { ok: false, message: "请选择答案与把握程度" };
  }

  return withApiError(async () => {
    await serverFetch(
      `/study-subjects/${subjectId}/pretest/${pretestProblemId}`,
      {
        method: "PATCH",
        body: {
          chosen_answer: answer.data,
          confidence: confidence.data,
        },
      },
    );
  });
}

export type SubmitPretestActionResult = { ok: false; message: string };

export async function submitPretestAction(
  subjectId: number,
): Promise<SubmitPretestActionResult> {
  if (!Number.isInteger(subjectId) || subjectId <= 0) {
    return { ok: false, message: "无效的学习主题" };
  }
  try {
    await serverFetch(`/study-subjects/${subjectId}/plan`, {
      method: "POST",
      body: {},
    });
  } catch (err) {
    if (err instanceof ApiError || err instanceof ApiSchemaError) {
      return { ok: false, message: humanizeApiError(err) };
    }
    throw err;
  }
  revalidatePath("/dashboard");
  redirect("/dashboard");
}
