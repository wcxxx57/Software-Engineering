"use client";

import { Check, Search } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { setActiveSubjectAction } from "@/app/(app)/dashboard/actions";
import { CreateSubjectButton } from "@/components/dashboard/create-subject-button";
import {
  LANGUAGE_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
} from "@/components/dashboard/subject-status";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  studySubjectListQueryKey,
  useStudySubjectList,
} from "@/lib/query/study-subject";
import { cn } from "@/lib/utils";
import type {
  StudySubject,
  StudySubjectPricingItem,
} from "@/lib/api/schemas";

export function SubjectsDialog({
  open,
  onOpenChange,
  subjects,
  activeId,
  pricing,
  currentDiamond,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subjects: StudySubject[];
  activeId: number;
  pricing: StudySubjectPricingItem[];
  currentDiamond: number;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<number | null>(null);

  // Sync RSC data into the cache so the hook can keep the list fresh while
  // the dialog is open (revalidatePath after switch / create updates this).
  useEffect(() => {
    queryClient.setQueryData(studySubjectListQueryKey(), subjects);
  }, [queryClient, subjects]);

  const { data: liveSubjects = subjects } = useStudySubjectList({
    initialData: subjects,
    disablePolling: !open,
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...liveSubjects].sort(
      (a, b) => b.created_at - a.created_at,
    );
    if (!q) return sorted;
    return sorted.filter(
      (s) =>
        s.subject.toLowerCase().includes(q) ||
        s.language.toLowerCase().includes(q),
    );
  }, [liveSubjects, query]);

  function handleSwitch(id: number) {
    if (id === activeId || pending) return;
    setPendingId(id);
    startTransition(async () => {
      const result = await setActiveSubjectAction(id);
      setPendingId(null);
      if (result.ok) {
        onOpenChange(false);
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] gap-4 sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>我的学习主题</DialogTitle>
          <DialogDescription>
            选择一个主题聚焦学习，或创建一个新主题
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-brand-light" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索主题或语言"
              className="pl-9"
            />
          </div>
          <CreateSubjectButton
            pricing={pricing}
            currentDiamond={currentDiamond}
            label="+ 新建"
            variant="primary"
          />
        </div>
        <ScrollArea className="max-h-[420px]">
          <ul className="flex flex-col gap-2 pr-2">
            {filtered.length === 0 ? (
              <li className="rounded-2xl border border-dashed border-border/40 px-4 py-8 text-center text-sm text-brand-light">
                没有匹配的计划
              </li>
            ) : (
              filtered.map((s) => {
                const isActive = s.id === activeId;
                const isPending = pendingId === s.id;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => handleSwitch(s.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-2xl border bg-white/70 px-4 py-3 text-left transition",
                        isActive
                          ? "border-palette-orange bg-palette-orange-lighter/40"
                          : "border-border/30 hover:border-palette-orange/60 hover:bg-palette-orange-lighter/20",
                        pending && "opacity-60",
                      )}
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-bold text-brand-dark">
                            {s.subject}
                          </span>
                          <Badge
                            variant="secondary"
                            className="shrink-0 bg-palette-yellow-light text-brand-dark"
                          >
                            {LANGUAGE_LABEL[s.language] ?? s.language}
                          </Badge>
                          <Badge
                            variant="secondary"
                            className={cn("shrink-0", STATUS_TONE[s.status])}
                          >
                            {STATUS_LABEL[s.status]}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-brand-medium">
                          <span>
                            Day {s.finished_stages}/{s.total_stages}
                          </span>
                          <span className="text-brand-light">·</span>
                          <span>
                            {new Date(s.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <div className="flex size-7 shrink-0 items-center justify-center">
                        {isActive ? (
                          <Check className="size-5 text-palette-orange" />
                        ) : isPending ? (
                          <span className="size-2 animate-pulse rounded-full bg-palette-orange" />
                        ) : null}
                      </div>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
