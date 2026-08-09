"use client";

import { Bot, X } from "lucide-react";
import { useEffect, useState } from "react";

import { AiChatPanel } from "@/components/panels/ai-chat-panel";
import type { AiContext } from "@/lib/api/schemas";

type AiChatLauncherProps = {
  taskId?: number;
  previewContext?: AiContext;
  className?: string;
};

/** Mobile floating entry; the desktop sidebars render AiChatPanel directly. */
export function AiChatLauncher({ taskId, previewContext, className = "" }: AiChatLauncherProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="打开 AI 伴学"
        aria-expanded={open}
        className={`fixed bottom-5 right-5 z-40 flex min-h-12 items-center gap-2 rounded-full border-2 border-white/80 bg-brand-dark px-4 text-sm font-extrabold text-white shadow-[0_8px_24px_color-mix(in_oklch,var(--brand-dark)_28%,transparent)] transition hover:-translate-y-0.5 motion-reduce:transform-none hover:bg-brand-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-palette-orange focus-visible:ring-offset-2 ${className}`}
      >
        <Bot className="size-5 text-palette-yellow-light" />
        <span>AI 伴学</span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end bg-brand-deep/35 p-3 backdrop-blur-[2px] sm:p-5"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            className="max-h-[calc(100dvh-1.5rem)] w-full overflow-hidden rounded-[28px] bg-canvas shadow-[0_16px_50px_color-mix(in_oklch,var(--brand-dark)_30%,transparent)] sm:mx-auto sm:max-w-[560px]"
            role="dialog"
            aria-modal="true"
            aria-label="AI 伴学"
          >
            <div className="flex items-center justify-end border-b border-border/20 bg-white/70 px-3 py-1 sm:hidden">
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭 AI 伴学"
                className="flex size-11 items-center justify-center rounded-xl text-brand-medium transition hover:bg-palette-orange-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-palette-orange"
              >
                <X className="size-5" />
              </button>
            </div>
            <AiChatPanel
              taskId={taskId}
              previewContext={previewContext}
              onClose={() => setOpen(false)}
              className="h-[min(680px,calc(100dvh-4.5rem))] min-h-0 rounded-none border-0 shadow-none"
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
