import { ArrowLeft, Bot } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AiChatSurface } from "@/components/ai/ai-chat-surface";
import { getAiContext } from "@/lib/ai/context";
import { aiScopeSchema } from "@/lib/api/schemas";
import { ApiError } from "@/lib/api/errors";

export default async function AiChatPage({
  searchParams,
}: {
  searchParams: Promise<{ taskId?: string }>;
}) {
  const { taskId: rawTaskId } = await searchParams;
  const taskId = rawTaskId == null ? null : Number(rawTaskId);
  const parsed = aiScopeSchema.safeParse(
    taskId == null ? { type: "general" } : { type: "task", task_id: taskId },
  );
  if (!parsed.success) redirect("/ai-chat");

  let context;
  try {
    context = await getAiContext(parsed.data);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      redirect("/login?next=/ai-chat");
    }
    redirect("/dashboard");
  }

  return (
      <div className="flex h-dvh w-full flex-col bg-canvas">
        <header className="flex shrink-0 items-center justify-between border-b border-border/30 bg-white/60 px-4 py-3 backdrop-blur-md md:px-8">
          <Link href="/dashboard" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-extrabold text-brand-medium transition hover:bg-palette-orange-mist hover:text-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-palette-orange">
            <ArrowLeft className="size-4" />返回主控台
          </Link>
          <div className="flex items-center gap-2 text-sm font-extrabold text-brand-dark">
            <Bot className="size-5 text-palette-orange" />AI 伴学空间
          </div>
          <span className="hidden text-xs font-semibold text-brand-medium sm:block">当前会话仅保存在本机浏览器</span>
        </header>
        <main className="min-h-0 flex-1">
          <AiChatSurface context={context} mode="fullscreen" />
        </main>
      </div>
  );
}
