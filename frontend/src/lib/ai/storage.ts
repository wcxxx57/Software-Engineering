import type { AiScope } from "@/lib/api/schemas";

export type StoredAiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: number;
};

const STORAGE_PREFIX = "zhiying:ai-chat:v1";
const MAX_MESSAGES = 50;

export function aiStorageKey(userId: number, scope: AiScope): string {
  return scope.type === "general"
    ? `${STORAGE_PREFIX}:${userId}:general`
    : `${STORAGE_PREFIX}:${userId}:task:${scope.task_id}`;
}

export function loadAiMessages(userId: number, scope: AiScope): StoredAiMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(aiStorageKey(userId, scope));
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter(isStoredAiMessage)
      .slice(-MAX_MESSAGES);
  } catch {
    return [];
  }
}

export function saveAiMessages(userId: number, scope: AiScope, messages: StoredAiMessage[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      aiStorageKey(userId, scope),
      JSON.stringify(messages.slice(-MAX_MESSAGES)),
    );
  } catch {
    // 隐私模式或存储空间不足时仍保持当前内存会话可用。
  }
}

export function clearAiMessages(userId: number, scope: AiScope): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(aiStorageKey(userId, scope));
  } catch {
    // 清理失败不应阻断聊天界面。
  }
}

function isStoredAiMessage(value: unknown): value is StoredAiMessage {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    (item.role === "user" || item.role === "assistant") &&
    typeof item.content === "string" &&
    typeof item.created_at === "number"
  );
}
