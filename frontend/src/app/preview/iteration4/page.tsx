import { BookOpen, Clapperboard, SearchCode, Sparkles, FlaskConical } from "lucide-react";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { PlanRecommendationCard } from "@/components/dashboard/plan-recommendation-card";
import { ContentCard } from "@/components/learn/content-card";
import { KnowledgePointRecommendations } from "@/components/learn/knowledge-point-recommendations";
import { TaskSidebar } from "@/components/learn/task-sidebar";
import { FeaturedResourceSection } from "@/components/tools/featured-resource-section";
import { ToolPageShell } from "@/components/tools/tool-page-shell";
import type {
  FeaturedResource,
  RecommendedPlan,
  RecommendationResourceKind,
  StudyStageDetail,
  StudyTask,
  TaskChatContext,
  TaskRecommendations,
} from "@/lib/api/schemas";

const task: StudyTask = {
  id: 9001, study_stage_id: 900, title: "二叉搜索树",
  description: "通过概念、代码与交互操作理解二叉搜索树的查找、插入和删除规则。",
  sort_order: 1, status: "STUDYING", knowledge_video_id: null,
  interactive_html_id: null, knowledge_explanation_id: null, created_at: 0, updated_at: 0,
};
const stage: StudyStageDetail = {
  id: 900, study_subject_id: 90, title: "树结构", description: "掌握树与二叉树的基本结构",
  sort_order: 1, status: "STUDYING", total_tasks: 3, finished_tasks: 1, created_at: 0,
  tasks: [
    { id: 9000, title: "树的基本概念", description: "", sort_order: 0, status: "FINISHED", created_at: 0 },
    { id: 9001, title: "二叉搜索树", description: "", sort_order: 1, status: "STUDYING", created_at: 0 },
    { id: 9002, title: "树的遍历", description: "", sort_order: 2, status: "LOCKED", created_at: 0 },
  ],
};
const recommendations: TaskRecommendations = {
  eligible: true, knowledge_point_title: "二叉搜索树",
  resources: {
    knowledge_video: [{ id: 1, title: "二叉搜索树的查找与插入动画", summary: "用动画理解查找路径、插入位置与树高变化。", reasons: ["与你当前学习进度相近的学习者通常先通过动画建立概念理解"], learner_count: 128 }],
    interactive_html: [{ id: 3, title: "二叉搜索树节点删除操作台", summary: "拖动、删除节点，实时观察树结构变化。", reasons: ["适合在理解概念后动手验证删除规则"], learner_count: null }],
  },
};
const chat: TaskChatContext = {
  course_title: "Python 基础", stage_title: "树结构", knowledge_point_title: "二叉搜索树",
  suggested_questions: [{ question: "二叉搜索树和普通二叉树有什么区别？" }, { question: "为什么查找效率与树的高度有关？" }],
  popular_questions: [{ question: "删除有两个子节点的节点时怎么办？", learner_count: 8 }, { question: "为什么二叉搜索树会退化成链表？", learner_count: 12 }],
};
const nextPlan: RecommendedPlan = {
  id: 7, title: "数据结构与算法基础", reason: "与你的学习目标和已完成的 Python 基础相衔接。",
  stage_count: 4, task_count: 16, estimated_weeks: 3,
  stages: [{ title: "线性表与栈队列", task_count: 4 }, { title: "树与图", task_count: 4 }, { title: "排序与查找", task_count: 4 }, { title: "综合练习", task_count: 4 }],
};
const featured: FeaturedResource = [{ id: 1, title: "二叉搜索树的查找与插入动画", summary: "用动画理解查找路径、插入位置与树高变化。" }];

export default async function Iteration4PreviewPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (process.env.UI_PREVIEW !== "true") notFound();
  const { view = "task" } = await searchParams;
  if (view === "plan") return <PlanPreview />;
  if (view === "k2v" || view === "c2v" || view === "interactive") return <ToolPreview kind={view} />;
  return <TaskPreview />;
}

function TaskPreview() {
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-canvas">
      <main className="flex flex-1 flex-col gap-10 overflow-y-auto px-8 py-10 sm:px-16 sm:py-14">
        <header className="flex flex-col gap-3">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-xl bg-gradient-to-br from-palette-yellow-light to-palette-orange-light px-[18px] py-1.5 text-sm font-extrabold tracking-wide text-brand-deep shadow-[0_4px_12px_color-mix(in_oklch,var(--palette-orange)_30%,transparent)]"><BookOpen className="size-4" />学习任务 · 预览</span>
          <h1 className="bg-gradient-to-br from-brand-dark to-palette-orange bg-clip-text text-4xl font-black leading-tight tracking-tight text-transparent sm:text-5xl">二叉搜索树</h1>
          <p className="max-w-[720px] text-base font-medium leading-[1.7] text-brand-medium">这是使用实际任务页组件渲染的本地预览，不请求后端或生成服务。</p>
        </header>
        <section className="rounded-3xl border border-palette-purple-light/70 bg-palette-purple-mist/65 p-6 shadow-[var(--shadow-soft)]"><div className="flex items-center gap-2 text-palette-purple"><Sparkles className="size-5" /><h2 className="text-xl font-extrabold text-brand-dark">知识讲解</h2></div><p className="mt-4 text-sm leading-relaxed text-brand-medium">二叉搜索树要求左子树的节点值小于根节点，右子树的节点值大于根节点。这一性质使查找能够沿单一路径进行。</p></section>
        <KnowledgePointRecommendations task={task} previewData={recommendations} previewOnly />
      </main>
      <TaskSidebar task={task} stage={stage} previewChatContext={chat} />
    </div>
  );
}

function PlanPreview() {
  return <main className="mx-auto flex min-h-dvh w-full max-w-[900px] items-center bg-canvas px-8 py-14"><ContentCard theme="yellow" icon={<Sparkles />} title="学完打卡" subtitle="完整学习计划已完成"><PlanRecommendationCard subjectId={90} next previewPlan={nextPlan} /></ContentCard></main>;
}

function ToolPreview({ kind }: { kind: "k2v" | "c2v" | "interactive" }) {
  const metas: Record<typeof kind, { title: string; subtitle: string; label: string; icon: ReactNode; resourceKind: RecommendationResourceKind }> = {
    k2v: { title: "Knowledge 2 Video", subtitle: "你的专属 AIGC 视频知识库", label: "知识点视频", icon: <Clapperboard className="size-4" />, resourceKind: "knowledge-video" },
    c2v: { title: "Code 2 Video", subtitle: "你的专属算法题解视听库", label: "代码题解视频", icon: <SearchCode className="size-4" />, resourceKind: "code-video" },
    interactive: { title: "Interactive Lab", subtitle: "把抽象概念变成可玩的沙盒，AI 即刻为你搭建演示页面", label: "交互式实验室", icon: <FlaskConical className="size-4" />, resourceKind: "interactive-html" },
  };
  const meta = metas[kind];
  return <ToolPageShell title={meta.title} subtitle={meta.subtitle} badge={{ icon: meta.icon, label: meta.label }}><FeaturedResourceSection kind={meta.resourceKind} previewData={featured} onOpen={() => undefined} /></ToolPageShell>;
}
