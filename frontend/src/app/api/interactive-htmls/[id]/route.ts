import { NextResponse } from "next/server";

import { serverFetch } from "@/lib/api/client";
import { interactiveHtmlSchema, type InteractiveHtml } from "@/lib/api/schemas";
import { proxyJson } from "@/lib/server/proxy";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/interactive-htmls/[id]">,
) {
  const { id } = await ctx.params;
  const htmlId = Number(id);
  if (!Number.isInteger(htmlId) || htmlId <= 0) {
    return NextResponse.json({ message: "Invalid id" }, { status: 400 });
  }

  return proxyJson(() =>
    serverFetch<InteractiveHtml>(`/interactive-htmls/${htmlId}`, {
      schema: interactiveHtmlSchema,
    }),
  );
}

export async function DELETE(
  _req: Request,
  ctx: RouteContext<"/api/interactive-htmls/[id]">,
) {
  const { id } = await ctx.params;
  const htmlId = Number(id);
  if (!Number.isInteger(htmlId) || htmlId <= 0) {
    return NextResponse.json({ message: "Invalid id" }, { status: 400 });
  }

  return proxyJson(async () => {
    await serverFetch(`/interactive-htmls/${htmlId}`, { method: "DELETE" });
    return { ok: true };
  });
}
