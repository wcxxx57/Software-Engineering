import { NextResponse } from "next/server";

import { serverFetch } from "@/lib/api/client";
import { proxyJson } from "@/lib/server/proxy";

export async function PATCH(
  _req: Request,
  ctx: RouteContext<"/api/quiz-problems/[id]/bookmark">,
) {
  const { id } = await ctx.params;
  const quizProblemId = Number(id);
  if (!Number.isInteger(quizProblemId) || quizProblemId <= 0) {
    return NextResponse.json({ message: "Invalid id" }, { status: 400 });
  }

  return proxyJson(() =>
    serverFetch(`/quiz-problems/${quizProblemId}/bookmark`, {
      method: "PATCH",
      body: {},
    }),
  );
}
