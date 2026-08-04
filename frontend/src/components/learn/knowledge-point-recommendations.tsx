"use client";

import { Box, Film, RotateCw, Users } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type {
  RecommendedResource,
  StudyTask,
  TaskRecommendations,
} from "@/lib/api/schemas";
import { useTaskRecommendations } from "@/lib/query/recommendations";

import { ContentCard } from "./content-card";
import { InteractiveHtmlViewer } from "./interactive-html-viewer";
import { ResourceGenerateCard } from "./resource-generate-card";
import { VideoViewer } from "./video-viewer";

type ResourceKind = "knowledge_video" | "interactive_html";

const META: Record<
  ResourceKind,
  {
    title: string;
    subtitle: string;
    theme: "blue" | "green";
  }
> = {
  knowledge_video: {
    title: "沉浸视界",
    subtitle: "知识点视频化解析",
    theme: "blue",
  },
  interactive_html: {
    title: "2D 可视化操作",
    subtitle: "可播放、可编辑的知识图形",
    theme: "green",
  },
};

/**
 * 在原有 K2V 与 2D 卡片中优先呈现可直接使用的推荐资源。
 * C2V 仅在独立工具页展示，不属于知识点任务页。
 */
export function KnowledgePointRecommendations({
  task,
  previewData,
  previewOnly = false,
}: {
  task: StudyTask;
  previewData?: TaskRecommendations;
  previewOnly?: boolean;
}) {
  const { data: queriedData } = useTaskRecommendations(
    task.id,
    previewData == null,
  );
  const recommendations = previewData ?? queriedData;
  const eligible = recommendations?.eligible === true;

  return (
    <>
      <TaskResourceCard
        kind="knowledge_video"
        task={task}
        candidates={eligible ? recommendations.resources.knowledge_video : []}
        previewOnly={previewOnly}
      />
      <TaskResourceCard
        kind="interactive_html"
        task={task}
        candidates={eligible ? recommendations.resources.interactive_html : []}
        previewOnly={previewOnly}
      />
    </>
  );
}

function TaskResourceCard({
  kind,
  task,
  candidates,
  previewOnly,
}: {
  kind: ResourceKind;
  task: StudyTask;
  candidates: RecommendedResource[];
  previewOnly: boolean;
}) {
  const [index, setIndex] = useState(0);
  const recommendation = candidates[index] ?? null;
  const openedCatalogIds = useRef(new Set<number>());
  const recordOpen = useCallback((catalogId: number) => {
    if (previewOnly || openedCatalogIds.current.has(catalogId)) return;
    openedCatalogIds.current.add(catalogId);
    void fetch(`/api/recommendation-resources/${catalogId}/open`, { method: "POST" });
  }, [previewOnly]);
  const hasTaskResource =
    kind === "knowledge_video"
      ? task.knowledge_video_id != null
      : task.interactive_html_id != null;

  if (!hasTaskResource && !recommendation) {
    return (
      <div
        id={
          kind === "knowledge_video"
            ? "knowledge-video-generate"
            : "interactive-html-generate"
        }
        className="scroll-mt-24"
      >
        <ResourceGenerateCard
          taskId={task.id}
          taskStatus={task.status}
          kind={kind === "knowledge_video" ? "knowledge-video" : "interactive-html"}
          previewOnly={previewOnly}
        />
      </div>
    );
  }

  const meta = META[kind];
  return (
    <div
      id={kind === "knowledge_video" ? "knowledge-video" : "interactive-html"}
      className="scroll-mt-24"
    >
      <ContentCard
        theme={meta.theme}
        icon={kind === "knowledge_video" ? <Film /> : <Box />}
        title={meta.title}
        subtitle={meta.subtitle}
      >
        {recommendation && !hasTaskResource ? (
          <RecommendationDetails
            resource={recommendation}
            canRotate={candidates.length > 1}
            onRotate={() =>
              setIndex((current) => (current + 1) % candidates.length)
            }
          />
        ) : null}
        {previewOnly && recommendation && !hasTaskResource ? (
          <div className="flex aspect-video items-center justify-center rounded-2xl border border-white/70 bg-white/45 text-sm font-bold text-brand-medium">
            {kind === "knowledge_video" ? "视频播放区域" : "可操控 2D 区域"}
          </div>
        ) : kind === "knowledge_video" ? (
          <VideoViewer
            source={
              hasTaskResource
                ? { kind: "task", taskId: task.id }
                : { kind: "tool", resourceKind: "knowledge-videos", id: recommendation!.id }
            }
            showCard={false}
            allowBookmark={hasTaskResource}
            onPlay={recommendation && !hasTaskResource ? () => recordOpen(recommendation.catalog_id) : undefined}
          />
        ) : (
          <InteractiveHtmlViewer
            source={
              hasTaskResource
                ? { kind: "task", taskId: task.id }
                : { kind: "tool", id: recommendation!.id }
            }
            showCard={false}
            taskStatus={hasTaskResource ? task.status : undefined}
            onLoad={recommendation && !hasTaskResource ? () => recordOpen(recommendation.catalog_id) : undefined}
          />
        )}
        <div className="mt-5 flex flex-wrap items-center gap-3 text-sm font-semibold text-brand-medium">
          <span>觉得内容不合适？</span>
          <ResourceGenerateCard
            taskId={task.id}
            taskStatus={task.status}
            kind={
              kind === "knowledge_video"
                ? "knowledge-video"
                : "interactive-html"
            }
            compact
            previewOnly={previewOnly}
          />
        </div>
      </ContentCard>
    </div>
  );
}

function RecommendationDetails({
  resource,
  canRotate,
  onRotate,
}: {
  resource: RecommendedResource;
  canRotate: boolean;
  onRotate: () => void;
}) {
  return (
    <div className="mb-5 flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-extrabold text-brand-deep">{resource.title}</h3>
        </div>
        {canRotate ? (
          <Button variant="outline" className="rounded-full" onClick={onRotate}>
            <RotateCw className="size-4" /> 换一个
          </Button>
        ) : null}
      </div>
      {resource.reasons.map((reason) => (
        <p key={reason} className="text-sm font-semibold text-brand-dark">
          推荐给你：{reason}
        </p>
      ))}
      {resource.learner_count != null ? (
        <p className="flex items-center gap-1.5 text-sm font-semibold text-brand-medium">
          <Users className="size-4" /> 已有 {resource.learner_count} 位学习者学习过
        </p>
      ) : null}
    </div>
  );
}
