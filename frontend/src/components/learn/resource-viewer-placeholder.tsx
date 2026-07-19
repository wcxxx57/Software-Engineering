import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type Theme = "blue" | "green";

const THEME_CLASS: Record<Theme, string> = {
  blue:
    "border-[color-mix(in_oklch,var(--palette-blue-light)_30%,transparent)] bg-gradient-to-br from-palette-blue-lighter to-palette-blue-mist",
  green:
    "border-[color-mix(in_oklch,var(--palette-green-light)_50%,transparent)] bg-gradient-to-br from-palette-green-lighter to-palette-green-mist",
};

export function ResourceViewerPlaceholder({
  theme,
  icon,
  children,
  tone = "default",
}: {
  theme: Theme;
  icon: ReactNode;
  children?: ReactNode;
  tone?: "default" | "error";
}) {
  return (
    <div
      className={cn(
        "relative aspect-video w-full overflow-hidden rounded-2xl border shadow-[inset_0_2px_8px_rgba(0,0,0,0.05)]",
        THEME_CLASS[theme],
      )}
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.4)_0%,transparent_60%)]"
      />
      <div className="relative flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        {tone === "error" ? (
          <p className="text-sm font-semibold text-destructive">{children}</p>
        ) : (
          <>
            {icon}
            {children}
          </>
        )}
      </div>
    </div>
  );
}

export function ResourceRefreshPending({ label }: { label: string }) {
  return (
    <div className="flex max-w-md items-center gap-2 text-center text-sm font-bold text-brand-medium">
      <Loader2 className="size-4 shrink-0 animate-spin" />
      暂时无法刷新{label}状态，系统会自动重试；生成任务仍在后台继续。
    </div>
  );
}
