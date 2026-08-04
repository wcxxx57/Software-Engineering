"use client";

import { ApiError } from "@/lib/api/errors";

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export async function requestJson(
  url: string,
  init?: { method?: Method; body?: unknown },
): Promise<unknown> {
  const method = init?.method ?? "GET";
  const hasBody = init?.body !== undefined;
  const res = await fetch(url, {
    method,
    headers: hasBody
      ? { accept: "application/json", "content-type": "application/json" }
      : { accept: "application/json" },
    body: hasBody ? JSON.stringify(init!.body) : undefined,
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (payload &&
      typeof payload === "object" &&
      "message" in payload &&
      typeof payload.message === "string"
        ? payload.message
        : null) ?? `HTTP ${res.status}`;
    const code =
      payload &&
      typeof payload === "object" &&
      "code" in payload &&
      typeof payload.code === "string"
        ? payload.code
        : undefined;
    throw new ApiError(message, res.status, code, payload);
  }
  if (!payload || typeof payload !== "object" || !("data" in payload)) {
    throw new ApiError("Malformed response: missing data envelope", res.status, undefined, payload);
  }
  return (payload as { data: unknown }).data;
}

export function getJson(url: string): Promise<unknown> {
  return requestJson(url);
}
