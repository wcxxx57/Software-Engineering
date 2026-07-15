import { redirect } from "next/navigation";

import { PretestBoard } from "@/components/pretest/pretest-board";
import { serverFetch } from "@/lib/api/client";
import {
  pretestListSchema,
  studySubjectSchema,
  type PretestProblem,
  type StudySubject,
} from "@/lib/api/schemas";

export default async function PretestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const subjectId = Number(id);
  if (!Number.isInteger(subjectId) || subjectId <= 0) {
    redirect("/dashboard");
  }

  const [subject, problems] = await Promise.all([
    serverFetch<StudySubject>(`/study-subjects/${subjectId}`, {
      schema: studySubjectSchema,
    }),
    serverFetch<PretestProblem[]>(`/study-subjects/${subjectId}/pretest`, {
      schema: pretestListSchema,
    }),
  ]);

  if (subject.status !== "PRETEST_READY" || problems.length === 0) {
    redirect("/dashboard");
  }

  const sorted = [...problems].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <PretestBoard subject={subject} problems={sorted} />
    </div>
  );
}
