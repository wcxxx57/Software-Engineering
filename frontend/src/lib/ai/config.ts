const configuredBaseUrl = process.env.AI_CHAT_BASE_URL ?? process.env.CLOUDOPS_AI_BASE_URL ?? "http://127.0.0.1:8000/v1";
export const AI_CHAT_BASE_URL = normalizeBaseUrl(configuredBaseUrl);
export const AI_CHAT_MODEL = process.env.AI_CHAT_MODEL ?? process.env.CLOUDOPS_AI_MODEL ?? "cloudops-cloud-assistant";
export const AI_CHAT_API_KEY = process.env.AI_CHAT_API_KEY ?? process.env.CLOUDOPS_AI_API_KEY ?? "";
export const AI_CHAT_TIMEOUT_MS = Number(process.env.AI_CHAT_TIMEOUT_MS ?? "120000");
export const AI_CHAT_MAX_TOKENS = Number(process.env.AI_CHAT_MAX_TOKENS ?? "512");

export function aiAuthHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };
  if (AI_CHAT_API_KEY) headers.authorization = `Bearer ${AI_CHAT_API_KEY}`;
  return headers;
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}
