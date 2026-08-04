import { NextResponse } from "next/server";

import { serverFetch } from "@/lib/api/client";
import { quizProblemReviewSchema, type QuizProblemReview } from "@/lib/api/schemas";
import { proxyJson } from "@/lib/server/proxy";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/quiz-problems/[id]">,
) {
  const { id } = await ctx.params;
  const quizProblemId = Number(id);
  if (!Number.isInteger(quizProblemId) || quizProblemId <= 0) {
    return NextResponse.json({ message: "Invalid id" }, { status: 400 });
  }

  return proxyJson(() =>
    serverFetch<QuizProblemReview>(`/quiz-problems/${quizProblemId}`, {
      schema: quizProblemReviewSchema,
    }),
  );
}
