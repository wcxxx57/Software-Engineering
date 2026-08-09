import { NextResponse } from "next/server";

import { serverFetch } from "@/lib/api/client";
import {
  aiChatConversationListSchema,
  aiScopeSchema,
} from "@/lib/api/schemas";
import { apiErrorResponse } from "@/lib/server/proxy";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawTaskId = url.searchParams.get("taskId");
  const taskId = rawTaskId == null ? null : Number(rawTaskId);
  const scope = aiScopeSchema.safeParse(
    taskId == null ? { type: "general" } : { type: "task", task_id: taskId },
  );
  if (!scope.success) {
    return NextResponse.json({ message: "AI 伴学场景参数无效" }, { status: 400 });
  }

  try {
    const data = await serverFetch("/me/ai-chat/conversations", {
      query:
        scope.data.type === "general"
          ? { scope: "general" }
          : { scope: "task", task_id: scope.data.task_id },
    });
    return NextResponse.json({ data: aiChatConversationListSchema.parse(data) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
