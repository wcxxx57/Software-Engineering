"use client";

import { Box, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import { interactiveHtmlSchema } from "@/lib/api/schemas";
import { useConfig } from "@/lib/query/config";
import { useResource, type ResourceSource } from "@/lib/query/resource";
import { assetUrl } from "@/lib/storage";

import { ContentCard } from "./content-card";

export type InteractiveHtmlViewerSource =
  | { kind: "task"; taskId: number }
  | { kind: "tool"; id: number };

export function InteractiveHtmlViewer({
  source,
  title = "具身交互沙盒",
  subtitle = "全沉浸可交互环境",
  showCard = true,
}: {
  source: InteractiveHtmlViewerSource;
  title?: string;
  subtitle?: string;
  showCard?: boolean;
}) {
  const { storage } = useConfig();
  const innerSource: ResourceSource =
    source.kind === "task"
      ? { kind: "task", taskId: source.taskId, resourceKind: "interactive-html" }
      : { kind: "tool", resourceKind: "interactive-htmls", id: source.id };

  const { data, isPending, isError, error } = useResource({
    source: innerSource,
    schema: interactiveHtmlSchema,
  });

  const body = (
    <>
      {isPending && <Placeholder />}

      {isError && (
        <Placeholder tone="error">
          {error instanceof Error ? error.message : "加载失败"}
        </Placeholder>
      )}

      {data?.status === "FAILED" && (
        <Placeholder tone="error">互动 HTML 生成失败，请稍后重试</Placeholder>
      )}

      {data &&
        data.status !== "FAILED" &&
        (data.status !== "FINISHED" || !data.object_key) && (
          <Placeholder>
            <div className="flex items-center gap-2 text-sm font-bold text-brand-medium">
              <Loader2 className="size-4 animate-spin" />
              互动 HTML 生成中…
            </div>
          </Placeholder>
        )}

      {data?.status === "FINISHED" && data.object_key && (
        <iframe
          title="interactive-html"
          src={assetUrl(data.object_key, storage)}
          sandbox="allow-scripts"
          className="aspect-video w-full rounded-2xl border border-[color-mix(in_oklch,var(--palette-green-light)_50%,transparent)] bg-white"
        />
      )}
    </>
  );

  if (!showCard) return body;

  return (
    <ContentCard theme="green" icon={<Box />} title={title} subtitle={subtitle}>
      {body}
    </ContentCard>
  );
}

function Placeholder({
  children,
  tone = "default",
}: {
  children?: ReactNode;
  tone?: "default" | "error";
}) {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-[color-mix(in_oklch,var(--palette-green-light)_50%,transparent)] bg-gradient-to-br from-palette-green-lighter to-palette-green-mist shadow-[inset_0_2px_8px_rgba(0,0,0,0.05)]">
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.4)_0%,transparent_60%)]"
      />
      <div className="relative flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        {tone === "default" ? (
          <Box
            className="size-24 stroke-brand-gold [filter:drop-shadow(0_4px_12px_color-mix(in_oklch,var(--palette-green)_30%,transparent))]"
            strokeWidth={1.5}
          />
        ) : (
          <p className="text-sm font-semibold text-destructive">{children}</p>
        )}
        {tone === "default" && children}
      </div>
    </div>
  );
}
