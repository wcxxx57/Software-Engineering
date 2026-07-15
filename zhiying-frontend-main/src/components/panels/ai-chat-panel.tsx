import { Bot, Send } from "lucide-react";

export function AiChatPanel() {
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden px-5 py-6">
      <div className="mb-5 flex items-center gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-xl bg-palette-orange-mist text-palette-orange shadow-[0_4px_8px_color-mix(in_oklch,var(--palette-orange)_30%,transparent)]">
          <Bot className="size-5" strokeWidth={2} />
        </div>
        <h4 className="text-base font-extrabold text-brand-dark">AI 伴学</h4>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto pb-20">
        <div className="flex items-start gap-2.5">
          <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-palette-orange-lighter px-4 py-3 text-sm font-medium leading-relaxed text-brand-deep">
            嗨呀！欢迎来到智映通学 👋
            <br />
            选择一个学习主题开始，或随时来问我问题。
          </div>
        </div>
      </div>

      <div className="absolute inset-x-5 bottom-5 flex h-14 items-center gap-2 rounded-3xl border-2 border-palette-orange-light/70 bg-white/80 px-2 pl-5 shadow-[0_8px_16px_rgba(0,0,0,0.08),inset_0_2px_4px_rgba(255,255,255,0.8)] backdrop-blur-md">
        <input
          type="text"
          disabled
          placeholder="问点什么吧..."
          className="flex-1 border-none bg-transparent text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
        <button
          type="button"
          disabled
          className="flex size-10 items-center justify-center rounded-2xl bg-palette-orange-light text-brand-dark shadow-[0_2px_8px_color-mix(in_oklch,var(--palette-orange)_40%,transparent)] transition-transform disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Send className="size-[18px]" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
