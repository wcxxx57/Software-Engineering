import { serverFetch } from "@/lib/api/client";
import { recommendedPlanSchema } from "@/lib/api/schemas";
import { proxyJson } from "@/lib/server/proxy";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyJson(() => serverFetch(`/study-subjects/${Number(id)}/next-plan-recommendation`, { schema: recommendedPlanSchema }));
}
