import { NextResponse } from "next/server";

import { serverFetch } from "@/lib/api/client";
import { knowledgeVideoSchema, type KnowledgeVideo } from "@/lib/api/schemas";
import { proxyJson } from "@/lib/server/proxy";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/knowledge-videos/[id]">,
) {
  const { id } = await ctx.params;
  const videoId = Number(id);
  if (!Number.isInteger(videoId) || videoId <= 0) {
    return NextResponse.json({ message: "Invalid id" }, { status: 400 });
  }

  return proxyJson(() =>
    serverFetch<KnowledgeVideo>(`/knowledge-videos/${videoId}`, {
      schema: knowledgeVideoSchema,
    }),
  );
}

export async function DELETE(
  _req: Request,
  ctx: RouteContext<"/api/knowledge-videos/[id]">,
) {
  const { id } = await ctx.params;
  const videoId = Number(id);
  if (!Number.isInteger(videoId) || videoId <= 0) {
    return NextResponse.json({ message: "Invalid id" }, { status: 400 });
  }

  return proxyJson(async () => {
    await serverFetch(`/knowledge-videos/${videoId}`, { method: "DELETE" });
    return { ok: true };
  });
}
