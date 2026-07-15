"use client";

import { useQuery } from "@tanstack/react-query";

import { userSchema, type User } from "@/lib/api/schemas";
import { meQueryKey } from "./keys";
import { getJson } from "./utils";

export { meQueryKey };

export function useMe(): User | null {
  const { data } = useQuery({
    queryKey: meQueryKey,
    queryFn: async () => userSchema.parse(await getJson("/api/me")),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  return data ?? null;
}

export function useRequiredMe(): User {
  const me = useMe();
  if (!me) {
    throw new Error("useRequiredMe called without an authenticated user");
  }
  return me;
}
