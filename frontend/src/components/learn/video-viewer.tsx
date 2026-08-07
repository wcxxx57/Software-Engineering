"use client";

import { Film, Loader2, Play, Star } from "lucide-react";
import type { ReactNode } from "react";

import { knowledgeVideoSchema } from "@/lib/api/schemas";
import { useConfig } from "@/lib/query/config";
import { useResource, type ResourceSource } from "@/lib/query/resource";
import { assetUrl } from "@/lib/storage";
import { requestJson } from "@/lib/query/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";

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
  allowBookmark = true,
  onPlay,
}: {
  source: VideoViewerSource;
  title?: string;
  subtitle?: string;
  showCard?: boolean;
  allowBookmark?: boolean;
  onPlay?: () => void;
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
  const queryClient = useQueryClient();
  const toggleBookmark = useMutation({
    mutationFn: async () => {
      if (!data) throw new Error("视频尚未加载完成");
      const response = await requestJson(
        `/api/knowledge-videos/${data.id}`,
        { method: "PATCH" },
      );
      return response as { bookmarked: boolean };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me", "bookmarks"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-videos"] });
      queryClient.invalidateQueries({ queryKey: ["task-resource"] });
    },
  });
  const bookmarked = toggleBookmark.data?.bookmarked ?? data?.bookmarked ?? false;
  const canBookmark =
    allowBookmark &&
    data &&
    (source.kind === "task" || source.resourceKind === "knowledge-videos");

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
      {source.kind === "task" && data?.title ? (
        <div className="mb-4 text-lg font-extrabold text-brand-deep">
          {data.title}
        </div>
      ) : null}
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
          onPlay={onPlay}
        />
      )}
    </>
  );

  if (!showCard) {
    return (
      <div className="relative">
        {body}
        {canBookmark ? (
          <button
            type="button"
            onClick={() => toggleBookmark.mutate()}
            disabled={toggleBookmark.isPending}
            aria-label={bookmarked ? "取消收藏视频" : "收藏视频"}
            title={bookmarked ? "取消收藏" : "收藏视频"}
            className="absolute right-3 top-3 inline-flex size-9 items-center justify-center rounded-xl border border-white/70 bg-white/90 text-brand-medium shadow-md backdrop-blur-sm transition hover:-translate-y-px hover:text-palette-orange disabled:opacity-60"
          >
            <Star className={bookmarked ? "size-4 fill-current text-palette-orange" : "size-4"} />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <ContentCard
      theme="blue"
      icon={<Film />}
      title={title}
      subtitle={subtitle}
      action={
        canBookmark ? (
          <button
            type="button"
            onClick={() => toggleBookmark.mutate()}
            disabled={toggleBookmark.isPending}
            aria-label={bookmarked ? "取消收藏视频" : "收藏视频"}
            title={bookmarked ? "取消收藏" : "收藏视频"}
            className="inline-flex size-9 items-center justify-center rounded-xl border border-white/70 bg-white/60 text-brand-medium shadow-sm transition hover:-translate-y-px hover:bg-white/90 hover:text-palette-orange disabled:opacity-60"
          >
            <Star className={bookmarked ? "size-4 fill-current text-palette-orange" : "size-4"} />
          </button>
        ) : null
      }
    >
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
