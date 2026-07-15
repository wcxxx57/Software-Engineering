"use client";

import { useQuery } from "@tanstack/react-query";

import {
  quizProblemReviewListSchema,
  type QuizProblemReview,
} from "@/lib/api/schemas";

import { getJson } from "./utils";

export const mistakesQueryKey = (includeHidden: boolean) =>
  ["me", "mistakes", { includeHidden }] as const;

export const bookmarksQueryKey = () => ["me", "bookmarks"] as const;

export function useMistakes(includeHidden: boolean) {
  return useQuery<QuizProblemReview[], Error>({
    queryKey: mistakesQueryKey(includeHidden),
    queryFn: async () => {
      const url = includeHidden
        ? "/api/me/mistakes?include_hidden=true"
        : "/api/me/mistakes";
      return quizProblemReviewListSchema.parse(await getJson(url));
    },
    staleTime: 0,
  });
}

export function useBookmarks() {
  return useQuery<QuizProblemReview[], Error>({
    queryKey: bookmarksQueryKey(),
    queryFn: async () =>
      quizProblemReviewListSchema.parse(
        await getJson("/api/me/bookmarks"),
      ),
    staleTime: 0,
  });
}
