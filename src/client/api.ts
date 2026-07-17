import type { RuntimeCommand, UserProfile } from "../shared/schema.js";
import type { RuntimeState } from "../shared/runtime.js";

export interface StoredVisualizationResponse {
  index: {
    visualizationId: string;
    currentVersionId: string;
    undoStack: string[];
    redoStack: string[];
  };
  version: {
    versionId: string;
    summary: string;
    spec: import("../shared/schema.js").VisualizationSpec;
  };
}

export type AgentEvent =
  | { type: "progress"; message: string }
  | { type: "tool"; name: string; status: "started" | "completed" | "failed" }
  | { type: "message"; message: string }
  | { type: "out_of_scope"; message: string }
  | { type: "runtime"; command: RuntimeCommand }
  | ({ type: "version" } & StoredVisualizationResponse)
  | ({ type: "complete" } & StoredVisualizationResponse)
  | { type: "error"; message: string; code?: string; currentVersionId?: string };

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string };
    return body.error || `请求失败 (${response.status})`;
  } catch {
    return `请求失败 (${response.status})`;
  }
}

export async function getVisualization(id: string): Promise<StoredVisualizationResponse> {
  const response = await fetch(`/api/visualizations/${id}`);
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json() as Promise<StoredVisualizationResponse>;
}

export async function createDemo(): Promise<StoredVisualizationResponse> {
  const response = await fetch("/api/visualizations/demo", { method: "POST" });
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json() as Promise<StoredVisualizationResponse>;
}

async function readSse(response: Response, onEvent: (event: AgentEvent) => void): Promise<void> {
  if (!response.ok) throw new Error(await errorMessage(response));
  if (!response.body) throw new Error("服务器没有返回事件流");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
      if (!data) continue;
      onEvent(JSON.parse(data) as AgentEvent);
    }
    if (done) break;
  }
}

export async function generateVisualization(
  concept: string,
  profile: UserProfile,
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  const response = await fetch("/api/visualizations/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ concept, profile, requestId: crypto.randomUUID() }),
  });
  await readSse(response, onEvent);
}

export async function runVisualizationAgent(
  visualizationId: string,
  baseVersionId: string,
  message: string,
  runtime: RuntimeState,
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  const response = await fetch(`/api/visualizations/${visualizationId}/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, baseVersionId, requestId: crypto.randomUUID(), runtime }),
  });
  await readSse(response, onEvent);
}

export async function navigateHistory(
  visualizationId: string,
  baseVersionId: string,
  direction: "undo" | "redo",
): Promise<StoredVisualizationResponse> {
  const response = await fetch(`/api/visualizations/${visualizationId}/history`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseVersionId, direction }),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json() as Promise<StoredVisualizationResponse>;
}
