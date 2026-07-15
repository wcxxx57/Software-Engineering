import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type ContentCardTheme = "yellow" | "purple" | "blue" | "green" | "orange";

const THEME_BG: Record<ContentCardTheme, string> = {
  yellow:
    "bg-[color-mix(in_oklch,var(--palette-yellow-light)_30%,transparent)] border-palette-yellow-light",
  purple:
    "bg-[color-mix(in_oklch,var(--palette-purple-mist)_90%,transparent)] border-[color-mix(in_oklch,var(--palette-purple-light)_90%,transparent)]",
  blue: "bg-[color-mix(in_oklch,var(--palette-blue-lighter)_55%,transparent)] border-[color-mix(in_oklch,var(--palette-blue-light)_70%,transparent)]",
  green:
    "bg-[color-mix(in_oklch,var(--palette-green-lighter)_55%,transparent)] border-[color-mix(in_oklch,var(--palette-green-light)_70%,transparent)]",
  orange:
    "bg-[color-mix(in_oklch,var(--palette-orange-lighter)_45%,transparent)] border-[color-mix(in_oklch,var(--palette-orange-light)_70%,transparent)]",
};

const THEME_ICON: Record<ContentCardTheme, string> = {
  yellow: "text-brand-gold",
  purple: "text-palette-purple",
  blue: "text-palette-blue",
  green: "text-palette-green",
  orange: "text-palette-orange",
};

const THEME_SUBTITLE: Record<ContentCardTheme, string> = {
  yellow: "text-brand-gold",
  purple: "text-palette-purple",
  blue: "text-palette-blue",
  green: "text-palette-green",
  orange: "text-palette-orange",
};

export function ContentCard({
  theme,
  icon,
  title,
  subtitle,
  action,
  children,
  className,
}: {
  theme: ContentCardTheme;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-3xl border p-6 backdrop-blur-md transition-all duration-300 sm:p-10",
        "shadow-[var(--shadow-soft)] hover:-translate-y-1 hover:shadow-[var(--shadow-hover)]",
        THEME_BG[theme],
        className,
      )}
    >
      <div className="mb-6 flex items-center justify-between border-b border-border-strong/20 pb-4">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "[&>svg]:size-6 [filter:drop-shadow(0_2px_4px_rgba(0,0,0,0.1))]",
              THEME_ICON[theme],
            )}
            aria-hidden
          >
            {icon}
          </span>
          <h2 className="flex items-baseline gap-2 text-[22px] font-extrabold text-brand-dark">
            {title}
            {subtitle && (
              <span
                className={cn("text-[15px] font-bold", THEME_SUBTITLE[theme])}
              >
                {subtitle}
              </span>
            )}
          </h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
