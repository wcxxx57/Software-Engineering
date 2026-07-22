"use client";

import { useQuery } from "@tanstack/react-query";

import { knowledgeTreeSchema, type KnowledgeTree } from "@/lib/api/schemas";
import { getJson } from "./utils";

export function knowledgeTreeQueryKey(subjectId: number) {
  return ["study-subject", subjectId, "knowledge-tree"] as const;
}

export function useKnowledgeTree(subjectId: number, enabled = true) {
  return useQuery<KnowledgeTree, Error>({
    queryKey: knowledgeTreeQueryKey(subjectId),
    queryFn: async () =>
      knowledgeTreeSchema.parse(
        await getJson(`/api/study-subjects/${subjectId}/knowledge-tree`),
      ),
    enabled,
  });
}
