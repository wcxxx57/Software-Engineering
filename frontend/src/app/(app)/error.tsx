"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.error(error);
    }
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-canvas px-6 py-12 text-center">
      <div className="flex size-20 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-10" strokeWidth={1.6} />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-extrabold text-brand-dark">页面加载失败</h2>
        <p className="max-w-md text-sm leading-relaxed text-brand-medium">
          {error.message && /[一-鿿]/.test(error.message)
            ? error.message
            : "数据获取时出了点问题，请重试或回到首页。"}
        </p>
      </div>
      <div className="flex gap-3">
        <Button onClick={() => reset()}>重试</Button>
        <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>
          回到首页
        </Link>
      </div>
    </div>
  );
}
