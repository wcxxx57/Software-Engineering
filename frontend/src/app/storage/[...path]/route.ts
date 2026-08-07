import type { NextRequest } from "next/server";

const upstream = (process.env.STORAGE_INTERNAL_URL || "http://minio:9000").replace(/\/$/, "");
const bucket = process.env.STORAGE_BUCKET || "zhiying-content";

async function forward(request: NextRequest, context: RouteContext<"/storage/[...path]">) {
  const { path } = await context.params;
  // `assetUrl` emits `<public_base>/<bucket>/<object_key>`. When public_base
  // points at this `/storage` proxy, the proxy itself also has to add the
  // bucket to the MinIO upstream. Accept URLs with or without the leading
  // bucket so the upstream never receives `<bucket>/<bucket>/<object_key>`.
  const objectSegments = path[0] === bucket ? path.slice(1) : path;
  if (objectSegments.length === 0) {
    return new Response("Missing storage object path", { status: 400 });
  }
  const objectPath = objectSegments.map(encodeURIComponent).join("/");
  const url = new URL(`${upstream}/${encodeURIComponent(bucket)}/${objectPath}`);
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
