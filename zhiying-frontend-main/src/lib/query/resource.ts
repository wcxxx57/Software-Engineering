"use client";

import { useQuery } from "@tanstack/react-query";

import { getJson } from "./utils";

type ResourceStatus = "QUEUING" | "GENERATING" | "FINISHED" | "FAILED";

export type ResourceKind =
  | "knowledge-videos"
  | "code-videos"
  | "interactive-htmls"
  | "knowledge-explanations";

export type ResourceSource =
  | { kind: "task"; taskId: number; resourceKind: "knowledge-video" | "interactive-html" }
  | { kind: "tool"; resourceKind: ResourceKind; id: number }
  | { kind: "explanation"; id: number };

function resourceUrl(source: ResourceSource): string {
  if (source.kind === "task") {
    return `/api/study-tasks/${source.taskId}/${source.resourceKind}`;
  }
  if (source.kind === "explanation") {
    return `/api/knowledge-explanations/${source.id}`;
  }
  return `/api/${source.resourceKind}/${source.id}`;
}

function resourceQueryKey(source: ResourceSource): readonly unknown[] {
  if (source.kind === "task") {
    return ["task-resource", source.taskId, source.resourceKind] as const;
  }
  if (source.kind === "explanation") {
    return ["knowledge-explanations", source.id] as const;
  }
  return [source.resourceKind, source.id] as const;
}

export function useResource<T extends { status: ResourceStatus }>(opts: {
  source: ResourceSource;
  schema: { parse: (v: unknown) => T };
}) {
  return useQuery({
    queryKey: resourceQueryKey(opts.source),
    queryFn: async () => opts.schema.parse(await getJson(resourceUrl(opts.source))),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "FINISHED" || status === "FAILED") return false;
      return 2000;
    },
    staleTime: 0,
  });
}
