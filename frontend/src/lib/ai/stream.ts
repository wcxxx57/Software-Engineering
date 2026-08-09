export type AiStreamEvent =
  | { type: "meta"; data: { allowed: boolean; knowledge_point: string | null } }
  | { type: "delta"; data: { text: string } }
  | { type: "done"; data: Record<string, never> }
  | { type: "error"; data: { code: string; message: string } };

export async function consumeAiStream(
  response: Response,
  onEvent: (event: AiStreamEvent) => void,
): Promise<void> {
  if (!response.body) throw new Error("AI 没有返回流式内容");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const rawEvent of events) {
        const eventName = rawEvent
          .split("\n")
          .find((line) => line.startsWith("event:"))
          ?.slice("event:".length)
          .trim();
        const dataLine = rawEvent
          .split("\n")
          .find((line) => line.startsWith("data:"));
        if (!eventName || !dataLine) continue;
        try {
          const data = JSON.parse(dataLine.slice("data:".length).trim());
          if (eventName === "meta" && typeof data.allowed === "boolean") {
            onEvent({ type: "meta", data });
          } else if (eventName === "delta" && typeof data.text === "string") {
            onEvent({ type: "delta", data });
          } else if (eventName === "done") {
            onEvent({ type: "done", data: {} });
          } else if (
            eventName === "error" &&
            typeof data.code === "string" &&
            typeof data.message === "string"
          ) {
            onEvent({ type: "error", data });
          }
        } catch {
          // 忽略上游不完整的单个事件，后续事件仍可继续渲染。
        }
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}
