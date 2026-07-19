import type { NextRequest } from "next/server";

const upstream = (process.env.EDUCATION2D_INTERNAL_URL || "http://education2d:3100").replace(/\/$/, "");

async function forward(request: NextRequest, context: RouteContext<"/education2d/[...path]">) {
  const { path } = await context.params;
  const url = new URL(`${upstream}/${path.map(encodeURIComponent).join("/")}`);
  url.search = request.nextUrl.search;
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");

  const response = await fetch(url, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
    // Required by Node fetch when streaming a request body.
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

export const GET = forward;
export const HEAD = forward;
export const POST = forward;
