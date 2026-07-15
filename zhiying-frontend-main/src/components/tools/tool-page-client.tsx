"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Package } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { ToolCard } from "@/components/tools/tool-card";
import { ToolConsole, type ToolConsoleMode } from "@/components/tools/tool-console";
import {
  ToolResultPlayer,
  type ToolFocusKind,
} from "@/components/tools/tool-result-player";
import { meQueryKey } from "@/lib/query/keys";
import { useMe } from "@/lib/query/me";
import { getJson } from "@/lib/query/utils";

import type { ReactNode } from "react";

type ResourceStatus = "QUEUING" | "GENERATING" | "FINISHED" | "FAILED";

export interface ToolResource {
  id: number;
  status: ResourceStatus;
  prompt: string;
  object_key: string | null;
  created_at: number;
}

export interface ToolPageClientProps<T extends ToolResource> {
  initialList: T[];
  listEndpoint: string;
  createAction: (
    prompt: string,
  ) => Promise<{ ok: true; data: T } | { ok: false; message: string }>;
  deleteAction: (
    id: number,
  ) => Promise<
    { ok: true; data?: unknown } | { ok: false; message: string }
  >;
  consoleTitle: string;
  consoleMode: ToolConsoleMode;
  currency: "diamond" | "gold";
  cost: number;
  detailKind: ToolFocusKind;
  cardThumbnailIcon?: ReactNode;
  emptyHint: string;
  primaryCtaLabel: string;
}

export function ToolPageClient<T extends ToolResource>({
  initialList,
  listEndpoint,
  createAction,
  deleteAction,
  consoleTitle,
  consoleMode,
  currency,
  cost,
  detailKind,
  cardThumbnailIcon,
  emptyHint,
  primaryCtaLabel,
}: ToolPageClientProps<T>) {
  const me = useMe();
  const balance = me ? (currency === "diamond" ? me.diamond : me.gold) : 0;
  const qc = useQueryClient();

  const [focusId, setFocusId] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const playerRef = useRef<HTMLDivElement | null>(null);

  const { data: list = initialList } = useQuery<T[]>({
    queryKey: ["tool-list", listEndpoint] as const,
    queryFn: async () => (await getJson(listEndpoint)) as T[],
    initialData: initialList,
    refetchInterval: (query) => {
      const items = query.state.data;
      if (!items) return 2000;
      const inflight = items.some(
        (it) => it.status === "QUEUING" || it.status === "GENERATING",
      );
      return inflight ? 2000 : false;
    },
    staleTime: 0,
  });

  // 默认焦点：列表里最新的一条
  useEffect(() => {
    if (focusId == null && list.length > 0) {
      setFocusId(list[0].id);
    }
  }, [list, focusId]);

  const focusItem = useMemo(
    () => list.find((it) => it.id === focusId) ?? null,
    [list, focusId],
  );

  function scrollToPlayer() {
    if (typeof window === "undefined") return;
    requestAnimationFrame(() => {
      playerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  const handleCreateSuccess = (id: number) => {
    setFocusId(id);
    qc.invalidateQueries({ queryKey: ["tool-list", listEndpoint] });
    qc.invalidateQueries({ queryKey: meQueryKey });
    scrollToPlayer();
  };

  const handleDelete = (id: number) => {
    setPendingDeleteId(id);
    startTransition(async () => {
      const result = await deleteAction(id);
      setPendingDeleteId(null);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("已从工具画廊移除");
      if (focusId === id) setFocusId(null);
      qc.invalidateQueries({ queryKey: ["tool-list", listEndpoint] });
    });
  };

  return (
    <>
      <ToolConsole
        title={consoleTitle}
        mode={consoleMode}
        currency={currency}
        cost={cost}
        currentBalance={balance}
        primaryCtaLabel={primaryCtaLabel}
        onSubmit={async (prompt) => {
          const result = await createAction(prompt);
          if (!result.ok) return result;
          return { ok: true, id: result.data.id };
        }}
        onSuccess={handleCreateSuccess}
      />

      <div ref={playerRef}>
        <ToolResultPlayer
          detailKind={detailKind}
          focusId={focusItem?.id ?? null}
          prompt={focusItem?.prompt ?? null}
        />
      </div>

      <section className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-extrabold text-brand-dark">
            生成历史
            <span className="ml-2 rounded-full bg-palette-orange-lighter px-2.5 py-0.5 text-xs font-bold text-palette-orange">
              {list.length}
            </span>
          </h3>
        </div>

        {list.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-border/30 bg-white/50 px-8 py-16 text-center">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-palette-yellow-light text-palette-orange">
              <Package className="size-9" strokeWidth={1.6} />
            </div>
            <p className="max-w-md text-sm font-medium text-brand-medium">
              {emptyHint}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-8">
            {list.map((item, index) => (
              <ToolCard
                key={item.id}
                title={titleFromPrompt(item.prompt)}
                status={item.status}
                colorIndex={index}
                thumbnailIcon={cardThumbnailIcon}
                active={item.id === focusId}
                onClick={() => {
                  setFocusId(item.id);
                  scrollToPlayer();
                }}
                onDelete={() => handleDelete(item.id)}
                deleting={pendingDeleteId === item.id}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function titleFromPrompt(prompt: string): string {
  const lines = prompt.split("\n");
  // 跳过 markdown header（# 题目 等），取第一条实质内容
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const cleaned = line.replace(/^#+\s*/, "").trim();
    if (!cleaned) continue;
    if (cleaned === "题目" || cleaned === "核心代码") continue;
    return cleaned.length > 30 ? cleaned.slice(0, 30) + "…" : cleaned;
  }
  return "未命名";
}
