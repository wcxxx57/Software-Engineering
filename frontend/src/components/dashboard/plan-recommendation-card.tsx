"use client";

import { useMutation } from "@tanstack/react-query";
import { CalendarDays, Compass, ListChecks } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { RecommendedPlan } from "@/lib/api/schemas";
import { usePlanRecommendation } from "@/lib/query/recommendations";
import { requestJson } from "@/lib/query/utils";

export function PlanRecommendationCard({ subjectId, next = false, previewPlan }: { subjectId: number; next?: boolean; previewPlan?: RecommendedPlan }) {
  const { data: queriedPlan } = usePlanRecommendation(subjectId, next, previewPlan == null);
  const plan = previewPlan ?? queriedPlan;
  const router = useRouter();
  const adopt = useMutation({
    mutationFn: () => {
      if (!plan) throw new Error("plan recommendation is unavailable");
      return requestJson(`/api/study-subjects/${subjectId}/plan-recommendations/${plan.id}/adopt`, { method: "POST" });
    },
    onSuccess: () => router.refresh(),
  });
  if (!plan) return null;
  return (
    <section className="rounded-3xl border border-border/30 bg-white/70 p-6 shadow-[var(--shadow-soft)] backdrop-blur-sm">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-palette-yellow-light to-palette-orange-light text-brand-dark"><Compass className="size-5" /></span>
        <div className="min-w-0"><p className="text-sm font-bold text-brand-gold">下一阶段学习计划</p><h2 className="mt-1 text-xl font-extrabold text-brand-dark">{plan.title}</h2></div>
      </div>
      <p className="mt-4 text-sm font-semibold leading-relaxed text-brand-medium">推荐给你：{plan.reason}</p>
      <div className="mt-4 flex flex-wrap gap-3 text-xs font-bold text-brand-medium"><span className="inline-flex items-center gap-1.5"><ListChecks className="size-4" />{plan.stage_count} 个阶段 · {plan.task_count} 个任务</span>{plan.estimated_weeks ? <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-4" />预计 {plan.estimated_weeks} 周</span> : null}</div>
      <div className="mt-6 flex flex-wrap gap-2">
        <Dialog><DialogTrigger render={<Button variant="outline" className="rounded-full" />}>预览计划</DialogTrigger><DialogContent><DialogHeader><DialogTitle>{plan.title}</DialogTitle><DialogDescription>{plan.reason}</DialogDescription></DialogHeader><ol className="flex max-h-64 flex-col gap-3 overflow-y-auto">{plan.stages.map((stage, index) => <li key={`${stage.title}-${index}`} className="rounded-2xl bg-palette-yellow-mist px-4 py-3 text-sm font-semibold text-brand-dark">{index + 1}. {stage.title}<span className="ml-2 text-brand-medium">{stage.task_count} 个任务</span></li>)}</ol></DialogContent></Dialog>
        <Button disabled={adopt.isPending} onClick={() => adopt.mutate()} className="rounded-full bg-gradient-to-br from-palette-yellow to-palette-orange text-brand-dark">{adopt.isPending ? "处理中" : "采用此计划"}</Button>
        <Button variant="ghost" className="rounded-full">继续自定义</Button>
      </div>
    </section>
  );
}
