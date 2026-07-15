"use client";

import { AlertTriangle, ArrowRight, Gem, Rocket } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  createSubjectAction,
  type CreateSubjectInput,
} from "@/app/(app)/dashboard/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  studyLanguage,
  type StudyLanguage,
  type StudySubjectPricingItem,
} from "@/lib/api/schemas";

const LANGUAGE_OPTIONS: { value: StudyLanguage; label: string }[] = [
  { value: "PYTHON", label: "Python" },
  { value: "JAVA", label: "Java" },
  { value: "CPP", label: "C++" },
  { value: "GO", label: "Go" },
  { value: "RUST", label: "Rust" },
];

type Step = "form" | "confirm";

export interface CreateSubjectButtonProps {
  pricing: StudySubjectPricingItem[];
  currentDiamond: number;
  variant?: "primary" | "ghost";
  className?: string;
  label?: string;
}

export function CreateSubjectButton({
  pricing,
  currentDiamond,
  variant = "primary",
  className,
  label = "创建第一个学习主题",
}: CreateSubjectButtonProps) {
  const [open, setOpen] = useState(false);

  const baseClass =
    variant === "primary"
      ? "inline-flex h-[52px] items-center gap-2 rounded-full bg-gradient-to-br from-palette-yellow to-palette-orange px-9 text-base font-bold text-brand-dark shadow-[0_4px_16px_color-mix(in_oklch,var(--palette-orange)_35%,transparent)] transition-transform hover:-translate-y-0.5"
      : "inline-flex h-10 items-center gap-2 rounded-full border border-palette-orange/40 bg-white/70 px-5 text-sm font-bold text-brand-dark hover:bg-palette-yellow-light";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${baseClass} ${className ?? ""}`}
      >
        <Rocket className="size-4" strokeWidth={2.2} />
        {label}
      </button>
      {open ? (
        <CreateSubjectModal
          pricing={pricing}
          currentDiamond={currentDiamond}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function CreateSubjectModal({
  pricing,
  currentDiamond,
  onClose,
}: {
  pricing: StudySubjectPricingItem[];
  currentDiamond: number;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>("form");
  const [subject, setSubject] = useState("");
  const [language, setLanguage] = useState<StudyLanguage>("PYTHON");
  const defaultStages =
    pricing.find((p) => p.total_stages === 7)?.total_stages ??
    pricing[0]?.total_stages ??
    7;
  const [totalStages, setTotalStages] = useState<number>(defaultStages);
  const [target, setTarget] = useState("");
  const [isPending, startTransition] = useTransition();

  const subjectId = useId();
  const targetId = useId();

  const selected = pricing.find((p) => p.total_stages === totalStages);
  const cost = selected?.diamond_cost ?? 0;
  const after = currentDiamond - cost;
  const insufficient = after < 0;

  const canNext =
    subject.trim().length > 0 &&
    subject.trim().length <= 200 &&
    studyLanguage.safeParse(language).success &&
    selected !== undefined &&
    target.length <= 2000;

  const handleConfirm = () => {
    const payload: CreateSubjectInput = {
      subject: subject.trim(),
      language,
      total_stages: totalStages,
      target: target.trim(),
    };
    startTransition(async () => {
      const result = await createSubjectAction(payload);
      if (result.ok) {
        toast.success(`已创建学习主题「${result.data.subject}」`, {
          description: `已扣 ${result.data.diamond_cost} 钻石，正在生成学前测…`,
        });
        onClose();
      } else {
        toast.error(result.message);
      }
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !isPending) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        {step === "form" ? (
          <>
            <DialogHeader className="items-center text-center">
              <div className="mb-3 flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-palette-yellow-light to-palette-orange-lighter text-palette-orange shadow-[0_4px_12px_color-mix(in_oklch,var(--palette-orange)_20%,transparent)]">
                <Rocket className="size-8" strokeWidth={1.8} />
              </div>
              <DialogTitle className="text-lg font-extrabold text-brand-dark">
                创建学习主题
              </DialogTitle>
              <DialogDescription className="text-sm text-brand-medium">
                AI 将根据语言、阶段数与你的学习目标定制学前测与学习计划
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <Label htmlFor={subjectId} className="text-sm font-bold text-brand-dark">
                  学习主题
                </Label>
                <Input
                  id={subjectId}
                  placeholder="例如：Python 入门、数据结构与算法"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={200}
                  autoFocus
                />
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-sm font-bold text-brand-dark">编程语言</span>
                <div className="flex flex-wrap gap-2">
                  {LANGUAGE_OPTIONS.map((opt) => {
                    const active = language === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setLanguage(opt.value)}
                        className={`rounded-full border-2 px-4 py-1.5 text-sm font-bold transition ${
                          active
                            ? "border-palette-orange bg-palette-orange-lighter text-brand-dark"
                            : "border-border/40 bg-white/70 text-brand-medium hover:border-palette-orange/50"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-sm font-bold text-brand-dark">总学习阶段数</span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {pricing.map((p) => {
                    const active = totalStages === p.total_stages;
                    return (
                      <button
                        key={p.total_stages}
                        type="button"
                        onClick={() => setTotalStages(p.total_stages)}
                        className={`flex flex-col items-center gap-1 rounded-2xl border-2 px-3 py-3 transition ${
                          active
                            ? "border-palette-orange bg-palette-orange-lighter"
                            : "border-border/30 bg-white/70 hover:border-palette-orange/50"
                        }`}
                      >
                        <span className="text-base font-black text-brand-dark">
                          {p.total_stages} 天
                        </span>
                        <span className="inline-flex items-center gap-1 text-sm font-bold text-palette-blue">
                          <Gem className="size-3.5" strokeWidth={2.2} />
                          {p.diamond_cost}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor={targetId} className="text-sm font-bold text-brand-dark">
                  学习目标 <span className="text-xs font-normal text-brand-light">（可选）</span>
                </Label>
                <Textarea
                  id={targetId}
                  placeholder="想达到的水平、想解决的问题、关注的方向…"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  maxLength={2000}
                  rows={3}
                />
              </div>
            </div>

            <DialogFooter className="sm:justify-end">
              <Button variant="outline" onClick={onClose}>
                取消
              </Button>
              <Button
                onClick={() => setStep("confirm")}
                disabled={!canNext}
                className="bg-gradient-to-br from-palette-yellow to-palette-orange font-bold text-brand-dark hover:opacity-90"
              >
                下一步：确认消耗
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader className="items-center text-center">
              <div className="mb-3 flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-palette-yellow-light to-palette-orange-lighter text-palette-blue shadow-[0_4px_12px_color-mix(in_oklch,var(--palette-orange)_20%,transparent)]">
                <Gem className="size-8" strokeWidth={1.8} />
              </div>
              <DialogTitle className="text-lg font-extrabold text-brand-dark">
                确认创建学习主题？
              </DialogTitle>
              <DialogDescription className="text-sm text-brand-medium">
                «{subject.trim()}» · {totalStages} 天
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-center gap-2 rounded-2xl bg-palette-blue-mist px-5 py-3">
                <Gem className="size-5 stroke-palette-blue" strokeWidth={2.2} />
                <span className="text-2xl font-black text-palette-blue">-{cost}</span>
                <span className="text-sm font-semibold text-brand-medium">钻石消耗</span>
              </div>
              <div
                className={`flex items-center justify-center gap-2 rounded-2xl bg-palette-blue-mist/60 px-4 py-2 text-sm font-semibold ${
                  insufficient ? "text-destructive" : "text-brand-dark"
                }`}
              >
                <span>操作后余额</span>
                <ArrowRight className="size-3.5" strokeWidth={2.4} />
                <Gem className="size-3.5 stroke-palette-blue" strokeWidth={2.2} />
                <span className="text-base font-black">{after}</span>
              </div>
              {insufficient ? (
                <div className="inline-flex items-center justify-center gap-1 rounded-2xl bg-danger-surface px-4 py-2 text-center text-xs font-semibold text-destructive">
                  <AlertTriangle className="size-3.5" strokeWidth={2.4} />
                  钻石不足，还差 {Math.abs(after)}
                </div>
              ) : (
                <div className="rounded-2xl bg-palette-yellow-light px-4 py-2 text-center text-xs font-semibold text-brand-dark">
                  生成失败将自动退还钻石
                </div>
              )}
            </div>

            <DialogFooter className="sm:justify-center">
              <Button
                variant="outline"
                onClick={() => setStep("form")}
                disabled={isPending}
              >
                返回修改
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={isPending || insufficient}
                className="bg-gradient-to-br from-palette-yellow to-palette-orange font-bold text-brand-dark hover:opacity-90"
              >
                {isPending ? (
                  "创建中…"
                ) : (
                  <>
                    <Gem className="size-4" strokeWidth={2.2} />
                    确认创建
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
