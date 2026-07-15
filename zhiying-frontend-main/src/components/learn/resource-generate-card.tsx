"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Box, Coins, Film, Gem, Sparkles } from "lucide-react";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import {
  createInteractiveHtmlAction,
  createKnowledgeVideoAction,
} from "@/app/(learn)/tasks/[id]/actions";
import { SpendConfirmDialog } from "@/components/spend-confirm-dialog";
import { Button } from "@/components/ui/button";
import type { StudyTaskStatus } from "@/lib/api/schemas";
import { useConfig } from "@/lib/query/config";
import { meQueryKey } from "@/lib/query/keys";
import { useMe } from "@/lib/query/me";

import { ContentCard, type ContentCardTheme } from "./content-card";

type Kind = "knowledge-video" | "interactive-html";

type KindMeta = {
  theme: ContentCardTheme;
  title: string;
  subtitle: string;
  icon: ReactNode;
  tagline: string;
  innerBorder: string;
  innerBg: string;
  innerShadow: string;
  iconShadow: string;
  currency: "diamond" | "gold";
  currencyIcon: ReactNode;
};

const META: Record<Kind, KindMeta> = {
  "knowledge-video": {
    theme: "blue",
    title: "沉浸视界",
    subtitle: "知识点视频化解析",
    icon: <Film />,
    tagline: "AI 将基于本任务自动生成讲解视频",
    innerBorder:
      "border border-[color-mix(in_oklch,var(--palette-blue-light)_30%,transparent)]",
    innerBg: "bg-gradient-to-br from-palette-blue-lighter to-palette-blue-mist",
    innerShadow: "shadow-[inset_0_2px_8px_rgba(0,0,0,0.05)]",
    iconShadow:
      "[filter:drop-shadow(0_4px_12px_color-mix(in_oklch,var(--palette-blue)_30%,transparent))]",
    currency: "diamond",
    currencyIcon: <Gem className="size-4" strokeWidth={2.2} />,
  },
  "interactive-html": {
    theme: "green",
    title: "具身交互沙盒",
    subtitle: "全沉浸可交互环境",
    icon: <Box />,
    tagline: "AI 将基于本任务自动搭建交互场景",
    innerBorder:
      "border border-[color-mix(in_oklch,var(--palette-green-light)_50%,transparent)]",
    innerBg:
      "bg-gradient-to-br from-palette-green-lighter to-palette-green-mist",
    innerShadow: "shadow-[inset_0_2px_8px_rgba(0,0,0,0.05)]",
    iconShadow:
      "[filter:drop-shadow(0_4px_12px_color-mix(in_oklch,var(--palette-green)_30%,transparent))]",
    currency: "gold",
    currencyIcon: <Coins className="size-4" strokeWidth={2.2} />,
  },
};

export function ResourceGenerateCard({
  taskId,
  taskStatus,
  kind,
}: {
  taskId: number;
  taskStatus: StudyTaskStatus;
  kind: Kind;
}) {
  const meta = META[kind];
  const config = useConfig();
  const me = useMe();
  const queryClient = useQueryClient();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const amount =
    kind === "knowledge-video"
      ? config.resource.knowledge_video_diamond_cost
      : config.resource.interactive_html_gold_cost;
  const balance =
    kind === "knowledge-video" ? (me?.diamond ?? 0) : (me?.gold ?? 0);
  const locked = taskStatus === "LOCKED";
  const submitDisabled = locked || isPending;

  const onConfirm = () => {
    startTransition(async () => {
      const action =
        kind === "knowledge-video"
          ? createKnowledgeVideoAction
          : createInteractiveHtmlAction;
      const result = await action(taskId);
      if (result.ok) {
        toast.success("已加入生成队列，请稍候");
        queryClient.invalidateQueries({ queryKey: meQueryKey });
        setConfirmOpen(false);
      } else {
        toast.error(result.message);
      }
    });
  };

  return (
    <ContentCard
      theme={meta.theme}
      icon={meta.icon}
      title={meta.title}
      subtitle={meta.subtitle}
    >
      <div
        className={`relative overflow-hidden rounded-2xl ${meta.innerBorder} ${meta.innerBg} ${meta.innerShadow}`}
      >
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.4)_0%,transparent_60%)]"
        />
        <div className="relative flex flex-col items-center gap-4 px-6 py-10 text-center">
          <Sparkles
            className={`size-14 stroke-brand-gold ${meta.iconShadow}`}
            strokeWidth={1.6}
          />
          <p className="text-sm font-bold text-brand-medium">{meta.tagline}</p>
          <Button
            type="button"
            disabled={submitDisabled}
            onClick={() => setConfirmOpen(true)}
            className="inline-flex items-center gap-2 bg-gradient-to-br from-palette-yellow to-palette-orange px-7 py-2 text-base font-bold text-brand-dark shadow-[0_4px_16px_color-mix(in_oklch,var(--palette-orange)_35%,transparent)] hover:opacity-90"
          >
            {locked ? (
              "请先完成前置任务"
            ) : (
              <>
                <span>生成 · -{amount}</span>
                {meta.currencyIcon}
              </>
            )}
          </Button>
        </div>
      </div>

      <SpendConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`生成${meta.title}`}
        description={`将根据本任务自动生成${meta.title}，确认消耗`}
        currency={meta.currency}
        amount={amount}
        currentBalance={balance}
        refundHint="若生成失败，系统会自动退还消耗"
        loading={isPending}
        onConfirm={onConfirm}
      />
    </ContentCard>
  );
}
