"use server";

import { revalidatePath } from "next/cache";

import { serverFetch } from "@/lib/api/client";
import {
  interactiveHtmlSchema,
  type InteractiveHtml,
} from "@/lib/api/schemas";
import { withApiError, type ActionResult } from "@/lib/server/action";

export type CreateInteractiveActionResult = ActionResult<InteractiveHtml>;
export type DeleteToolResourceActionResult = ActionResult;

function validatePrompt(prompt: string): string | null {
  const trimmed = prompt.trim();
  if (trimmed.length < 1) return "请填写生成提示词";
  if (trimmed.length > 4000) return "提示词不可超过 4000 字";
  return null;
}

export async function createInteractiveAction(
  prompt: string,
): Promise<CreateInteractiveActionResult> {
  const err = validatePrompt(prompt);
  if (err) return { ok: false, message: err };

  return withApiError(async () => {
    const data = await serverFetch<InteractiveHtml>("/interactive-htmls", {
      method: "POST",
      body: { prompt: prompt.trim() },
      schema: interactiveHtmlSchema,
    });
    revalidatePath("/interactive");
    return data;
  });
}

export async function deleteInteractiveAction(
  id: number,
): Promise<DeleteToolResourceActionResult> {
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, message: "无效的资源" };
  }
  return withApiError(async () => {
    await serverFetch(`/interactive-htmls/${id}`, { method: "DELETE" });
    revalidatePath("/interactive");
  });
}
