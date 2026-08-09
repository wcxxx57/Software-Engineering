"use client";

import { Bot, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import { AiChatSurface } from "@/components/ai/ai-chat-surface";
import { aiContextSchema, type AiContext } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

export function AiChatPanel({ taskId, className, previewContext, onClose }: { taskId?: number; className?: string; previewContext?: AiContext; onClose?: () => void }) {
  const [loadedContext, setLoadedContext] = useState<AiContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (previewContext) return;
    const controller = new AbortController();
    const query = taskId == null ? "" : `?taskId=${taskId}`;
    fetch(`/api/ai/context${query}`, { signal: controller.signal, headers: { accept: "application/json" } })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { data?: unknown; message?: string } | null;
        if (!response.ok) throw new Error(payload?.message ?? "AI 伴学上下文加载失败");
        setLoadedContext(aiContextSchema.parse(payload?.data));
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "AI 伴学上下文加载失败");
      });
    return () => controller.abort();
  }, [previewContext, reloadKey, taskId]);

  const context = previewContext ?? loadedContext;
  if (context) return <AiChatSurface context={context} className={className} onClose={onClose} />;
  if (error) {
    return (
      <div className={cn("flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-[24px] border border-danger/20 bg-danger-soft px-6 text-center", className)}>
        <Bot className="size-8 text-danger" />
        <p className="text-sm font-semibold text-danger">{error}</p>
        <button type="button" onClick={() => setReloadKey((value) => value + 1)} className="flex min-h-11 items-center gap-2 rounded-xl bg-white/80 px-4 text-sm font-extrabold text-brand-dark transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger">
          <RotateCcw className="size-4" />重试加载
        </button>
      </div>
    );
  }
  return (
    <div className={cn("flex min-h-[260px] items-center justify-center rounded-[24px] border border-palette-orange-light/40 bg-white/65 text-sm font-semibold text-brand-medium", className)}>
      <Loader2 className="mr-2 size-4 animate-spin text-palette-orange" />正在准备你的学习画像…
    </div>
  );
}
