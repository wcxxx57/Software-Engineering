"use client";

import { Box, Film, RotateCw, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

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
    title: "知识视频",
    subtitle: "知识点视频讲解",
    theme: "blue",
  },
  interactive_html: {
    title: "2D 交互",
    subtitle: "知识点可操作演示",
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
  const { data: queriedData, isFetching: recommendationsFetching } = useTaskRecommendations(
    task.id,
    previewData == null,
  );
  // Do not render a cached candidate while the current task recommendation
  // response is being refreshed. This is important for the local demo where
  // a candidate can be deliberately hidden for rec_p1 after the old page was
  // already open in the browser.
  const recommendations =
    previewData ?? (recommendationsFetching ? undefined : queriedData);
  const eligible = recommendations?.eligible === true;
  const recommendationsLoaded = recommendations != null;

  useEffect(() => {
    const debug = recommendations?.recommendation_debug;
    if (!debug || typeof window === "undefined") return;
    const printRows = (kind: string, rows: typeof debug.knowledge_video) =>
      rows.map((row) => ({
        kind,
        rank: row.rank,
        selected: row.selected,
        title: row.title,
        rank_score: Number(row.rank_score.toFixed(4)),
        similarity_score: Number(row.similarity_score.toFixed(4)),
        popularity_score: Number(row.popularity_score.toFixed(4)),
        learner_count: row.learner_count,
        catalog_id: row.catalog_id,
      }));
    const rows = [
      ...printRows("knowledge_video", debug.knowledge_video),
      ...printRows("interactive_html", debug.interactive_html),
    ];
    console.groupCollapsed(
      `[推荐排序] task=${task.id}，展示前 ${debug.limit} 个候选`,
    );
    console.info(`计算公式：${debug.scoring_formula}`);
    console.table(rows);
    console.groupEnd();
  }, [recommendations, task.id]);

  return (
    <>
      <TaskResourceCard
        kind="knowledge_video"
        task={task}
        candidates={eligible ? recommendations.resources.knowledge_video : []}
        emptyRecommendation={
          recommendationsLoaded && eligible && recommendations.resources.knowledge_video.length === 0
        }
        previewOnly={previewOnly}
      />
      <TaskResourceCard
        kind="interactive_html"
        task={task}
        candidates={eligible ? recommendations.resources.interactive_html : []}
        emptyRecommendation={
          recommendationsLoaded && eligible && recommendations.resources.interactive_html.length === 0
        }
        previewOnly={previewOnly}
      />
    </>
  );
}

function TaskResourceCard({
  kind,
  task,
  candidates,
  emptyRecommendation,
  previewOnly,
}: {
  kind: ResourceKind;
  task: StudyTask;
  candidates: RecommendedResource[];
  emptyRecommendation: boolean;
  previewOnly: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [displayMode, setDisplayMode] = useState<"recommended" | "mine">(
    "recommended",
  );
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
  const hasBothSources = hasTaskResource && recommendation != null;
  const showingRecommendation =
    displayMode === "recommended" && recommendation != null;
  const activeRecommendation = showingRecommendation ? recommendation : null;

  if (!hasTaskResource && !recommendation) {
    return (
      <div
        id={kind === "knowledge_video" ? "knowledge-video" : "interactive-html"}
        className="scroll-mt-24"
      >
        <ResourceGenerateCard
          taskId={task.id}
          taskStatus={task.status}
          kind={kind === "knowledge_video" ? "knowledge-video" : "interactive-html"}
          emptyRecommendation={emptyRecommendation}
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
        {hasBothSources ? (
          <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-white/70 bg-white/45 p-1.5 shadow-[inset_0_1px_3px_rgba(0,0,0,0.04)]">
            <Button
              type="button"
              size="sm"
              variant={showingRecommendation ? "default" : "ghost"}
              className="rounded-xl px-4"
              onClick={() => setDisplayMode("recommended")}
            >
              推荐内容
            </Button>
            <Button
              type="button"
              size="sm"
              variant={!showingRecommendation ? "default" : "ghost"}
              className="rounded-xl px-4"
              onClick={() => setDisplayMode("mine")}
            >
              我生成的
            </Button>
          </div>
        ) : null}
        {activeRecommendation ? (
          <RecommendationDetails
            kind={kind}
            resource={activeRecommendation}
            canRotate={candidates.length > 1}
            position={index + 1}
            total={candidates.length}
            onRotate={() =>
              setIndex((current) => (current + 1) % candidates.length)
            }
          />
        ) : null}
        {previewOnly && activeRecommendation ? (
          <div className="flex aspect-video items-center justify-center rounded-2xl border border-white/70 bg-white/45 text-sm font-bold text-brand-medium">
            {kind === "knowledge_video" ? "视频播放区域" : "可操作 2D 区域"}
          </div>
        ) : kind === "knowledge_video" ? (
          <VideoViewer
            source={
              !showingRecommendation && hasTaskResource
                ? { kind: "task", taskId: task.id }
                : { kind: "tool", resourceKind: "knowledge-videos", id: activeRecommendation!.id }
            }
            showCard={false}
            allowBookmark={!showingRecommendation}
            onPlay={activeRecommendation ? () => recordOpen(activeRecommendation.catalog_id) : undefined}
          />
        ) : (
          <InteractiveHtmlViewer
            source={
              !showingRecommendation && hasTaskResource
                ? { kind: "task", taskId: task.id }
                : { kind: "tool", id: activeRecommendation!.id }
            }
            showCard={false}
            taskStatus={!showingRecommendation && hasTaskResource ? task.status : undefined}
            onLoad={activeRecommendation ? () => recordOpen(activeRecommendation.catalog_id) : undefined}
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
  kind,
  resource,
  canRotate,
  position,
  total,
  onRotate,
}: {
  kind: ResourceKind;
  resource: RecommendedResource;
  canRotate: boolean;
  position: number;
  total: number;
  onRotate: () => void;
}) {
  return (
    <div className="mb-5 flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-extrabold text-brand-deep">{resource.title}</h3>
        </div>
        <div className="flex items-center gap-2">
          {total > 1 ? (
            <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-extrabold text-brand-medium">
              {position}/{total}
            </span>
          ) : null}
          {canRotate ? (
            <Button variant="outline" className="rounded-full" onClick={onRotate}>
              <RotateCw className="size-4" /> 换一个
            </Button>
          ) : null}
        </div>
      </div>
      {resource.reasons.map((reason) => (
        <p key={reason} className="text-sm font-semibold text-brand-dark">
          推荐给你：{reason}
        </p>
      ))}
      {resource.learner_count != null ? (
        <p className="flex items-center gap-1.5 text-sm font-semibold text-brand-medium">
          <Users className="size-4" /> {kind === "knowledge_video" ? "播放" : "被学习"} {resource.learner_count} 次
        </p>
      ) : null}
    </div>
  );
}
