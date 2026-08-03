"use client";

import { useQuery } from "@tanstack/react-query";

import {
  featuredResourcesSchema,
  taskChatContextSchema,
  taskRecommendationsSchema,
  recommendedPlanSchema,
  type RecommendationResourceKind,
} from "@/lib/api/schemas";

import { getJson } from "./utils";

export function useTaskRecommendations(taskId: number, enabled = true) {
  return useQuery({
    queryKey: ["task", taskId, "recommendations"] as const,
    queryFn: async () =>
      taskRecommendationsSchema.parse(
        await getJson(`/api/study-tasks/${taskId}/recommendations`),
      ),
    retry: false,
    enabled,
  });
}

export function useFeaturedResources(
  kind: RecommendationResourceKind,
  enabled = true,
) {
  return useQuery({
    queryKey: ["resources", "featured", kind] as const,
    queryFn: async () =>
      featuredResourcesSchema.parse(
        await getJson(`/api/recommendations/featured?kind=${kind}`),
      ),
    retry: false,
    enabled,
  });
}

export function useTaskChatContext(taskId: number, enabled = true) {
  return useQuery({
    queryKey: ["task", taskId, "chat-context"] as const,
    queryFn: async () =>
      taskChatContextSchema.parse(
        await getJson(`/api/study-tasks/${taskId}/chat-context`),
      ),
    retry: false,
    enabled,
  });
}

export function usePlanRecommendation(subjectId: number, next = false, enabled = true) {
  return useQuery({
    queryKey: ["study-subject", subjectId, next ? "next-plan" : "plan-recommendation"] as const,
    queryFn: async () =>
      recommendedPlanSchema.parse(
        await getJson(
          `/api/study-subjects/${subjectId}/${next ? "next-plan-recommendation" : "plan-recommendation"}`,
        ),
      ),
    retry: false,
    enabled,
  });
}
