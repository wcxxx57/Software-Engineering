import {
  aiChatConversationListSchema,
  aiChatHistorySchema,
  type AiChatConversation,
  type AiChatMessage,
  type AiScope,
} from "@/lib/api/schemas";

function scopeParams(scope: AiScope): URLSearchParams {
  const params = new URLSearchParams();
  if (scope.type === "task") params.set("taskId", String(scope.task_id));
  return params;
}

function historyUrl(scope: AiScope, conversationId: string): string {
  const params = scopeParams(scope);
  params.set("conversationId", conversationId);
  return `/api/ai/history?${params.toString()}`;
}

export async function loadAiHistory(
  scope: AiScope,
  conversationId: string,
  signal?: AbortSignal,
): Promise<AiChatMessage[]> {
  const response = await fetch(historyUrl(scope, conversationId), {
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
  conversationId: string,
  messages: AiChatMessage[],
  signal?: AbortSignal,
): Promise<void> {
  if (!messages.length) return;
  const response = await fetch("/api/ai/history", {
    method: "POST",
    signal,
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ scope, conversation_id: conversationId, messages }),
  });
  const payload = (await response.json().catch(() => null)) as { message?: string } | null;
  if (!response.ok) throw new Error(payload?.message ?? "AI 伴学历史保存失败");
}

export async function clearAiHistory(scope: AiScope, conversationId: string): Promise<void> {
  const response = await fetch(historyUrl(scope, conversationId), {
    method: "DELETE",
    headers: { accept: "application/json" },
  });
  const payload = (await response.json().catch(() => null)) as { message?: string } | null;
  if (!response.ok) throw new Error(payload?.message ?? "AI 伴学历史清理失败");
}

export async function listAiConversations(
  scope: AiScope,
  signal?: AbortSignal,
): Promise<AiChatConversation[]> {
  const params = scopeParams(scope);
  const query = params.toString();
  const response = await fetch(`/api/ai/conversations${query ? `?${query}` : ""}`, {
    method: "GET",
    signal,
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as {
    data?: unknown;
    message?: string;
  } | null;
  if (!response.ok) throw new Error(payload?.message ?? "AI 伴学会话列表加载失败");
  const parsed = aiChatConversationListSchema.safeParse(payload?.data);
  if (!parsed.success) throw new Error("AI 伴学会话列表格式异常");
  return parsed.data.conversations;
}
