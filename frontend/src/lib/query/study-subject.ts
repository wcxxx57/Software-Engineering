"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import {
  studySubjectListSchema,
  studySubjectSchema,
  type StudySubject,
} from "@/lib/api/schemas";
import { studySubjectListQueryKey, studySubjectQueryKey } from "./keys";
import { getJson } from "./utils";

export { studySubjectListQueryKey, studySubjectQueryKey };

const POLL_INTERVAL_MS = 2000;

const POLLING_STATUSES = new Set<StudySubject["status"]>([
  "PRETEST_QUEUING",
  "PRETEST_GENERATING",
  "PLAN_QUEUING",
  "PLAN_GENERATING",
]);

async function fetchStudySubject(id: number): Promise<StudySubject> {
  return studySubjectSchema.parse(await getJson(`/api/study-subjects/${id}`));
}

async function fetchStudySubjectList(): Promise<StudySubject[]> {
  return studySubjectListSchema.parse(await getJson(`/api/study-subjects`));
}

export interface UseStudySubjectOptions {
  /** Initial data from the RSC pass; avoids a loading flash. */
  initialData?: StudySubject;
  /** Force-disable polling regardless of status. */
  disablePolling?: boolean;
}

export function useStudySubject(
  id: number,
  options: UseStudySubjectOptions = {},
): UseQueryResult<StudySubject, Error> {
  const { initialData, disablePolling = false } = options;
  return useQuery({
    queryKey: studySubjectQueryKey(id),
    queryFn: () => fetchStudySubject(id),
    initialData,
    refetchInterval: (query) => {
      if (disablePolling) return false;
      const status = query.state.data?.status;
      return status && POLLING_STATUSES.has(status) ? POLL_INTERVAL_MS : false;
    },
  });
}

export function isStudySubjectPolling(status: StudySubject["status"] | undefined): boolean {
  return !!status && POLLING_STATUSES.has(status);
}

export interface UseStudySubjectListOptions {
  /** Initial data from the RSC pass; avoids a loading flash. */
  initialData?: StudySubject[];
  /** Force-disable polling regardless of statuses present. */
  disablePolling?: boolean;
}

export function useStudySubjectList(
  options: UseStudySubjectListOptions = {},
): UseQueryResult<StudySubject[], Error> {
  const { initialData, disablePolling = false } = options;
  return useQuery({
    queryKey: studySubjectListQueryKey(),
    queryFn: fetchStudySubjectList,
    initialData,
    refetchInterval: (query) => {
      if (disablePolling) return false;
      const list = query.state.data;
      return list?.some((s) => POLLING_STATUSES.has(s.status))
        ? POLL_INTERVAL_MS
        : false;
    },
  });
}
