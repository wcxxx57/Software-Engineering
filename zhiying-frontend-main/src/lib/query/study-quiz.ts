"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  studyQuizDetailSchema,
  studyQuizListSchema,
  type StudyQuizBrief,
  type StudyQuizDetail,
} from "@/lib/api/schemas";

import { getJson, requestJson } from "./utils";

type AnswerLetter = "A" | "B" | "C" | "D";

export function taskQuizzesQueryKey(taskId: number) {
  return ["study-task", taskId, "quizzes"] as const;
}

export function quizDetailQueryKey(quizId: number) {
  return ["study-quiz", quizId] as const;
}

export function useStudyTaskQuizzes(
  taskId: number,
): UseQueryResult<StudyQuizBrief[], Error> {
  return useQuery({
    queryKey: taskQuizzesQueryKey(taskId),
    queryFn: async () =>
      studyQuizListSchema.parse(
        await getJson(`/api/study-tasks/${taskId}/quizzes`),
      ),
    staleTime: 0,
  });
}

export function useStudyQuiz(
  quizId: number | null,
): UseQueryResult<StudyQuizDetail, Error> {
  return useQuery({
    queryKey: quizDetailQueryKey(quizId ?? -1),
    queryFn: async () =>
      studyQuizDetailSchema.parse(
        await getJson(`/api/study-quizzes/${quizId}`),
      ),
    enabled: quizId != null && quizId > 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (
        status === "READY" ||
        status === "SUBMITTED" ||
        status === "FAILED"
      ) {
        return false;
      }
      return 2000;
    },
    staleTime: 0,
  });
}

export function usePatchQuizAnswer(quizId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { problemEntryId: number; answer: AnswerLetter }) => {
      await requestJson(
        `/api/study-quizzes/${quizId}/problems/${vars.problemEntryId}`,
        {
          method: "PATCH",
          body: { chosen_answer: vars.answer },
        },
      );
      return vars;
    },
    onMutate: async (vars) => {
      const key = quizDetailQueryKey(quizId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<StudyQuizDetail>(key);
      if (previous) {
        qc.setQueryData<StudyQuizDetail>(key, {
          ...previous,
          problems: previous.problems.map((p) =>
            p.id === vars.problemEntryId
              ? { ...p, chosen_answer: vars.answer }
              : p,
          ),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(quizDetailQueryKey(quizId), ctx.previous);
      }
    },
  });
}

export function useSubmitQuiz(quizId: number, taskId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      requestJson(`/api/study-quizzes/${quizId}/submit`, {
        method: "POST",
        body: {},
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: quizDetailQueryKey(quizId) });
      qc.invalidateQueries({ queryKey: taskQuizzesQueryKey(taskId) });
    },
  });
}

export function useToggleProblemBookmark(quizId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (quizProblemId: number) => {
      await requestJson(`/api/quiz-problems/${quizProblemId}/bookmark`, {
        method: "PATCH",
      });
      return quizProblemId;
    },
    onMutate: async (quizProblemId) => {
      const key = quizDetailQueryKey(quizId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<StudyQuizDetail>(key);
      if (previous) {
        qc.setQueryData<StudyQuizDetail>(key, {
          ...previous,
          problems: previous.problems.map((p) =>
            p.id === quizProblemId
              ? { ...p, bookmarked: !p.bookmarked }
              : p,
          ),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(quizDetailQueryKey(quizId), ctx.previous);
      }
    },
  });
}
