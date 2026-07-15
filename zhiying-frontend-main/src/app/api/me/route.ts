import { serverFetch } from "@/lib/api/client";
import { userSchema, type User } from "@/lib/api/schemas";
import { proxyJson } from "@/lib/server/proxy";

export async function GET() {
  return proxyJson(() =>
    serverFetch<User>("/me", { schema: userSchema }),
  );
}
