"use client";

import { useQuery } from "@tanstack/react-query";

import { publicConfigSchema, type PublicConfig } from "@/lib/api/schemas";
import { configQueryKey } from "./keys";
import { getJson } from "./utils";

export { configQueryKey };

export function useConfig(): PublicConfig {
  const { data } = useQuery({
    queryKey: configQueryKey,
    queryFn: async () => publicConfigSchema.parse(await getJson("/api/config")),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });
  // 注水保证一定有值；root layout 始终在子树渲染前 fetch 并 setQueryData
  return data!;
}
