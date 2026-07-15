"use client";

import { Pin, Repeat } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  STATUS_LABEL,
  STATUS_TONE,
} from "@/components/dashboard/subject-status";
import { SubjectsDialog } from "@/components/dashboard/subjects-dialog";
import { useStudySubject } from "@/lib/query/study-subject";
import type {
  StudySubject,
  StudySubjectPricingItem,
} from "@/lib/api/schemas";

export function PlanToolbar({
  active,
  subjects,
  pricing,
  currentDiamond,
}: {
  active: StudySubject;
  subjects: StudySubject[];
  pricing: StudySubjectPricingItem[];
  currentDiamond: number;
}) {
  const [open, setOpen] = useState(false);
  const { data = active } = useStudySubject(active.id, { initialData: active });
  const progress =
    data.total_stages > 0
      ? Math.round((data.finished_stages / data.total_stages) * 100)
      : 0;

  return (
    <>
      <Card className="flex flex-col gap-4 rounded-3xl border border-border/30 bg-white/70 p-5 shadow-[var(--shadow-soft)] backdrop-blur-sm md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-3">
            <Pin className="size-4 shrink-0 text-palette-orange" />
            <span className="truncate text-base font-bold text-brand-dark">
              {data.subject}
            </span>
            <Badge
              className={`shrink-0 ${STATUS_TONE[data.status]}`}
              variant="secondary"
            >
              {STATUS_LABEL[data.status]}
            </Badge>
            <span className="ml-auto shrink-0 text-sm font-bold text-brand-medium md:ml-0">
              Day {data.finished_stages}/{data.total_stages}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/15">
            <div
              className="h-full rounded-full bg-gradient-to-r from-palette-orange to-palette-yellow transition-[width] duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full"
            onClick={() => setOpen(true)}
          >
            <Repeat className="size-4" />
            切换主题
          </Button>
        </div>
      </Card>
      <SubjectsDialog
        open={open}
        onOpenChange={setOpen}
        subjects={subjects}
        activeId={active.id}
        pricing={pricing}
        currentDiamond={currentDiamond}
      />
    </>
  );
}
