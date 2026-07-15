import { serverFetch } from "@/lib/api/client";
import { studySubjectListSchema, type StudySubject } from "@/lib/api/schemas";
import { proxyJson } from "@/lib/server/proxy";

export async function GET() {
  return proxyJson(() =>
    serverFetch<StudySubject[]>("/study-subjects", {
      schema: studySubjectListSchema,
    }),
  );
}
