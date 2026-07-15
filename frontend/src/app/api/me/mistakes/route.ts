import { serverFetch } from "@/lib/api/client";
import { quizProblemReviewListSchema } from "@/lib/api/schemas";
import { proxyJson } from "@/lib/server/proxy";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeHidden = url.searchParams.get("include_hidden") === "true";

  return proxyJson(() =>
    serverFetch("/me/mistakes", {
      query: { include_hidden: includeHidden ? "true" : undefined },
      schema: quizProblemReviewListSchema,
    }),
  );
}
