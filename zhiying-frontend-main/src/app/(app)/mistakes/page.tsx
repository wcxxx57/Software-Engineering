import { redirect } from "next/navigation";

import { MistakesClient } from "@/components/mistakes/mistakes-client";
import { getSession } from "@/lib/auth/session";

export default async function MistakesPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  return <MistakesClient />;
}
