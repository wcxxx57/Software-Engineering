import { serverFetch } from "@/lib/api/client";
import { recommendedPlanSchema } from "@/lib/api/schemas";
import { proxyJson } from "@/lib/server/proxy";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const subjectId = Number(id);
  if (!Number.isInteger(subjectId) || subjectId <= 0) {
    return Response.json({ message: "Invalid study subject id" }, { status: 400 });
  }
  return proxyJson(() => serverFetch(`/study-subjects/${subjectId}/next-plan-recommendation`, { schema: recommendedPlanSchema }));
}
