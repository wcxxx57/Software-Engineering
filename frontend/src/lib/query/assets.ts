"use client";

import { useQuery } from "@tanstack/react-query";

import {
  assetOverviewSchema,
  type AssetOverview,
} from "@/lib/api/schemas";
import { assetOverviewQueryKey } from "@/lib/query/keys";
import { getJson } from "@/lib/query/utils";

export function useAssetOverview(enabled: boolean) {
  return useQuery<AssetOverview>({
    queryKey: assetOverviewQueryKey,
    queryFn: async () => assetOverviewSchema.parse(await getJson("/api/me/assets")),
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
  });
}
