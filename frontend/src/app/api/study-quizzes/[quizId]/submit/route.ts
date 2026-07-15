import { NextResponse } from "next/server";

import { serverFetch } from "@/lib/api/client";
import {
  submitStudyQuizResponseSchema,
  type SubmitStudyQuizResponse,
} from "@/lib/api/schemas";
import { proxyJson } from "@/lib/server/proxy";

export async function POST(
  _req: Request,
  ctx: RouteContext<"/api/study-quizzes/[quizId]/submit">,
) {
  const { quizId } = await ctx.params;
  const id = Number(quizId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ message: "Invalid id" }, { status: 400 });
  }

  return proxyJson(() =>
    serverFetch<SubmitStudyQuizResponse>(`/study-quizzes/${id}/submit`, {
      method: "POST",
      body: {},
      schema: submitStudyQuizResponseSchema,
    }),
  );
}
