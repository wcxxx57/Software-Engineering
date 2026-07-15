import { NextResponse } from "next/server";

import { serverFetch } from "@/lib/api/client";
import {
  studyQuizDetailSchema,
  type StudyQuizDetail,
} from "@/lib/api/schemas";
import { proxyJson } from "@/lib/server/proxy";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/study-quizzes/[quizId]">,
) {
  const { quizId } = await ctx.params;
  const id = Number(quizId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ message: "Invalid id" }, { status: 400 });
  }

  return proxyJson(() =>
    serverFetch<StudyQuizDetail>(`/study-quizzes/${id}`, {
      schema: studyQuizDetailSchema,
    }),
  );
}
