"use client";

import {
  FailedCard,
  GeneratingCard,
  PretestReadyCard,
} from "@/components/dashboard/state-cards";
import { JourneyTimeline } from "@/components/dashboard/journey-timeline";
import { useStudySubject } from "@/lib/query/study-subject";
import type { StudySubject } from "@/lib/api/schemas";

export function ActiveSubjectArea({ subject }: { subject: StudySubject }) {
  const { data = subject } = useStudySubject(subject.id, {
    initialData: subject,
  });

  switch (data.status) {
    case "CURRICULUM_QUEUING":
    case "CURRICULUM_FETCHING":
      return (
        <GeneratingCard
          title="正在匹配权威课程大纲"
          description="AI 正在查看知识库中的课程模板；若没有合适模板，将从教育来源白名单补充并入库。"
        />
      );
    case "PRETEST_QUEUING":
    case "PRETEST_GENERATING":
      return (
        <GeneratingCard
          title="正在准备学前测"
          description="AI 正根据你的主题与目标生成几道题，预计十几秒到一分钟之内完成。"
        />
      );
    case "PRETEST_READY":
      return <PretestReadyCard subject={data} />;
    case "PLAN_QUEUING":
    case "PLAN_GENERATING":
      return (
        <GeneratingCard
          title="正在生成你的学习计划"
          description="AI 基于学前测结果在排你的学习路线，请稍候。"
        />
      );
    case "STUDYING":
    case "FINISHED":
      return <JourneyTimeline subject={data} />;
    case "FAILED":
      return <FailedCard subject={data} />;
  }
}
