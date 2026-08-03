import { Compass } from "lucide-react";
import { notFound } from "next/navigation";

import { PlanRecommendationCard } from "@/components/dashboard/plan-recommendation-card";
import type { RecommendedPlan } from "@/lib/api/schemas";

const initialPlan: RecommendedPlan = {
  id: 201,
  title: "Python 基础学习计划",
  reason: "根据你的学习目标与课前小测结果，先系统建立 Python 基础。",
  stage_count: 3,
  task_count: 12,
  estimated_weeks: 2,
  stages: [
    { title: "基础语法与数据类型", task_count: 4 },
    { title: "流程控制与函数", task_count: 4 },
    { title: "综合练习", task_count: 4 },
  ],
};

const nextPlan: RecommendedPlan = {
  id: 202,
  title: "数据结构与算法基础",
  reason: "与你已完成的 Python 基础衔接，并以此作为后续学习的前置知识。",
  stage_count: 4,
  task_count: 16,
  estimated_weeks: 3,
  stages: [
    { title: "线性表与栈队列", task_count: 4 },
    { title: "树与图", task_count: 4 },
    { title: "排序与查找", task_count: 4 },
    { title: "综合练习", task_count: 4 },
  ],
};

export default async function Iteration4PlanPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  if (process.env.UI_PREVIEW !== "true") notFound();
  const { mode } = await searchParams;
  const completed = mode === "completed";
  return (
    <main className="min-h-dvh bg-canvas px-8 py-10 sm:px-16 sm:py-14">
      <div className="mx-auto flex max-w-[900px] flex-col gap-6">
        <span className="inline-flex w-fit items-center gap-2 rounded-xl bg-gradient-to-br from-palette-yellow-light to-palette-orange-light px-[18px] py-1.5 text-sm font-extrabold text-brand-deep">
          <Compass className="size-4" /> {completed ? "计划已完成 · 预览" : "新建计划 · 预览"}
        </span>
        <PlanRecommendationCard
          subjectId={99}
          next={completed}
          previewPlan={completed ? nextPlan : initialPlan}
        />
      </div>
    </main>
  );
}
