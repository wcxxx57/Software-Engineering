"use client";

import { Loader2, PlayCircle, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ToolCardStatus = "QUEUING" | "GENERATING" | "FINISHED" | "FAILED";

export interface ToolCardProps {
  title: string;
  status: ToolCardStatus;
  colorIndex: number;
  thumbnailIcon?: ReactNode;
  thumbnailUrl?: string;
  active?: boolean;
  onClick: () => void;
  onDelete: () => void;
  deleting?: boolean;
  showDelete?: boolean;
  showStatus?: boolean;
}

const COVER_GRADIENTS = [
  "from-palette-blue-lighter to-palette-blue-mist",
  "from-palette-purple-lighter to-palette-purple-mist",
  "from-palette-green-lighter to-palette-green-mist",
  "from-palette-yellow-lighter to-palette-yellow-mist",
  "from-palette-orange-lighter to-palette-orange-mist",
];

const STATUS_LABEL: Record<ToolCardStatus, string> = {
  QUEUING: "排队中",
  GENERATING: "生成中",
  FINISHED: "已就绪",
  FAILED: "失败",
};

const STATUS_BG: Record<ToolCardStatus, string> = {
  QUEUING: "bg-palette-yellow-light/90 text-palette-orange",
  GENERATING: "bg-palette-blue-mist/90 text-palette-blue",
  FINISHED: "bg-palette-green-lighter/90 text-palette-green",
  FAILED: "bg-destructive/15 text-destructive",
};

export function ToolCard({
  title,
  status,
  colorIndex,
  thumbnailIcon,
  thumbnailUrl,
  active = false,
  onClick,
  onDelete,
  deleting = false,
  showDelete = true,
  showStatus = true,
}: ToolCardProps) {
  const gradient = COVER_GRADIENTS[colorIndex % COVER_GRADIENTS.length];
  const [loadedThumbnailUrl, setLoadedThumbnailUrl] = useState<string | null>(null);
  const thumbnailReady = thumbnailUrl === loadedThumbnailUrl;

  return (
    <div
      className={cn(
        "group relative flex cursor-pointer flex-col gap-3 rounded-2xl border bg-gradient-to-b from-white/80 to-[color-mix(in_oklch,var(--surface-soft)_40%,transparent)] p-3 shadow-[0_4px_12px_color-mix(in_oklch,var(--border-muted)_15%,transparent)] backdrop-blur transition-all hover:-translate-y-1.5 hover:shadow-[0_12px_24px_color-mix(in_oklch,var(--border-muted)_20%,transparent)]",
        active
          ? "border-palette-orange/60 shadow-[0_8px_24px_color-mix(in_oklch,var(--palette-orange)_30%,transparent)]"
          : "border-white/60 hover:border-palette-orange/40",
      )}
      onClick={onClick}
    >
      <div
        className={cn(
          "relative flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br shadow-[inset_0_2px_8px_rgba(0,0,0,0.05)]",
          gradient,
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.4)_0%,transparent_60%)]"
        />
        <div className="relative text-brand-gold [&>svg]:size-12">
          {thumbnailIcon ?? <PlayCircle strokeWidth={1.75} />}
        </div>
        {thumbnailUrl ? (
          <>
            <video
              aria-hidden
              muted
              playsInline
              preload="metadata"
              src={`${thumbnailUrl}#t=0.1`}
              tabIndex={-1}
              className={cn(
                "pointer-events-none absolute inset-0 size-full object-cover transition-opacity duration-300",
                thumbnailReady ? "opacity-100" : "opacity-0",
              )}
              onLoadedData={() => setLoadedThumbnailUrl(thumbnailUrl)}
              onError={() => setLoadedThumbnailUrl(null)}
            />
            {thumbnailReady ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 flex items-center justify-center bg-gradient-to-t from-black/25 via-transparent to-black/5"
              >
                <span className="flex size-11 items-center justify-center rounded-full border border-white/70 bg-black/35 text-white shadow-lg backdrop-blur-sm transition-transform group-hover:scale-110">
                  <PlayCircle className="size-7" strokeWidth={1.8} />
                </span>
              </div>
            ) : null}
          </>
        ) : null}
        {showStatus ? <span
          className={cn(
            "absolute right-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-bold backdrop-blur",
            STATUS_BG[status],
          )}
        >
          {STATUS_LABEL[status]}
        </span> : null}
      </div>

      <h4 className="truncate px-1 text-base font-semibold text-brand-medium">
        {title}
      </h4>

      {showDelete ? <Button
        variant="ghost"
        size="sm"
        className="absolute right-2 bottom-2 size-8 rounded-full p-0 opacity-0 transition group-hover:opacity-100 hover:bg-destructive/10"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        disabled={deleting}
        title="从工具画廊移除"
      >
        {deleting ? (
          <Loader2 className="size-4 animate-spin text-brand-medium" />
        ) : (
          <Trash2 className="size-4 text-destructive" />
        )}
      </Button> : null}
    </div>
  );
}
