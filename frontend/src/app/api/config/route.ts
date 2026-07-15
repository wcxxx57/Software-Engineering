import { serverFetch } from "@/lib/api/client";
import { publicConfigSchema, type PublicConfig } from "@/lib/api/schemas";
import { proxyJson } from "@/lib/server/proxy";

export async function GET() {
  return proxyJson(() =>
    serverFetch<PublicConfig>("/config", {
      schema: publicConfigSchema,
      skipAuth: true,
    }),
  );
}
