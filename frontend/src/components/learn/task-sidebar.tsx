"use client";

import { ArrowLeft, Bot, Check, Send, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import type { StudyStageDetail, StudyTask, TaskChatContext } from "@/lib/api/schemas";
import { useTaskChatContext } from "@/lib/query/recommendations";

export function TaskSidebar({ task, stage, previewChatContext }: { task: StudyTask; stage: StudyStageDetail | null; previewChatContext?: TaskChatContext }) {
  const finished = stage?.finished_tasks ?? 0;
  const total = stage?.total_tasks ?? 0;
  const upcoming = stage?.tasks.filter((item) => item.sort_order > task.sort_order && item.status !== "FINISHED").sort((a, b) => a.sort_order - b.sort_order)[0];

  return (
    <aside className="flex w-[clamp(320px,30vw,450px)] shrink-0 flex-col border-l-2 border-border-strong/15 bg-[color-mix(in_oklch,var(--bg-canvas)_60%,transparent)] backdrop-blur-xl">
      <div className="relative shrink-0 border-b border-dashed border-border-strong/30 bg-gradient-to-br from-palette-yellow-light/30 to-palette-orange-lighter/30 px-5 pb-6 pt-4">
        <Link href="/dashboard" className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-white/80 bg-white/60 px-3.5 py-1.5 text-[13px] font-bold text-brand-dark shadow-[0_4px_12px_color-mix(in_oklch,var(--border-strong)_40%,transparent)] backdrop-blur-md transition hover:bg-white/90"><ArrowLeft className="size-3.5" />返回主控台</Link>
        <div className="rounded-[20px] border border-white/70 bg-white/55 p-5 shadow-[0_4px_12px_color-mix(in_oklch,var(--border-strong)_15%,transparent)] backdrop-blur-md">
          <h3 className="mb-4 text-[15px] font-extrabold tracking-[0.1em] text-brand-light">当前阶段进度</h3>
          <div className="flex items-center gap-4">
            <ProgressRing value={finished} total={total} done={stage?.status === "FINISHED"} />
            <div className="min-w-0"><p className="text-base font-extrabold text-brand-deep">下一节点</p><p className="mt-1 truncate text-sm text-brand-medium">{upcoming?.title ?? "本阶段已全部完成"}</p></div>
          </div>
        </div>
      </div>
      <AICompanion taskId={task.id} previewChatContext={previewChatContext} />
    </aside>
  );
}

function ProgressRing({ value, total, done }: { value: number; total: number; done: boolean }) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
  return (
    <div className="relative flex size-[76px] shrink-0 items-center justify-center rounded-full bg-canvas p-1 shadow-[0_4px_8px_color-mix(in_oklch,var(--border-strong)_20%,transparent)]">
      <svg viewBox="0 0 36 36" className="size-full -rotate-90"><path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" strokeWidth={3} className="stroke-border-strong/20"/><path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" strokeWidth={3} strokeLinecap="round" strokeDasharray={`${Math.round(ratio * 100)}, 100`} className="stroke-palette-orange"/></svg>
      <span className="absolute text-lg font-extrabold text-brand-dark">{value}/{total}</span>
      {done ? <span className="absolute -bottom-0.5 -right-0.5 flex size-[22px] items-center justify-center rounded-full border-2 border-canvas bg-palette-blue text-white"><Check className="size-3" strokeWidth={3} /></span> : null}
    </div>
  );
}

function AICompanion({ taskId, previewChatContext }: { taskId: number; previewChatContext?: TaskChatContext }) {
  const { data: queriedData } = useTaskChatContext(taskId, previewChatContext == null);
  const data = previewChatContext ?? queriedData;
  const [draft, setDraft] = useState("");
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden p-5">
      <div className="mb-3 flex items-center gap-2.5"><span className="flex size-8 items-center justify-center rounded-xl bg-[var(--chat-orange-surface)] text-brand-dark shadow-[0_4px_8px_color-mix(in_oklch,var(--palette-orange)_50%,transparent)]"><Bot className="size-[18px]" /></span><h4 className="text-base font-extrabold text-brand-dark">AI 伴学</h4></div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto pb-20">
        {data?.suggested_questions.length ? <QuestionGroup title="猜你想问" icon={<Sparkles className="size-4" />} warm questions={data.suggested_questions.map((item) => item.question)} onPick={setDraft} /> : null}
        {data?.popular_questions.length ? <QuestionGroup title="大家常问" icon={<Users className="size-4" />} pale questions={data.popular_questions.map((item) => ({ question: item.question, meta: `${item.learner_count} 位学习者问过` }))} onPick={setDraft} /> : null}
        <div className="flex max-w-[85%] items-start"><div className="rounded-2xl rounded-bl-[4px] bg-palette-orange-lighter px-4 py-3 text-sm font-medium leading-relaxed text-brand-deep">你可以围绕当前知识点向我提问。</div></div>
      </div>
      <div className="absolute inset-x-5 bottom-5 flex h-14 items-center rounded-[20px] border-2 border-[color-mix(in_oklch,var(--palette-orange)_40%,transparent)] bg-[color-mix(in_oklch,var(--bg-canvas)_80%,transparent)] py-1 pl-5 pr-2 shadow-[0_8px_16px_color-mix(in_oklch,var(--border-strong)_15%,transparent)] backdrop-blur-md"><input value={draft} onChange={(event) => setDraft(event.target.value)} type="text" placeholder="输入你的问题…" disabled className="flex-1 border-none bg-transparent text-sm font-medium text-brand-dark outline-none placeholder:text-brand-light disabled:cursor-not-allowed"/><button type="button" disabled aria-label="发送" className="flex size-10 items-center justify-center rounded-[14px] bg-[var(--chat-orange-accent)] text-brand-dark opacity-60"><Send className="size-[18px]" /></button></div>
    </div>
  );
}

function QuestionGroup({ title, icon, questions, warm = false, pale = false, onPick }: { title: string; icon: React.ReactNode; questions: Array<string | { question: string; meta?: string }>; warm?: boolean; pale?: boolean; onPick: (value: string) => void }) {
  return <section className={`rounded-2xl border ${pale ? "p-2" : "p-2.5"} ${warm ? "border-palette-orange-light/20 bg-palette-orange-lighter/35" : pale ? "border-palette-yellow-light/55 bg-palette-yellow-light/55" : "border-white/70 bg-white/55"}`}><h5 className={`${pale ? "mb-1" : "mb-1.5"} flex items-center gap-1.5 text-sm font-extrabold text-brand-dark`}>{icon}{title}</h5><div className="flex flex-col gap-1">{questions.map((item) => { const question = typeof item === "string" ? item : item.question; return <button key={question} type="button" onClick={() => onPick(question)} className={`rounded-xl px-2.5 text-left transition hover:bg-white/55 hover:text-brand-dark ${pale ? "py-1" : "py-1.5"}`}><span className="block text-xs font-semibold leading-relaxed text-brand-medium">{question}</span>{typeof item !== "string" && item.meta ? <span className="mt-0.5 block text-[11px] font-medium leading-relaxed text-brand-medium/75">{item.meta}</span> : null}</button>; })}</div></section>;
}
