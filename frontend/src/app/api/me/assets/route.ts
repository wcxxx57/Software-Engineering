import { serverFetch } from "@/lib/api/client";
import {
  assetOverviewSchema,
  type AssetOverview,
} from "@/lib/api/schemas";
import { proxyJson } from "@/lib/server/proxy";

export async function GET() {
  return proxyJson(() =>
    serverFetch<AssetOverview>("/me/assets", { schema: assetOverviewSchema }),
  );
}
