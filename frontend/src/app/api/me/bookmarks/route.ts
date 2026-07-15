import { serverFetch } from "@/lib/api/client";
import { quizProblemReviewListSchema } from "@/lib/api/schemas";
import { proxyJson } from "@/lib/server/proxy";

export async function GET() {
  return proxyJson(() =>
    serverFetch("/me/bookmarks", { schema: quizProblemReviewListSchema }),
  );
}
