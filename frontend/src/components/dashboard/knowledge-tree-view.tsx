"use client";

import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { Check, ChevronDown, Lock, Play } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import type { KnowledgeTreeNode } from "@/lib/api/schemas";
import { useKnowledgeTree } from "@/lib/query/knowledge-tree";
import { cn } from "@/lib/utils";

type CurriculumFlowNode = Node<KnowledgeTreeNode, "curriculum">;

const nodeTypes = { curriculum: CurriculumNodeCard };

export function KnowledgeTreeView({ subjectId }: { subjectId: number }) {
  const query = useKnowledgeTree(subjectId);
  const flow = useMemo(() => buildFlow(query.data?.nodes ?? []), [query.data?.nodes]);

  if (query.isPending) {
    return <div className="flex h-[520px] items-center justify-center text-brand-medium">正在加载知识树…</div>;
  }
  if (query.isError) {
    return <div className="flex h-[520px] items-center justify-center text-destructive">{query.error.message}</div>;
  }
  if (query.data.legacy) {
    return (
      <div className="flex h-[420px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border/30 bg-palette-yellow-mist text-center">
        <p className="font-bold text-brand-dark">该计划尚未绑定权威课程大纲</p>
        <p className="text-xs text-brand-medium">旧计划仍可使用上方计划视图继续学习。</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-brand-medium">
        <span className="font-bold text-brand-dark">
          {query.data.template?.canonical_name} · v{query.data.template?.version}
        </span>
        <span className="flex flex-wrap items-center gap-1">
          来源：
          {query.data.sources.map((source) => (
            <a
              key={source.source_url}
              href={source.source_url}
              target="_blank"
              rel="noreferrer"
              className="font-semibold underline decoration-palette-orange/50 underline-offset-2"
            >
              {source.platform} / {source.institution}
            </a>
          ))}
        </span>
      </div>
      <div className="h-[560px] overflow-hidden rounded-2xl border border-border/30 bg-palette-yellow-mist/60">
        <ReactFlow<CurriculumFlowNode, Edge>
          nodes={flow.nodes}
          edges={flow.edges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1.15 }}
          minZoom={0.25}
          maxZoom={1.5}
        >
          <Background color="var(--border-muted)" gap={22} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}

function buildFlow(items: KnowledgeTreeNode[]): { nodes: CurriculumFlowNode[]; edges: Edge[] } {
  const byDepth = new Map<number, KnowledgeTreeNode[]>();
  for (const item of items) {
    const level = byDepth.get(item.depth) ?? [];
    level.push(item);
    byDepth.set(item.depth, level);
  }
  const nodes: CurriculumFlowNode[] = [];
  for (const [depth, level] of byDepth) {
    level.sort((a, b) => a.sort_order - b.sort_order);
    const height = Math.max(1, level.length - 1) * 150;
    level.forEach((item, index) => {
      nodes.push({
        id: item.node_key,
        type: "curriculum",
        position: { x: depth * 310, y: index * 150 - height / 2 },
        data: item,
      });
    });
  }
  const edges = items
    .filter((item) => item.parent_node_key)
    .map((item) => ({
      id: `${item.parent_node_key}-${item.node_key}`,
      source: item.parent_node_key!,
      target: item.node_key,
      type: "smoothstep",
      animated: item.available,
      style: {
        stroke: item.progress === 100 ? "var(--palette-green)" : item.planned ? "var(--palette-orange)" : "var(--border-muted)",
        strokeWidth: item.planned ? 2 : 1,
      },
    }));
  return { nodes, edges };
}

function CurriculumNodeCard({ data }: NodeProps<CurriculumFlowNode>) {
  const complete = data.progress === 100;
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className={cn(
        "w-64 rounded-2xl border-2 px-4 py-3 shadow-[var(--shadow-soft)] transition",
        !data.planned && "border-border/25 bg-white/65 text-brand-light",
        data.planned && !data.available && !complete && "border-palette-yellow/60 bg-palette-yellow-light text-brand-dark",
        data.available && !complete && "border-palette-orange bg-white text-brand-dark shadow-[0_6px_20px_color-mix(in_oklch,var(--palette-orange)_25%,transparent)]",
        complete && "border-palette-green bg-palette-green-lighter text-brand-dark",
      )}
    >
      <Handle type="target" position={Position.Left} className="opacity-0" />
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="nodrag flex w-full items-start gap-2 text-left"
        aria-expanded={expanded}
      >
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-white/80">
          {complete ? <Check className="size-4 text-palette-green" /> : data.available ? <Play className="size-4 text-palette-orange" /> : <Lock className="size-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold leading-snug">{data.title}</p>
          {data.description && <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed opacity-70">{data.description}</p>}
        </div>
        {data.planned && <span className="text-[10px] font-black">{data.progress}%</span>}
        {data.tasks.length > 0 && (
          <ChevronDown className={cn("size-3.5 transition", expanded && "rotate-180")} />
        )}
      </button>
      {data.planned && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/70">
          <div className="h-full rounded-full bg-gradient-to-r from-palette-orange to-palette-green" style={{ width: `${data.progress}%` }} />
        </div>
      )}
      {expanded && data.tasks.length > 0 && (
        <div className="nodrag nopan mt-2 flex flex-col gap-1">
          {data.tasks.map((task) =>
            task.status === "LOCKED" ? (
              <span key={task.id} className="truncate rounded-full bg-border/20 px-2 py-1 text-[10px] text-brand-light">{task.title}</span>
            ) : (
              <Link key={task.id} href={`/tasks/${task.id}`} className="truncate rounded-full bg-white/80 px-2 py-1 text-[10px] font-semibold hover:text-palette-orange">{task.title}</Link>
            ),
          )}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="opacity-0" />
    </div>
  );
}
