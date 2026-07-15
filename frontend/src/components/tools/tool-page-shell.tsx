"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface ToolPageShellProps {
  title: string;
  subtitle: string;
  badge: { icon: ReactNode; label: string };
  children: ReactNode;
  className?: string;
}

export function ToolPageShell({
  title,
  subtitle,
  badge,
  children,
  className,
}: ToolPageShellProps) {
  return (
    <div className={cn("mx-auto flex w-full max-w-[1200px] flex-col gap-10 px-8 py-10 sm:px-12 sm:py-14", className)}>
      <Link
        href="/dashboard"
        className="inline-flex w-fit items-center gap-2 rounded-full border border-white/60 bg-white/70 px-4 py-2 text-sm font-bold text-brand-dark shadow-[var(--shadow-soft)] backdrop-blur transition hover:-translate-y-0.5 hover:bg-white/90 hover:shadow-[var(--shadow-hover)]"
      >
        <ArrowLeft className="size-4" /> 返回主页
      </Link>

      <header className="flex flex-col gap-3">
        <span className="inline-flex w-fit items-center gap-2 rounded-xl bg-gradient-to-br from-palette-yellow-light to-palette-orange-light px-[18px] py-1.5 text-sm font-extrabold tracking-wide text-brand-deep shadow-[0_4px_12px_color-mix(in_oklch,var(--palette-orange)_30%,transparent)]">
          {badge.icon} {badge.label}
        </span>
        <h1 className="bg-gradient-to-br from-brand-dark to-palette-orange bg-clip-text text-4xl font-black leading-tight tracking-tight text-transparent sm:text-5xl">
          {title}
        </h1>
        <p className="max-w-[720px] text-base font-medium leading-[1.7] text-brand-medium">
          {subtitle}
        </p>
      </header>

      {children}
    </div>
  );
}
