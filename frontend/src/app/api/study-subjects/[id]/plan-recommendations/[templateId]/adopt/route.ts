import { serverFetch } from "@/lib/api/client";
import { proxyJson } from "@/lib/server/proxy";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string; templateId: string }> }) {
  const { id, templateId } = await ctx.params;
  const subjectId = Number(id);
  const templateIdNumber = Number(templateId);
  if (!Number.isInteger(subjectId) || subjectId <= 0 || !Number.isInteger(templateIdNumber) || templateIdNumber <= 0) return Response.json({ message: "Invalid plan recommendation" }, { status: 400 });
  return proxyJson(() => serverFetch(`/study-subjects/${subjectId}/plan-recommendations/${templateIdNumber}/adopt`, { method: "POST" }));
}
