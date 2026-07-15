import { NextResponse } from "next/server";

import { serverFetch } from "@/lib/api/client";
import {
  knowledgeExplanationSchema,
  type KnowledgeExplanation,
} from "@/lib/api/schemas";
import { proxyJson } from "@/lib/server/proxy";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/knowledge-explanations/[id]">,
) {
  const { id } = await ctx.params;
  const explanationId = Number(id);
  if (!Number.isInteger(explanationId) || explanationId <= 0) {
    return NextResponse.json({ message: "Invalid id" }, { status: 400 });
  }

  return proxyJson(() =>
    serverFetch<KnowledgeExplanation>(
      `/knowledge-explanations/${explanationId}`,
      { schema: knowledgeExplanationSchema },
    ),
  );
}
