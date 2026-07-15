import { NextResponse } from "next/server";

import { serverFetch } from "@/lib/api/client";
import { studySubjectSchema, type StudySubject } from "@/lib/api/schemas";
import { proxyJson } from "@/lib/server/proxy";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/study-subjects/[id]">,
) {
  const { id } = await ctx.params;
  const subjectId = Number(id);
  if (!Number.isInteger(subjectId) || subjectId <= 0) {
    return NextResponse.json({ message: "Invalid id" }, { status: 400 });
  }

  return proxyJson(() =>
    serverFetch<StudySubject>(`/study-subjects/${subjectId}`, {
      schema: studySubjectSchema,
    }),
  );
}
