"use client";

import { Box, Clapperboard, FlaskConical, SearchCode } from "lucide-react";
import type { ReactNode } from "react";

import { ToolPageClient, type ToolResource } from "@/components/tools/tool-page-client";
import { ToolPageShell } from "@/components/tools/tool-page-shell";
import type { FeaturedResource, RecommendationResourceKind } from "@/lib/api/schemas";

type PreviewKind = "k2v" | "c2v" | "interactive";

const CONFIG: Record<
  PreviewKind,
  {
    title: string;
    subtitle: string;
    badge: ReactNode;
    badgeLabel: string;
    featuredKind: RecommendationResourceKind;
    consoleTitle: string;
    consoleMode:
      | { kind: "single"; placeholder: string }
      | { kind: "code-pair"; problemPlaceholder: string; codePlaceholder: string };
    emptyHint: string;
    detailKind: "knowledge-video" | "code-video" | "interactive-html";
  }
> = {
  k2v: {
    title: "Knowledge 2 Video",
    subtitle: "你的专属 AIGC 视频知识库",
    badge: <Clapperboard className="size-4" />,
    badgeLabel: "知识点视频",
    featuredKind: "knowledge-video",
    consoleTitle: "输入你需要讲解的知识点",
    consoleMode: { kind: "single", placeholder: "例如：请用生动的比喻讲解什么是 Python 的闭包函数…" },
    emptyHint: "还没有创建过任何 K2V 视频。给 AI 一个知识点，让它给你拍一支讲解短片。",
    detailKind: "knowledge-video",
  },
  c2v: {
    title: "Code 2 Video",
    subtitle: "你的专属算法题解视听库",
    badge: <SearchCode className="size-4" />,
    badgeLabel: "代码题解视频",
    featuredKind: "code-video",
    consoleTitle: "输入题目和你的解法",
    consoleMode: { kind: "code-pair", problemPlaceholder: "请粘贴题目背景、输入输出与约束条件…", codePlaceholder: "请粘贴可运行的核心代码…" },
    emptyHint: "还没有生成过任何 C2V 视频。给 AI 一道题和你的解法，它会做成讲解短片。",
    detailKind: "code-video",
  },
  interactive: {
    title: "Interactive Lab",
    subtitle: "把抽象概念变成可玩的沙盒，AI 即刻为你搭建演示页面",
    badge: <FlaskConical className="size-4" />,
    badgeLabel: "交互式实验室",
    featuredKind: "interactive-html",
    consoleTitle: "输入你想要交互的知识点",
    consoleMode: { kind: "single", placeholder: "例如：可视化汉诺塔的递归调用过程，允许用户调节盘数与速度。" },
    emptyHint: "还没有生成过任何交互式实验。让 AI 把抽象的概念变成可玩的沙盒。",
    detailKind: "interactive-html",
  },
};

const FEATURED: Record<PreviewKind, FeaturedResource[]> = {
  k2v: [{ id: 101, title: "递归调用过程动画", summary: "通过栈帧变化理解递归的进入、返回与终止条件。" }],
  c2v: [{ id: 102, title: "二分查找边界处理", summary: "跟随代码执行理解左右边界更新与循环结束条件。" }],
  interactive: [{ id: 103, title: "二叉搜索树操作台", summary: "拖动节点并观察插入、查找与删除后的结构变化。" }],
};

export function Iteration4ToolPreview({ kind, empty = false }: { kind: PreviewKind; empty?: boolean }) {
  const config = CONFIG[kind];
  return (
    <ToolPageShell
      title={config.title}
      subtitle={config.subtitle}
      badge={{ icon: config.badge, label: config.badgeLabel }}
    >
      <ToolPageClient<ToolResource>
        initialList={[]}
        listEndpoint={`/preview/${kind}`}
        createAction={async () => ({ ok: false, message: "预览模式不生成内容" })}
        deleteAction={async () => ({ ok: false, message: "预览模式不删除内容" })}
        consoleTitle={config.consoleTitle}
        consoleMode={config.consoleMode}
        currency="diamond"
        cost={5}
        detailKind={config.detailKind}
        cardThumbnailIcon={kind === "interactive" ? <Box /> : undefined}
        emptyHint={config.emptyHint}
        primaryCtaLabel="在线生成"
        featuredKind={config.featuredKind}
        featuredPreviewData={empty ? [] : FEATURED[kind]}
        previewOnly
      />
    </ToolPageShell>
  );
}
