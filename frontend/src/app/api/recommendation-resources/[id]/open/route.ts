import { serverFetch } from "@/lib/api/client";
import { proxyJson } from "@/lib/server/proxy";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const catalogId = Number(id);
  if (!Number.isInteger(catalogId) || catalogId <= 0) {
    return Response.json({ message: "Invalid recommendation resource id" }, { status: 400 });
  }
  return proxyJson(() => serverFetch(`/recommendation-resources/${catalogId}/open`, { method: "POST" }));
}
