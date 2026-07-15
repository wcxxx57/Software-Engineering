import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { Rocket } from "lucide-react";

import { ActiveSubjectArea } from "@/components/dashboard/active-subject-area";
import { CreateSubjectButton } from "@/components/dashboard/create-subject-button";
import { DashboardAside } from "@/components/dashboard/dashboard-aside";
import { DashboardSearch } from "@/components/dashboard/dashboard-search";
import { FeatureGrid } from "@/components/dashboard/feature-grid";
import { PlanToolbar } from "@/components/dashboard/plan-toolbar";
import { pickActiveSubject } from "@/lib/api/active-subject";
import { serverFetch } from "@/lib/api/client";
import { getPublicConfig } from "@/lib/api/public-config";
import {
  studySubjectListSchema,
  type StudySubject,
  type StudySubjectPricingItem,
} from "@/lib/api/schemas";
import { getSession } from "@/lib/auth/session";
import {
  studySubjectListQueryKey,
  studySubjectQueryKey,
} from "@/lib/query/keys";

export default async function DashboardPage() {
  const [user, subjects, config] = await Promise.all([
    getSession(),
    serverFetch<StudySubject[]>("/study-subjects", {
      schema: studySubjectListSchema,
    }),
    getPublicConfig(),
  ]);
  // (app)/layout.tsx 已经鉴权过，user 不会为 null
  if (!user) return null;

  const pricing = config.study_subject.pricing;
  const active = pickActiveSubject(user.active_study_subject_id, subjects);
  const today = new Date().toISOString().slice(0, 10);
  const checkedToday = user.last_checkin === today;

  // 把列表和当前选中的 subject 注水到 client cache，覆盖客户端可能残留的旧状态
  // （例如学前测刚提交后状态从 PRETEST_READY → PLAN_QUEUING）。
  const queryClient = new QueryClient();
  queryClient.setQueryData(studySubjectListQueryKey(), subjects);
  if (active) {
    queryClient.setQueryData(studySubjectQueryKey(active.id), active);
  }
  const dehydratedState = dehydrate(queryClient);

  return (
    <HydrationBoundary state={dehydratedState}>
      <div className="flex h-dvh w-full bg-canvas">
        <main className="flex min-w-0 flex-1 flex-col gap-12 overflow-y-auto px-12 py-10 pb-24 lg:px-20">
          <header className="flex flex-col items-center text-center">
            <h1 className="mb-8 bg-gradient-to-br from-brand-dark to-palette-orange bg-clip-text text-4xl font-black tracking-tight text-transparent md:text-5xl">
              智映通学
              <span className="ml-1 animate-pulse font-normal text-palette-orange [text-shadow:0_0_10px_color-mix(in_oklch,var(--palette-orange)_50%,transparent)]">
                |
              </span>
            </h1>

            <DashboardSearch />
          </header>

          <section className="mx-auto flex w-full max-w-[900px] flex-col gap-6">
            {active === null ? (
              <EmptyState pricing={pricing} currentDiamond={user.diamond} />
            ) : (
              <>
                <PlanToolbar
                  active={active}
                  subjects={subjects}
                  pricing={pricing}
                  currentDiamond={user.diamond}
                />
                <ActiveSubjectArea subject={active} />
              </>
            )}
          </section>

          <FeatureGrid />
        </main>

        <aside className="hidden w-[clamp(320px,30vw,450px)] shrink-0 flex-col overflow-y-auto border-l border-border/40 bg-gradient-to-b from-palette-orange-mist/60 to-canvas lg:flex">
          <DashboardAside user={user} checkedToday={checkedToday} />
        </aside>
      </div>
    </HydrationBoundary>
  );
}

function EmptyState({
  pricing,
  currentDiamond,
}: {
  pricing: StudySubjectPricingItem[];
  currentDiamond: number;
}) {
  return (
    <div className="flex w-full flex-col items-center rounded-[28px] border-2 border-dashed border-border/25 bg-white/60 px-10 py-16 text-center shadow-[var(--shadow-soft)]">
      <div className="mb-6 flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-palette-yellow-light to-palette-orange-light text-palette-orange shadow-[0_4px_12px_color-mix(in_oklch,var(--palette-orange)_30%,transparent)]">
        <Rocket className="size-10" strokeWidth={1.6} />
      </div>
      <h2 className="mb-3 text-2xl font-extrabold text-brand-dark">
        还没有学习主题
      </h2>
      <p className="mb-8 max-w-[400px] text-[15px] leading-relaxed text-brand-medium">
        创建你的第一个个性化学习主题，AI 将为你量身定制学习路线、知识点和每日任务
      </p>
      <CreateSubjectButton
        pricing={pricing}
        currentDiamond={currentDiamond}
        label="创建第一个学习主题"
      />
    </div>
  );
}
