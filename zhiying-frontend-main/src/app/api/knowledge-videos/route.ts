import { NextResponse } from "next/server";
import { z } from "zod";

import { serverFetch } from "@/lib/api/client";
import { knowledgeVideoSchema, type KnowledgeVideo } from "@/lib/api/schemas";
import { proxyJson } from "@/lib/server/proxy";

const listSchema = z.array(knowledgeVideoSchema);

export async function GET() {
  return proxyJson(() =>
    serverFetch<KnowledgeVideo[]>("/knowledge-videos", { schema: listSchema }),
  );
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON" }, { status: 400 });
  }

  return proxyJson(() =>
    serverFetch<KnowledgeVideo>("/knowledge-videos", {
      method: "POST",
      body: body as Record<string, unknown>,
      schema: knowledgeVideoSchema,
    }),
  );
}
