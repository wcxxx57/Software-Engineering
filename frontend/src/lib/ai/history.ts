import {
  aiChatHistorySchema,
  type AiChatMessage,
  type AiScope,
} from "@/lib/api/schemas";

import type { StoredAiMessage } from "./storage";

function historyUrl(scope: AiScope): string {
  if (scope.type === "general") return "/api/ai/history";
  return `/api/ai/history?taskId=${encodeURIComponent(scope.task_id)}`;
}

export async function loadAiHistory(
  scope: AiScope,
  signal?: AbortSignal,
): Promise<StoredAiMessage[]> {
  const response = await fetch(historyUrl(scope), {
    method: "GET",
    signal,
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as {
    data?: unknown;
    message?: string;
  } | null;
  if (!response.ok) throw new Error(payload?.message ?? "AI 伴学历史加载失败");
  const parsed = aiChatHistorySchema.safeParse(payload?.data);
  if (!parsed.success) throw new Error("AI 伴学历史数据格式异常");
  return parsed.data.messages;
}

export async function appendAiHistory(
  scope: AiScope,
  messages: StoredAiMessage[],
  signal?: AbortSignal,
): Promise<void> {
  if (!messages.length) return;
  const response = await fetch("/api/ai/history", {
    method: "POST",
    signal,
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ scope, messages: messages as AiChatMessage[] }),
  });
  const payload = (await response.json().catch(() => null)) as { message?: string } | null;
  if (!response.ok) throw new Error(payload?.message ?? "AI 伴学历史保存失败");
}

export async function clearAiHistory(scope: AiScope): Promise<void> {
  const response = await fetch(historyUrl(scope), {
    method: "DELETE",
    headers: { accept: "application/json" },
  });
  const payload = (await response.json().catch(() => null)) as { message?: string } | null;
  if (!response.ok) throw new Error(payload?.message ?? "AI 伴学历史清理失败");
}
