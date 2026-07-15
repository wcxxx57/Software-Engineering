import { NextResponse } from "next/server";

import { serverFetch } from "@/lib/api/client";
import { codeVideoSchema, type CodeVideo } from "@/lib/api/schemas";
import { proxyJson } from "@/lib/server/proxy";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/code-videos/[id]">,
) {
  const { id } = await ctx.params;
  const videoId = Number(id);
  if (!Number.isInteger(videoId) || videoId <= 0) {
    return NextResponse.json({ message: "Invalid id" }, { status: 400 });
  }

  return proxyJson(() =>
    serverFetch<CodeVideo>(`/code-videos/${videoId}`, {
      schema: codeVideoSchema,
    }),
  );
}

export async function DELETE(
  _req: Request,
  ctx: RouteContext<"/api/code-videos/[id]">,
) {
  const { id } = await ctx.params;
  const videoId = Number(id);
  if (!Number.isInteger(videoId) || videoId <= 0) {
    return NextResponse.json({ message: "Invalid id" }, { status: 400 });
  }

  return proxyJson(async () => {
    await serverFetch(`/code-videos/${videoId}`, { method: "DELETE" });
    return { ok: true };
  });
}
