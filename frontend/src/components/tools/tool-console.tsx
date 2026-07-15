"use client";

import { Coins, Gem, Loader2, RotateCcw, Sparkles } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export type ToolConsoleMode =
  | { kind: "single"; placeholder: string }
  | {
      kind: "code-pair";
      problemPlaceholder: string;
      codePlaceholder: string;
    };

export interface ToolConsoleProps {
  title: string;
  mode: ToolConsoleMode;
  currency: "diamond" | "gold";
  cost: number;
  currentBalance: number;
  primaryCtaLabel: string;
  onSubmit: (
    prompt: string,
  ) => Promise<{ ok: true; id: number } | { ok: false; message: string }>;
  onSuccess: (id: number) => void;
}

const CURRENCY_META: Record<
  "diamond" | "gold",
  { Icon: ComponentType<SVGProps<SVGSVGElement>>; label: string }
> = {
  diamond: { Icon: Gem, label: "钻石" },
  gold: { Icon: Coins, label: "金币" },
};

export function ToolConsole({
  title,
  mode,
  currency,
  cost,
  currentBalance,
  primaryCtaLabel,
  onSubmit,
  onSuccess,
}: ToolConsoleProps) {
  const [text, setText] = useState("");
  const [problem, setProblem] = useState("");
  const [code, setCode] = useState("");
  const [isPending, startTransition] = useTransition();

  const trimmedSingle = text.trim();
  const trimmedProblem = problem.trim();
  const trimmedCode = code.trim();

  const after = currentBalance - cost;
  const insufficient = after < 0;

  const valid =
    mode.kind === "single"
      ? trimmedSingle.length > 0
      : trimmedProblem.length > 0 && trimmedCode.length > 0;

  const submitDisabled = !valid || isPending || insufficient;
  const meta = CURRENCY_META[currency];

  function buildPrompt(): string {
    if (mode.kind === "single") return trimmedSingle;
    return `# 题目\n${trimmedProblem}\n\n# 核心代码\n\`\`\`\n${trimmedCode}\n\`\`\``;
  }

  function handleReset() {
    setText("");
    setProblem("");
    setCode("");
  }

  function handleSubmit() {
    if (submitDisabled) return;
    const prompt = buildPrompt();
    startTransition(async () => {
      const result = await onSubmit(prompt);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(`已扣 ${cost} ${meta.label}，正在生成…`);
      handleReset();
      onSuccess(result.id);
    });
  }

  return (
    <section className="relative overflow-visible rounded-3xl border border-white/80 bg-gradient-to-b from-white/90 to-[color-mix(in_oklch,var(--surface-soft)_60%,transparent)] p-8 shadow-[0_8px_32px_color-mix(in_oklch,var(--border-muted)_15%,transparent)] backdrop-blur">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1 rounded-t-3xl bg-gradient-to-r from-palette-yellow via-palette-orange-light via-palette-purple-light to-palette-blue-light"
      />

      <h3 className="mb-4 text-lg font-extrabold text-brand-dark">{title}</h3>

      {mode.kind === "single" ? (
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          maxLength={4000}
          disabled={isPending}
          placeholder={mode.placeholder}
          className="mb-6 min-h-[180px] w-full resize-y rounded-2xl border-2 border-transparent bg-canvas px-5 py-4 text-base leading-relaxed text-brand-dark shadow-[inset_0_2px_4px_rgba(0,0,0,0.04)] outline-none transition placeholder:text-brand-light focus:border-palette-blue-light focus:shadow-[0_4px_12px_color-mix(in_oklch,var(--palette-purple)_15%,transparent)]"
        />
      ) : (
        <div className="mb-6 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-bold text-brand-dark">
              输入题目描述
            </label>
            <Textarea
              value={problem}
              onChange={(e) => setProblem(e.target.value)}
              rows={5}
              maxLength={3000}
              disabled={isPending}
              placeholder={mode.problemPlaceholder}
              className="min-h-[140px] w-full resize-y rounded-2xl border-2 border-transparent bg-canvas px-5 py-4 text-base leading-relaxed text-brand-dark shadow-[inset_0_2px_4px_rgba(0,0,0,0.04)] outline-none transition placeholder:text-brand-light focus:border-palette-blue-light"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-bold text-brand-dark">
              输入答案 / 核心代码
            </label>
            <Textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              rows={7}
              maxLength={6000}
              disabled={isPending}
              placeholder={mode.codePlaceholder}
              className="min-h-[180px] w-full resize-y rounded-2xl border-2 border-transparent bg-canvas px-5 py-4 font-mono text-[13px] leading-relaxed text-brand-dark shadow-[inset_0_2px_4px_rgba(0,0,0,0.04)] outline-none transition placeholder:text-brand-light focus:border-palette-blue-light"
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={handleReset}
          disabled={isPending}
          className="h-11 gap-2 rounded-2xl border-2 border-palette-yellow-light bg-gradient-to-br from-palette-yellow-mist to-palette-orange-mist px-6 font-bold text-brand-dark shadow-[0_2px_8px_color-mix(in_oklch,var(--palette-orange-pale)_30%,transparent)] hover:from-palette-yellow-lighter hover:to-palette-orange-lighter"
        >
          <RotateCcw className="size-4" />
          清空
        </Button>

        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${
              insufficient
                ? "bg-destructive/10 text-destructive"
                : currency === "diamond"
                  ? "bg-palette-blue-mist text-palette-blue"
                  : "bg-palette-yellow-light text-palette-orange"
            }`}
          >
            <meta.Icon className="size-3.5" strokeWidth={2.2} />
            {insufficient
              ? `余额不足，还差 ${Math.abs(after)}`
              : `每次消耗 ${cost} · 余额 ${currentBalance}`}
          </span>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitDisabled}
            className="h-11 min-w-[180px] gap-2 rounded-2xl bg-gradient-to-br from-palette-yellow-light to-palette-orange-light px-7 font-bold text-brand-deep shadow-[0_4px_12px_color-mix(in_oklch,var(--palette-orange)_40%,transparent)] hover:from-palette-yellow hover:to-palette-orange hover:shadow-[0_8px_24px_color-mix(in_oklch,var(--palette-orange)_50%,transparent)]"
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                正在生成…
              </>
            ) : (
              <>
                <Sparkles className="size-4" />
                {primaryCtaLabel}
              </>
            )}
          </Button>
        </div>
      </div>
    </section>
  );
}
