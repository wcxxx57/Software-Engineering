import { NextResponse } from "next/server";

import { serverFetch } from "@/lib/api/client";
import { knowledgeVideoSchema, type KnowledgeVideo } from "@/lib/api/schemas";
import { proxyJson } from "@/lib/server/proxy";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/study-tasks/[id]/knowledge-video">,
) {
  const { id } = await ctx.params;
  const taskId = Number(id);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return NextResponse.json({ message: "Invalid id" }, { status: 400 });
  }

  return proxyJson(() =>
    serverFetch<KnowledgeVideo>(`/study-tasks/${taskId}/knowledge-video`, {
      schema: knowledgeVideoSchema,
    }),
  );
}
