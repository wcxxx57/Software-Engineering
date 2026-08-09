import { NextResponse } from "next/server";
import { z } from "zod";

import { getAiContext } from "@/lib/ai/context";
import {
  AiGatewayError,
  buildAiMessages,
  classifyDomain,
  streamChatCompletion,
  type AiMessage,
} from "@/lib/ai/gateway";
import { aiScopeSchema } from "@/lib/api/schemas";
import { serverFetch } from "@/lib/api/client";
import { apiErrorResponse } from "@/lib/server/proxy";

export const runtime = "nodejs";

const requestSchema = z.object({
  scope: aiScopeSchema,
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(4_000),
      }),
    )
    .min(1)
    .max(50),
});

const BLOCKED_MESSAGE =
  "我只能协助计算机知识和当前计算机课程的学习问题。你可以问我编程、云计算、网络、数据库、操作系统或当前知识点相关的问题。";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "请求体必须是有效 JSON" }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { message: "对话消息格式无效，单条消息最多 4000 个字符" },
      { status: 400 },
    );
  }
  const messages = parsed.data.messages as AiMessage[];
  if (messages[messages.length - 1]?.role !== "user") {
    return NextResponse.json({ message: "最后一条消息必须来自用户" }, { status: 400 });
  }

  let context;
  try {
    context = await getAiContext(parsed.data.scope);
  } catch (error) {
    return apiErrorResponse(error);
  }

  const question = messages[messages.length - 1].content;
  let allowed: boolean;
  try {
    allowed = await classifyDomain(question, context, request.signal);
  } catch (error) {
    if (error instanceof AiGatewayError) {
      return NextResponse.json(
        { message: "AI 领域判定服务暂时不可用，请稍后重试", code: "AI_CLASSIFIER_UNAVAILABLE" },
        { status: 502 },
      );
    }
    throw error;
  }

  if (allowed && parsed.data.scope.type === "task") {
    // 热门问题统计不应阻塞回答，也不会把 JWT 暴露给浏览器。
    void serverFetch(`/study-tasks/${parsed.data.scope.task_id}/chat-questions`, {
      method: "POST",
      body: { question },
    }).catch(() => undefined);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      emit("meta", {
        scope: parsed.data.scope,
        allowed,
        knowledge_point: context.task?.knowledge_point_title ?? null,
      });

      if (!allowed) {
        emit("delta", { text: BLOCKED_MESSAGE });
        emit("done", {});
        controller.close();
        return;
      }

      try {
        for await (const text of streamChatCompletion(
          buildAiMessages(context, messages),
          request.signal,
        )) {
          emit("delta", { text });
        }
        emit("done", {});
      } catch (error) {
        if (request.signal.aborted) {
          return;
        }
        emit("error", {
          code: error instanceof AiGatewayError ? "AI_GENERATION_FAILED" : "AI_STREAM_FAILED",
          message: "AI 生成中断，请点击重试。",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
