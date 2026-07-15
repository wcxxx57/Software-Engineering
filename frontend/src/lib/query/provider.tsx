"use client";

import {
  HydrationBoundary,
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
  type DehydratedState,
} from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { humanizeApiError } from "@/lib/api/errors";

const isServer = typeof window === "undefined";

type QueryMeta = { skipErrorToast?: boolean };

function notifyError(err: unknown, meta: unknown) {
  if (isServer) return;
  if (meta && typeof meta === "object" && (meta as QueryMeta).skipErrorToast) return;
  toast.error(humanizeApiError(err));
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
    queryCache: new QueryCache({
      onError: (err, query) => notifyError(err, query.meta),
    }),
    mutationCache: new MutationCache({
      onError: (err, _vars, _ctx, mutation) => notifyError(err, mutation.meta),
    }),
  });
}

let browserClient: QueryClient | undefined;

function getQueryClient(): QueryClient {
  if (isServer) return makeQueryClient();
  if (!browserClient) browserClient = makeQueryClient();
  return browserClient;
}

export function QueryProvider({
  children,
  dehydratedState,
}: {
  children: ReactNode;
  dehydratedState: DehydratedState;
}) {
  const [client] = useState(getQueryClient);
  return (
    <QueryClientProvider client={client}>
      <HydrationBoundary state={dehydratedState}>{children}</HydrationBoundary>
      {process.env.NODE_ENV === "development" ? (
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
      ) : null}
    </QueryClientProvider>
  );
}
