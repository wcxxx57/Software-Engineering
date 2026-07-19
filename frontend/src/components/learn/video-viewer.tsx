"use client";

import { Film, Loader2, Play } from "lucide-react";
import type { ReactNode } from "react";

import { knowledgeVideoSchema } from "@/lib/api/schemas";
import { useConfig } from "@/lib/query/config";
import { useResource, type ResourceSource } from "@/lib/query/resource";
import { assetUrl } from "@/lib/storage";

import { ContentCard } from "./content-card";
import { ResourceGenerateCard } from "./resource-generate-card";
import {
  ResourceRefreshPending,
  ResourceViewerPlaceholder,
} from "./resource-viewer-placeholder";

export type VideoViewerSource =
  | { kind: "task"; taskId: number }
  | { kind: "tool"; resourceKind: "knowledge-videos" | "code-videos"; id: number };

export function VideoViewer({
  source,
  title = "沉浸视界",
  subtitle = "知识点视频化解析",
  showCard = true,
}: {
  source: VideoViewerSource;
  title?: string;
  subtitle?: string;
  showCard?: boolean;
}) {
  const { storage } = useConfig();
  const innerSource: ResourceSource =
    source.kind === "task"
      ? { kind: "task", taskId: source.taskId, resourceKind: "knowledge-video" }
      : { kind: "tool", resourceKind: source.resourceKind, id: source.id };

  const { data, isPending, isError } = useResource({
    source: innerSource,
    schema: knowledgeVideoSchema,
  });

  if (data?.status === "FAILED" && source.kind === "task") {
    return (
      <ResourceGenerateCard
        taskId={source.taskId}
        taskStatus="STUDYING"
        kind="knowledge-video"
      />
    );
  }

  const body = (
    <>
      {isPending && <Placeholder />}

      {isError && !data && (
        <Placeholder>
          <ResourceRefreshPending label="视频" />
        </Placeholder>
      )}

      {data?.status === "FAILED" && (
        <Placeholder tone="error">视频生成失败，请稍后重试</Placeholder>
      )}

      {data &&
        data.status !== "FAILED" &&
        (data.status !== "FINISHED" || !data.object_key) && (
          <Placeholder>
            <div className="flex items-center gap-2 text-sm font-bold text-brand-medium">
              <Loader2 className="size-4 animate-spin" />
              视频生成中…
            </div>
          </Placeholder>
        )}

      {data?.status === "FINISHED" && data.object_key && (
        <video
          controls
          className="aspect-video w-full rounded-2xl border border-[color-mix(in_oklch,var(--palette-blue-light)_30%,transparent)] bg-gradient-to-br from-palette-blue-lighter to-palette-blue-mist shadow-[inset_0_2px_8px_rgba(0,0,0,0.05)]"
          src={assetUrl(data.object_key, storage)}
        />
      )}
    </>
  );

  if (!showCard) return body;

  return (
    <ContentCard theme="blue" icon={<Film />} title={title} subtitle={subtitle}>
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
    <ResourceViewerPlaceholder
      theme="blue"
      tone={tone}
      icon={
        <Play
          className="size-24 stroke-brand-gold [filter:drop-shadow(0_4px_12px_color-mix(in_oklch,var(--brand-gold)_30%,transparent))]"
          strokeWidth={1.5}
          fill="none"
        />
      }
    >
      {children}
    </ResourceViewerPlaceholder>
  );
}
