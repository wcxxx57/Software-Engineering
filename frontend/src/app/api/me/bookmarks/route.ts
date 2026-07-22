import { serverFetch } from "@/lib/api/client";
import { quizProblemReviewListSchema } from "@/lib/api/schemas";
import { proxyJson } from "@/lib/server/proxy";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() || undefined;

  return proxyJson(() =>
    serverFetch("/me/bookmarks", {
      query: { q },
      schema: quizProblemReviewListSchema,
    }),
  );
}
