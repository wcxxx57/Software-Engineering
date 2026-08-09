import { NextResponse } from "next/server";
import { z } from "zod";

import { serverFetch } from "@/lib/api/client";
import {
  aiConversationIdSchema,
  aiChatHistorySchema,
  aiChatMessageSchema,
  aiScopeSchema,
} from "@/lib/api/schemas";
import { apiErrorResponse } from "@/lib/server/proxy";

export const runtime = "nodejs";

const appendRequestSchema = z.object({
  scope: aiScopeSchema,
  conversation_id: aiConversationIdSchema,
  messages: z.array(aiChatMessageSchema).min(1).max(50),
});

function parseScope(request: Request) {
  const url = new URL(request.url);
  const rawTaskId = url.searchParams.get("taskId");
  const taskId = rawTaskId == null ? null : Number(rawTaskId);
  return aiScopeSchema.safeParse(
    taskId == null ? { type: "general" } : { type: "task", task_id: taskId },
  );
}

function scopeQuery(scope: z.infer<typeof aiScopeSchema>) {
  return scope.type === "general"
    ? { scope: "general" }
    : { scope: "task", task_id: scope.task_id };
}

function parseConversationId(request: Request) {
  return aiConversationIdSchema.safeParse(
    new URL(request.url).searchParams.get("conversationId"),
  );
}

export async function GET(request: Request) {
  const parsed = parseScope(request);
  if (!parsed.success) {
    return NextResponse.json({ message: "AI 伴学场景参数无效" }, { status: 400 });
  }
  const conversationId = parseConversationId(request);
  if (!conversationId.success) {
    return NextResponse.json({ message: "AI 伴学会话参数无效" }, { status: 400 });
  }
  try {
    const data = await serverFetch("/me/ai-chat/messages", {
      query: {
        ...scopeQuery(parsed.data),
        conversation_id: conversationId.data,
      },
    });
    const history = aiChatHistorySchema.parse(data);
    return NextResponse.json({ data: history });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "请求体必须是有效 JSON" }, { status: 400 });
  }
  const parsed = appendRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ message: "AI 伴学历史格式无效" }, { status: 400 });
  }
  try {
    const data = await serverFetch("/me/ai-chat/messages", {
      method: "POST",
      body: {
        scope: parsed.data.scope,
        conversation_id: parsed.data.conversation_id,
        messages: parsed.data.messages,
      },
    });
    return NextResponse.json({ data });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const parsed = parseScope(request);
  if (!parsed.success) {
    return NextResponse.json({ message: "AI 伴学场景参数无效" }, { status: 400 });
  }
  const conversationId = parseConversationId(request);
  if (!conversationId.success) {
    return NextResponse.json({ message: "AI 伴学会话参数无效" }, { status: 400 });
  }
  try {
    const data = await serverFetch("/me/ai-chat/messages", {
      method: "DELETE",
      query: {
        ...scopeQuery(parsed.data),
        conversation_id: conversationId.data,
      },
    });
    return NextResponse.json({ data });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
