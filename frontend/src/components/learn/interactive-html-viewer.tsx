"use client";

import { Box, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { interactiveHtmlSchema, type StudyTaskStatus } from "@/lib/api/schemas";
import { useConfig } from "@/lib/query/config";
import { useResource, type ResourceSource } from "@/lib/query/resource";
import { assetUrl } from "@/lib/storage";

import { ContentCard } from "./content-card";
import {
  ResourceRefreshPending,
  ResourceViewerPlaceholder,
} from "./resource-viewer-placeholder";
import { ResourceGenerateCard } from "./resource-generate-card";

export type InteractiveHtmlViewerSource =
  | { kind: "task"; taskId: number }
  | { kind: "tool"; id: number };

export function InteractiveHtmlViewer({
  source,
  title = "具身交互沙盒",
  subtitle = "全沉浸可交互环境",
  showCard = true,
  taskStatus,
  onLoad,
}: {
  source: InteractiveHtmlViewerSource;
  title?: string;
  subtitle?: string;
  showCard?: boolean;
  taskStatus?: StudyTaskStatus;
  onLoad?: () => void;
}) {
  const { storage } = useConfig();
  const innerSource: ResourceSource =
    source.kind === "task"
      ? { kind: "task", taskId: source.taskId, resourceKind: "interactive-html" }
      : { kind: "tool", resourceKind: "interactive-htmls", id: source.id };

  const { data, isPending, isError, error, refetch } = useResource({
    source: innerSource,
    schema: interactiveHtmlSchema,
  });

  const body = (
    <>
      {isPending && <Placeholder />}

      {isError && !data && (
        <Placeholder>
          <div className="flex flex-col items-center gap-3">
            <ResourceRefreshPending label="互动 HTML" />
            <p className="max-w-md text-xs font-medium text-destructive">
              {error instanceof Error ? error.message : "网络连接异常"}
            </p>
            <Button type="button" size="sm" variant="outline" onClick={() => refetch()}>
              重新加载
            </Button>
          </div>
        </Placeholder>
      )}

      {data?.status === "FAILED" && (
        <Placeholder tone="error">
          <div className="flex flex-col items-center gap-3">
            <p>互动 HTML 生成失败，请重新生成。</p>
            {source.kind === "task" && taskStatus ? (
              <ResourceGenerateCard
                taskId={source.taskId}
                taskStatus={taskStatus}
                kind="interactive-html"
                compact
              />
            ) : null}
          </div>
        </Placeholder>
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
          title="二维交互可视化"
          src={interactiveSource(data.object_key, storage)}
          sandbox="allow-scripts allow-same-origin allow-forms"
          allow="clipboard-write"
          className="h-[min(82vh,860px)] min-h-[640px] w-full rounded-2xl border border-[color-mix(in_oklch,var(--palette-green-light)_50%,transparent)] bg-white"
          onLoad={onLoad}
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

function interactiveSource(objectKey: string, storage: ReturnType<typeof useConfig>["storage"]): string {
  const prefix = "education2d:";
  if (objectKey.startsWith(prefix)) {
    const visualizationId = objectKey.slice(prefix.length);
    return `/education2d/viewer/${encodeURIComponent(visualizationId)}`;
  }
  return assetUrl(objectKey, storage);
}

function Placeholder({
  children,
  tone = "default",
}: {
  children?: ReactNode;
  tone?: "default" | "error";
}) {
  return (
    <ResourceViewerPlaceholder
      theme="green"
      tone={tone}
      icon={
        <Box
          className="size-24 stroke-brand-gold [filter:drop-shadow(0_4px_12px_color-mix(in_oklch,var(--palette-green)_30%,transparent))]"
          strokeWidth={1.5}
        />
      }
    >
      {children}
    </ResourceViewerPlaceholder>
  );
}
