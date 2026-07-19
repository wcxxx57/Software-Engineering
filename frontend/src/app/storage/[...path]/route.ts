import type { NextRequest } from "next/server";

const upstream = (process.env.STORAGE_INTERNAL_URL || "http://minio:9000").replace(/\/$/, "");

async function forward(request: NextRequest, context: RouteContext<"/storage/[...path]">) {
  const { path } = await context.params;
  const url = new URL(`${upstream}/${path.map(encodeURIComponent).join("/")}`);
  url.search = request.nextUrl.search;
  const headers = new Headers();
  for (const name of ["range", "if-none-match", "if-modified-since"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const response = await fetch(url, { method: request.method, headers, redirect: "manual" });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export const GET = forward;
export const HEAD = forward;
