import { Compass } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-canvas px-6 py-12 text-center">
      <div className="flex size-20 items-center justify-center rounded-full bg-palette-blue-mist text-palette-blue">
        <Compass className="size-10" strokeWidth={1.6} />
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-extrabold text-brand-dark">页面走丢了</h1>
        <p className="max-w-md text-sm leading-relaxed text-brand-medium">
          这里没有可显示的内容。也许链接已失效，或者资源已被移除。
        </p>
      </div>
      <Link href="/dashboard" className={buttonVariants({ variant: "default" })}>
        回到首页
      </Link>
    </div>
  );
}
