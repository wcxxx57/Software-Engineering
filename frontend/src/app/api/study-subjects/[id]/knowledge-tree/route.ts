import { NextResponse } from "next/server";

import { serverFetch } from "@/lib/api/client";
import { knowledgeTreeSchema, type KnowledgeTree } from "@/lib/api/schemas";
import { proxyJson } from "@/lib/server/proxy";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/study-subjects/[id]/knowledge-tree">,
) {
  const { id } = await ctx.params;
  const subjectId = Number(id);
  if (!Number.isInteger(subjectId) || subjectId <= 0) {
    return NextResponse.json({ message: "Invalid id" }, { status: 400 });
  }
  return proxyJson(() =>
    serverFetch<KnowledgeTree>(`/study-subjects/${subjectId}/knowledge-tree`, {
      schema: knowledgeTreeSchema,
    }),
  );
}

export async function POST(
  _req: Request,
  ctx: RouteContext<"/api/study-subjects/[id]/knowledge-tree">,
) {
  const { id } = await ctx.params;
  const subjectId = Number(id);
  if (!Number.isInteger(subjectId) || subjectId <= 0) {
    return NextResponse.json({ message: "Invalid id" }, { status: 400 });
  }
  return proxyJson(() =>
    serverFetch(`/study-subjects/${subjectId}/knowledge-tree`, { method: "POST" }),
  );
}
