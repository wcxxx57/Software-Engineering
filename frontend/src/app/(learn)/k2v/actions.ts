"use server";

import { revalidatePath } from "next/cache";

import { serverFetch } from "@/lib/api/client";
import {
  knowledgeVideoSchema,
  type KnowledgeVideo,
} from "@/lib/api/schemas";
import { withApiError, type ActionResult } from "@/lib/server/action";

export type CreateK2VActionResult = ActionResult<KnowledgeVideo>;
export type DeleteToolResourceActionResult = ActionResult;

function validatePrompt(prompt: string): string | null {
  const trimmed = prompt.trim();
  if (trimmed.length < 1) return "请填写生成提示词";
  if (trimmed.length > 4000) return "提示词不可超过 4000 字";
  return null;
}

export async function createK2VAction(
  prompt: string,
): Promise<CreateK2VActionResult> {
  const err = validatePrompt(prompt);
  if (err) return { ok: false, message: err };

  return withApiError(async () => {
    const data = await serverFetch<KnowledgeVideo>("/knowledge-videos", {
      method: "POST",
      body: { prompt: prompt.trim() },
      schema: knowledgeVideoSchema,
    });
    revalidatePath("/k2v");
    return data;
  });
}

export async function deleteK2VAction(
  id: number,
): Promise<DeleteToolResourceActionResult> {
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, message: "无效的资源" };
  }
  return withApiError(async () => {
    await serverFetch(`/knowledge-videos/${id}`, { method: "DELETE" });
    revalidatePath("/k2v");
  });
}
