import { serverFetch } from "@/lib/api/client";
import { taskChatContextSchema } from "@/lib/api/schemas";
import { proxyJson } from "@/lib/server/proxy";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const taskId = Number(id);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return Response.json({ message: "Invalid task id" }, { status: 400 });
  }
  return proxyJson(() =>
    serverFetch(`/study-tasks/${taskId}/chat-context`, {
      schema: taskChatContextSchema,
    }),
  );
}
