"use client";

import { Box, Code2, Film, Package } from "lucide-react";

import { ToolCard } from "@/components/tools/tool-card";
import type { FeaturedResource, RecommendationResourceKind } from "@/lib/api/schemas";
import { useConfig } from "@/lib/query/config";
import { useFeaturedResources } from "@/lib/query/recommendations";
import { assetUrl } from "@/lib/storage";

const META = {
  "knowledge-video": { icon: Film },
  "code-video": { icon: Code2 },
  "interactive-html": { icon: Box },
} as const;

export function FeaturedResourceSection({ kind, onOpen, previewData, userId }: { kind: RecommendationResourceKind; onOpen: (resource: FeaturedResource) => void; previewData?: FeaturedResource[]; userId?: number | null }) {
  const { storage } = useConfig();
  const { data: queriedData = [] } = useFeaturedResources(kind, userId, previewData == null);
  const data = previewData ?? queriedData;
  const meta = META[kind];
  const Icon = meta.icon;
  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-extrabold text-brand-dark">
          精品推荐
          <span className="ml-2 rounded-full bg-palette-orange-lighter px-2.5 py-0.5 text-xs font-bold text-palette-orange">
            {data.length}
          </span>
        </h2>
      </div>
      {data.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-border/30 bg-white/50 px-8 py-16 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-palette-yellow-light text-palette-orange">
            <Package className="size-9" strokeWidth={1.6} />
          </div>
          <p className="max-w-md text-sm font-medium text-brand-medium">
            暂时没有可展示的精品推荐内容。
          </p>
        </div>
      ) : (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-8">
        {data.map((item, index) => (
          <ToolCard
            key={item.catalog_id}
            title={item.title}
            status="FINISHED"
            colorIndex={index}
            thumbnailIcon={<Icon strokeWidth={1.75} />}
            thumbnailUrl={kind !== "interactive-html" && item.object_key ? assetUrl(item.object_key, storage) : undefined}
            onClick={() => onOpen(item)}
            onDelete={() => undefined}
            showDelete={false}
            showStatus={false}
          />
        ))}
      </div>
      )}
    </section>
  );
}
