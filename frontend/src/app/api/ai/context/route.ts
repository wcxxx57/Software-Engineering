import { NextResponse } from "next/server";

import { aiScopeSchema } from "@/lib/api/schemas";
import { apiErrorResponse } from "@/lib/server/proxy";
import { getAiContext } from "@/lib/ai/context";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawTaskId = url.searchParams.get("taskId");
  const taskId = rawTaskId == null ? null : Number(rawTaskId);
  const parsed = aiScopeSchema.safeParse(
    taskId == null ? { type: "general" } : { type: "task", task_id: taskId },
  );
  if (!parsed.success) {
    return NextResponse.json({ message: "知识点任务参数无效" }, { status: 400 });
  }

  try {
    const data = await getAiContext(parsed.data);
    return NextResponse.json({ data });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
