import { NextResponse } from "next/server";

import { serverFetch } from "@/lib/api/client";
import {
  studyStageListSchema,
  type StudyStageDetail,
} from "@/lib/api/schemas";
import { proxyJson } from "@/lib/server/proxy";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/study-subjects/[id]/stages">,
) {
  const { id } = await ctx.params;
  const subjectId = Number(id);
  if (!Number.isInteger(subjectId) || subjectId <= 0) {
    return NextResponse.json({ message: "Invalid id" }, { status: 400 });
  }

  return proxyJson(() =>
    serverFetch<StudyStageDetail[]>(`/study-subjects/${subjectId}/stages`, {
      schema: studyStageListSchema,
    }),
  );
}
