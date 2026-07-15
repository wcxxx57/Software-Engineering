import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getSession } from "@/lib/auth/session";

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getSession();
  if (!user) redirect("/login");

  return <div className="min-h-dvh w-full bg-canvas">{children}</div>;
}
