"use client";

import { Video } from "lucide-react";

import { InteractiveHtmlViewer } from "@/components/learn/interactive-html-viewer";
import { VideoViewer } from "@/components/learn/video-viewer";

export type ToolFocusKind =
  | "knowledge-video"
  | "code-video"
  | "interactive-html";

export interface ToolResultPlayerProps {
  detailKind: ToolFocusKind;
  focusId: number | null;
  prompt: string | null;
}

export function ToolResultPlayer({
  detailKind,
  focusId,
  prompt,
}: ToolResultPlayerProps) {
  if (focusId == null) {
    return (
      <div className="relative flex aspect-video w-full flex-col items-center justify-center gap-4 overflow-hidden rounded-3xl border border-white/40 bg-gradient-to-br from-palette-yellow-lighter via-palette-orange-mist to-palette-orange-lighter shadow-[0_8px_32px_color-mix(in_oklch,var(--border-muted)_20%,transparent)]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 shadow-[inset_0_0_40px_color-mix(in_oklch,var(--border-muted)_15%,transparent)]"
        />
        <Video
          className="size-16 stroke-brand-light [filter:drop-shadow(0_4px_12px_color-mix(in_oklch,var(--brand-gold)_25%,transparent))]"
          strokeWidth={1.5}
        />
        <p className="text-base font-semibold tracking-wide text-brand-medium">
          生成的{detailKind === "interactive-html" ? "演示" : "视频"}将在此处播放
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {detailKind === "knowledge-video" && (
        <VideoViewer
          source={{ kind: "tool", resourceKind: "knowledge-videos", id: focusId }}
          showCard={false}
        />
      )}
      {detailKind === "code-video" && (
        <VideoViewer
          source={{ kind: "tool", resourceKind: "code-videos", id: focusId }}
          showCard={false}
        />
      )}
      {detailKind === "interactive-html" && (
        <InteractiveHtmlViewer
          source={{ kind: "tool", id: focusId }}
          showCard={false}
        />
      )}

      {prompt ? (
        <details className="rounded-2xl border border-white/60 bg-white/60 px-4 py-3 text-xs text-brand-medium shadow-[inset_0_1px_3px_rgba(0,0,0,0.05)]">
          <summary className="cursor-pointer text-sm font-bold text-brand-dark">
            查看完整 prompt
          </summary>
          <pre className="mt-3 max-h-60 overflow-auto whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-brand-dark">
            {prompt}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
