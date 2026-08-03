"use client";

import { useQuery } from "@tanstack/react-query";

import {
  bookmarkItemListSchema,
  quizProblemReviewListSchema,
  type BookmarkItem,
  type QuizProblemReview,
} from "@/lib/api/schemas";

import { getJson } from "./utils";

export const mistakesQueryKey = (includeHidden: boolean, q = "") =>
  ["me", "mistakes", { includeHidden, q }] as const;

export const bookmarksQueryKey = (q = "") => ["me", "bookmarks", { q }] as const;

export function useMistakes(includeHidden: boolean, q: string) {
  return useQuery<QuizProblemReview[], Error>({
    queryKey: mistakesQueryKey(includeHidden, q),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (includeHidden) params.set("include_hidden", "true");
      if (q) params.set("q", q);
      const query = params.toString();
      const url = `/api/me/mistakes${query ? `?${query}` : ""}`;
      return quizProblemReviewListSchema.parse(await getJson(url));
    },
    staleTime: 0,
  });
}

export function useBookmarks(q: string) {
  return useQuery<BookmarkItem[], Error>({
    queryKey: bookmarksQueryKey(q),
    queryFn: async () =>
      bookmarkItemListSchema.parse(
        await getJson(`/api/me/bookmarks${q ? `?q=${encodeURIComponent(q)}` : ""}`),
      ),
    staleTime: 0,
  });
}
