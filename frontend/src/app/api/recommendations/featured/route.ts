import { serverFetch } from "@/lib/api/client";
import { featuredResourcesSchema, recommendationResourceKind } from "@/lib/api/schemas";
import { proxyJson } from "@/lib/server/proxy";

export async function GET(req: Request) {
  const kind = new URL(req.url).searchParams.get("kind");
  const parsed = recommendationResourceKind.safeParse(kind);
  if (!parsed.success) {
    return Response.json({ message: "Invalid resource kind" }, { status: 400 });
  }
  return proxyJson(() =>
    serverFetch("/recommendations/featured", {
      query: { kind: parsed.data },
      schema: featuredResourcesSchema,
    }),
  );
}
