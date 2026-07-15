import { cookies } from "next/headers";
import type { ZodType } from "zod";

import { API_PREFIX, BACKEND_API_URL } from "./config";
import { ApiError, ApiSchemaError } from "./errors";

export const AUTH_COOKIE = "zy_token";

type Json = Record<string, unknown> | Array<unknown> | string | number | boolean | null;

export interface ServerFetchOptions extends Omit<RequestInit, "body"> {
  body?: Json | FormData | BodyInit;
  query?: Record<string, string | number | boolean | undefined | null>;
  schema?: ZodType;
  skipAuth?: boolean;
}

function buildUrl(path: string, query?: ServerFetchOptions["query"]): string {
  const cleaned = path.startsWith("/") ? path : `/${path}`;
  const withPrefix = cleaned.startsWith(API_PREFIX) ? cleaned : `${API_PREFIX}${cleaned}`;
  const url = new URL(`${BACKEND_API_URL}${withPrefix}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

function normalizeBody(body: ServerFetchOptions["body"], headers: Headers): BodyInit | undefined {
  if (body === undefined || body === null) return undefined;
  if (body instanceof FormData || typeof body === "string" || body instanceof ArrayBuffer || body instanceof Blob) {
    return body as BodyInit;
  }
  headers.set("content-type", "application/json");
  return JSON.stringify(body);
}

export async function serverFetch<T = unknown>(path: string, options: ServerFetchOptions = {}): Promise<T> {
  const { body, query, schema, skipAuth, headers: initHeaders, ...rest } = options;
  const headers = new Headers(initHeaders);
  headers.set("accept", "application/json");

  if (!skipAuth) {
    const token = (await cookies()).get(AUTH_COOKIE)?.value;
    if (token) headers.set("authorization", `Bearer ${token}`);
  }

  const init: RequestInit = {
    cache: "no-store",
    ...rest,
    headers,
    body: normalizeBody(body, headers),
  };

  const res = await fetch(buildUrl(path, query), init);
  const text = await res.text();
  const payload = text.length ? safeJsonParse(text) : null;

  if (!res.ok) {
    const message =
      (payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
        ? payload.message
        : null) ?? res.statusText ?? `HTTP ${res.status}`;
    const code =
      payload && typeof payload === "object" && "code" in payload && typeof payload.code === "string"
        ? payload.code
        : undefined;
    throw new ApiError(message, res.status, code, payload);
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !("data" in payload)) {
    throw new ApiError("Malformed API response: missing data envelope", res.status, undefined, payload);
  }
  const data = (payload as { data: unknown }).data;

  if (!schema) return data as T;
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ApiSchemaError(parsed.error, data);
  return parsed.data as T;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
