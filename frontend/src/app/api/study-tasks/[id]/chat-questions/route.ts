import { NextResponse } from "next/server";
import { z } from "zod";

import { serverFetch } from "@/lib/api/client";
import { proxyJson } from "@/lib/server/proxy";

const requestSchema = z.object({
  question: z.string().trim().min(2).max(500),
  normalized_question: z.string().trim().min(2).max(500).optional(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const taskId = Number(id);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return NextResponse.json({ message: "Invalid task id" }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ message: "Request body must be valid JSON" }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ message: "Question must contain between 2 and 500 characters" }, { status: 400 });
  }

  return proxyJson(() =>
    serverFetch(`/study-tasks/${taskId}/chat-questions`, {
      method: "POST",
      body: parsed.data,
    }),
  );
}
