"use client";

import { BrainCircuit, Loader2 } from "lucide-react";

import { knowledgeExplanationSchema } from "@/lib/api/schemas";
import { useResource } from "@/lib/query/resource";

import { ContentCard } from "./content-card";
import { MarkmapView } from "./markmap";

export function MarkmapCard({ id }: { id: number }) {
  const { data, isPending, isError, error } = useResource({
    source: { kind: "explanation", id },
    schema: knowledgeExplanationSchema,
  });

  return (
    <ContentCard theme="yellow" icon={<BrainCircuit />} title="知识图谱导航">
      <div
        className="relative h-[500px] overflow-hidden rounded-2xl border-2 border-dashed border-[color-mix(in_oklch,var(--palette-orange-light)_40%,transparent)] bg-palette-yellow-mist shadow-[inset_0_2px_8px_color-mix(in_oklch,var(--palette-yellow)_50%,transparent)]"
      >
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle, color-mix(in oklch, var(--border-muted) 40%, transparent) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
        />
        <div className="relative h-full">
          {isPending && (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-brand-medium">
              <Loader2 className="size-4 animate-spin" />
              加载思维导图…
            </div>
          )}
          {isError && (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-destructive">
              {error instanceof Error ? error.message : "加载失败"}
            </div>
          )}
          {data?.status === "FAILED" && (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-sm font-bold text-destructive">
                深度解析生成失败，暂时无法构建思维导图
              </p>
              <p className="max-w-md text-xs font-medium leading-relaxed text-brand-medium">
                请在下方“深度解析”区域重新生成；导图会在解析内容生成成功后自动显示。
              </p>
            </div>
          )}
          {data &&
            data.status !== "FAILED" &&
            (data.status !== "FINISHED" || !data.content) && (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-brand-medium">
                <Loader2 className="size-4 animate-spin" />
                思维导图生成中…
              </div>
            )}
          {data?.status === "FINISHED" && data.content && (
            <MarkmapView markdown={data.content} />
          )}
        </div>
      </div>
    </ContentCard>
  );
}
