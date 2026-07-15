"use client";

import { BookOpen, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { knowledgeExplanationSchema } from "@/lib/api/schemas";
import { useResource } from "@/lib/query/resource";

import { ContentCard } from "./content-card";

const PROSE_CLASSES = [
  "[&_h1]:text-2xl [&_h1]:font-extrabold [&_h1]:text-brand-dark [&_h1]:mt-2 [&_h1]:mb-5",
  "[&_h2]:text-xl [&_h2]:font-extrabold [&_h2]:text-palette-purple [&_h2]:mt-7 [&_h2]:mb-4 [&_h2]:[text-shadow:0_2px_4px_color-mix(in_oklch,var(--palette-purple)_20%,transparent)]",
  "[&_h3]:text-lg [&_h3]:font-bold [&_h3]:text-palette-purple [&_h3]:mt-6 [&_h3]:mb-3",
  "[&_p]:my-4 [&_p]:leading-[1.8] [&_p]:font-medium [&_p]:text-brand-dark",
  "[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-4",
  "[&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-4",
  "[&_li]:my-1.5 [&_li]:leading-[1.8] [&_li]:text-brand-dark [&_li]:font-medium",
  "[&_strong]:text-brand-deep [&_strong]:font-bold",
  "[&_:not(pre)>code]:px-2 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:bg-[color-mix(in_oklch,var(--palette-purple-light)_40%,transparent)] [&_:not(pre)>code]:text-[var(--code-string-alt)] [&_:not(pre)>code]:rounded-md [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[13px] [&_:not(pre)>code]:border [&_:not(pre)>code]:border-[color-mix(in_oklch,var(--palette-purple)_20%,transparent)]",
  "[&_pre]:bg-white/60 [&_pre]:border [&_pre]:border-[color-mix(in_oklch,var(--palette-purple)_30%,transparent)] [&_pre]:rounded-2xl [&_pre]:p-5 [&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:shadow-[inset_0_2px_4px_color-mix(in_oklch,var(--palette-purple)_10%,transparent)]",
  "[&_pre_code]:font-mono [&_pre_code]:text-[13px] [&_pre_code]:text-brand-dark [&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_table]:my-4 [&_table]:w-full [&_table]:text-sm",
  "[&_th]:border [&_th]:border-border-strong/30 [&_th]:bg-white/40 [&_th]:px-3 [&_th]:py-2 [&_th]:font-bold [&_th]:text-brand-dark",
  "[&_td]:border [&_td]:border-border-strong/30 [&_td]:px-3 [&_td]:py-2 [&_td]:text-brand-dark",
  "[&_a]:text-link-cta [&_a]:underline [&_a]:decoration-link-cta/50 [&_a]:underline-offset-4 hover:[&_a]:text-link-hover",
  "[&_blockquote]:border-l-4 [&_blockquote]:border-palette-purple-light [&_blockquote]:bg-white/40 [&_blockquote]:pl-4 [&_blockquote]:py-2 [&_blockquote]:my-4 [&_blockquote]:text-brand-medium [&_blockquote]:italic",
].join(" ");

export function ExplanationViewer({ id }: { id: number }) {
  const { data, isPending, isError, error } = useResource({
    source: { kind: "explanation", id },
    schema: knowledgeExplanationSchema,
  });

  return (
    <ContentCard
      theme="purple"
      icon={<BookOpen />}
      title="深度解析"
      subtitle="文字化讲解"
    >
      {isPending && (
        <div className="space-y-3 py-2">
          <div className="h-5 w-2/3 animate-pulse rounded bg-white/50" />
          <div className="h-4 w-full animate-pulse rounded bg-white/40" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-white/40" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-white/40" />
        </div>
      )}

      {isError && (
        <p className="rounded-2xl border border-dashed border-destructive/40 bg-destructive/5 px-6 py-8 text-center text-sm text-destructive">
          {error instanceof Error ? error.message : "加载失败"}
        </p>
      )}

      {data?.status === "FAILED" && (
        <p className="rounded-2xl border border-dashed border-destructive/40 bg-destructive/5 px-6 py-8 text-center text-sm text-destructive">
          知识讲解生成失败，请稍后重试
        </p>
      )}

      {data &&
        data.status !== "FAILED" &&
        (data.status !== "FINISHED" || !data.content) && (
          <p className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-palette-purple-light/60 bg-white/40 px-6 py-12 text-sm text-brand-medium">
            <Loader2 className="size-4 animate-spin" />
            知识讲解生成中…
          </p>
        )}

      {data?.status === "FINISHED" && data.content && (
        <article className={PROSE_CLASSES}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {data.content}
          </ReactMarkdown>
        </article>
      )}
    </ContentCard>
  );
}
