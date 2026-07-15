"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function AuthCardFooter() {
  const pathname = usePathname();
  const isLogin = pathname !== "/register";

  return (
    <>
      <div className="flex items-center gap-4">
        <span className="h-px flex-1 bg-linear-to-r from-transparent via-brand-light/30 to-transparent" />
        <span className="text-xs text-brand-medium">or</span>
        <span className="h-px flex-1 bg-linear-to-l from-transparent via-brand-light/30 to-transparent" />
      </div>

      <p className="text-center text-sm text-brand-dark">
        {isLogin ? (
          <>
            还没有账号？{" "}
            <Link
              href="/register"
              className="font-semibold text-link-cta transition-colors hover:text-link-hover hover:underline"
            >
              立即注册
            </Link>
          </>
        ) : (
          <>
            已有账号？{" "}
            <Link
              href="/login"
              className="font-semibold text-link-cta transition-colors hover:text-link-hover hover:underline"
            >
              立即登录
            </Link>
          </>
        )}
      </p>
    </>
  );
}
