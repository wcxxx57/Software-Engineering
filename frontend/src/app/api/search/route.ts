import { z } from "zod";

import { serverFetch } from "@/lib/api/client";
import {
  codeVideoSchema,
  interactiveHtmlSchema,
  knowledgeVideoSchema,
  quizProblemReviewListSchema,
  studySubjectListSchema,
  type CodeVideo,
  type InteractiveHtml,
  type KnowledgeVideo,
  type QuizProblemReview,
  type StudySubject,
} from "@/lib/api/schemas";
import { proxyJson } from "@/lib/server/proxy";

const LIMIT = 5;

const SCOPES = [
  "all",
  "subjects",
  "knowledge_videos",
  "code_videos",
  "interactive_htmls",
  "mistakes",
] as const;
type Scope = (typeof SCOPES)[number];

const kvListSchema = z.array(knowledgeVideoSchema);
const cvListSchema = z.array(codeVideoSchema);
const ihListSchema = z.array(interactiveHtmlSchema);

type SearchResults = {
  subjects: StudySubject[];
  knowledge_videos: KnowledgeVideo[];
  code_videos: CodeVideo[];
  interactive_htmls: InteractiveHtml[];
  mistakes: QuizProblemReview[];
};

const EMPTY_RESULTS: SearchResults = {
  subjects: [],
  knowledge_videos: [],
  code_videos: [],
  interactive_htmls: [],
  mistakes: [],
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const scopeParam = url.searchParams.get("scope") as Scope | null;
  const scope: Scope = SCOPES.includes(scopeParam as Scope)
    ? (scopeParam as Scope)
    : "all";

  return proxyJson<SearchResults>(async () => {
    if (!q) return EMPTY_RESULTS;

    const want = (s: Scope) => scope === "all" || scope === s;

    const [subjects, kv, cv, ih, mistakes] = await Promise.all([
      want("subjects")
        ? serverFetch<StudySubject[]>("/study-subjects", {
            query: { q },
            schema: studySubjectListSchema,
          })
        : Promise.resolve([] as StudySubject[]),
      want("knowledge_videos")
        ? serverFetch<KnowledgeVideo[]>("/knowledge-videos", {
            query: { q },
            schema: kvListSchema,
          })
        : Promise.resolve([] as KnowledgeVideo[]),
      want("code_videos")
        ? serverFetch<CodeVideo[]>("/code-videos", {
            query: { q },
            schema: cvListSchema,
          })
        : Promise.resolve([] as CodeVideo[]),
      want("interactive_htmls")
        ? serverFetch<InteractiveHtml[]>("/interactive-htmls", {
            query: { q },
            schema: ihListSchema,
          })
        : Promise.resolve([] as InteractiveHtml[]),
      want("mistakes")
        ? serverFetch<QuizProblemReview[]>("/me/mistakes", {
            query: { q },
            schema: quizProblemReviewListSchema,
          })
        : Promise.resolve([] as QuizProblemReview[]),
    ]);

    const cap = scope === "all" ? LIMIT : 20;

    return {
      subjects: subjects.slice(0, cap),
      knowledge_videos: kv.slice(0, cap),
      code_videos: cv.slice(0, cap),
      interactive_htmls: ih.slice(0, cap),
      mistakes: mistakes.slice(0, cap),
    };
  });
}
