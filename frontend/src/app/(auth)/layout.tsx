import type { ReactNode } from "react";
import { KeyRoundIcon } from "lucide-react";

import { AuthCardFooter } from "@/components/auth/auth-card-footer";
import { AuthCardHeader } from "@/components/auth/auth-card-header";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-dvh flex-1 items-center justify-center overflow-hidden px-4 py-12">
      {/* 三色渐变背景 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(135deg, color-mix(in oklch, var(--palette-orange) 35%, transparent) 0%, color-mix(in oklch, var(--palette-yellow) 40%, transparent) 35%, color-mix(in oklch, var(--palette-yellow-mist) 38%, transparent) 55%, color-mix(in oklch, var(--palette-blue-light) 30%, transparent) 100%)",
        }}
      />

      {/* 浮动装饰光斑 */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-30 -right-20 size-112.5 rounded-full bg-palette-orange/20 blur-[80px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-25 -left-15 size-100 rounded-full bg-palette-blue-light/20 blur-[80px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2 size-105 -translate-x-1/2 -translate-y-1/2 rounded-full bg-palette-yellow/25 blur-[80px]"
      />

      {/* 卡片 */}
      <div
        className="relative w-full max-w-120 overflow-hidden rounded-3xl bg-white/85 backdrop-blur-xl"
        style={{ boxShadow: "var(--shadow-soft)" }}
      >
        {/* 顶部三色条 */}
        <div
          aria-hidden
          className="h-1 w-full bg-linear-to-r from-palette-orange via-palette-yellow to-palette-blue-light"
        />

        <div className="flex flex-col gap-6 p-10">
          {/* 品牌图标 */}
          <div
            className="mx-auto flex size-16 items-center justify-center rounded-[20px] bg-linear-to-br from-palette-yellow-lighter to-palette-yellow-light"
            style={{ boxShadow: "var(--shadow-soft)" }}
          >
            <KeyRoundIcon className="size-8 text-brand-gold" />
          </div>

          <AuthCardHeader />

          {children}

          <AuthCardFooter />
        </div>
      </div>
    </main>
  );
}
