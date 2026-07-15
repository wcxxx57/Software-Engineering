"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const SUBTITLES: Record<string, string> = {
  "/login": "欢迎回来，继续你的学习旅程",
  "/register": "创建账号，开启智能学习之旅",
};

export function AuthCardHeader() {
  const pathname = usePathname();
  const isLogin = pathname !== "/register";
  const subtitle = SUBTITLES[pathname] ?? SUBTITLES["/login"];

  return (
    <>
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-extrabold tracking-tight text-brand-deep">
          智映通学
        </h1>
        <p className="text-sm text-brand-dark">{subtitle}</p>
      </div>

      <div
        className="relative grid grid-cols-2 gap-1 rounded-full bg-canvas p-1"
        style={{ boxShadow: "var(--shadow-inner)" }}
      >
        <span
          aria-hidden
          className={cn(
            "absolute top-1 h-[calc(100%-0.5rem)] w-[calc(50%-0.375rem)] rounded-full bg-linear-to-br from-palette-orange-light to-palette-orange transition-[left] duration-300 ease-out",
            isLogin ? "left-1" : "left-[calc(50%+0.125rem)]",
          )}
          style={{
            boxShadow:
              "0 2px 8px color-mix(in oklch, var(--palette-orange) 35%, transparent)",
          }}
        />
        <Link
          href="/login"
          className={cn(
            "relative z-10 flex h-10 items-center justify-center rounded-full text-sm font-semibold transition-colors",
            isLogin
              ? "text-white"
              : "text-brand-medium hover:text-brand-dark",
          )}
        >
          登录
        </Link>
        <Link
          href="/register"
          className={cn(
            "relative z-10 flex h-10 items-center justify-center rounded-full text-sm font-semibold transition-colors",
            !isLogin
              ? "text-white"
              : "text-brand-medium hover:text-brand-dark",
          )}
        >
          注册
        </Link>
      </div>
    </>
  );
}
