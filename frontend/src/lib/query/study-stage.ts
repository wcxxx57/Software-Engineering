"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import {
  studyStageListSchema,
  type StudyStageDetail,
} from "@/lib/api/schemas";
import { getJson } from "./utils";

export function subjectStagesQueryKey(subjectId: number) {
  return ["study-subject", subjectId, "stages"] as const;
}

async function fetchSubjectStages(
  subjectId: number,
): Promise<StudyStageDetail[]> {
  return studyStageListSchema.parse(
    await getJson(`/api/study-subjects/${subjectId}/stages`),
  );
}

export interface UseSubjectStagesOptions {
  initialData?: StudyStageDetail[];
}

export function useSubjectStages(
  subjectId: number,
  options: UseSubjectStagesOptions = {},
): UseQueryResult<StudyStageDetail[], Error> {
  return useQuery({
    queryKey: subjectStagesQueryKey(subjectId),
    queryFn: () => fetchSubjectStages(subjectId),
    initialData: options.initialData,
  });
}
