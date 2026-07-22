import {
  BookOpenText,
  Box,
  CheckCircle2,
  ClipboardCheck,
  Film,
  Map,
  ArrowUp,
} from "lucide-react";

const sections = [
  {
    id: "knowledge-map",
    label: "知识导图",
    icon: Map,
    tone: "hover:text-brand-gold",
  },
  {
    id: "explanation",
    label: "深度解析",
    icon: BookOpenText,
    tone: "hover:text-palette-purple",
  },
  {
    id: "knowledge-video",
    label: "知识视频",
    icon: Film,
    tone: "hover:text-palette-blue",
  },
  {
    id: "interactive-html",
    label: "2D 交互",
    icon: Box,
    tone: "hover:text-palette-green",
  },
  {
    id: "quiz",
    label: "知识测验",
    icon: ClipboardCheck,
    tone: "hover:text-palette-orange",
  },
  {
    id: "complete",
    label: "学完打卡",
    icon: CheckCircle2,
    tone: "hover:text-brand-gold",
  },
] as const;

export function TaskSectionNav({
  extended,
  hasKnowledgeMap,
}: {
  extended: boolean;
  hasKnowledgeMap: boolean;
}) {
  const visibleSections = sections.filter((section) => {
    if (!extended && ["knowledge-video", "interactive-html"].includes(section.id)) {
      return false;
    }
    return hasKnowledgeMap || section.id !== "knowledge-map";
  });

  return (
    <nav
      aria-label="学习任务内容导航"
      className="fixed left-2 top-1/2 z-30 hidden -translate-y-1/2 flex-col gap-1.5 rounded-2xl border border-white/75 bg-[color-mix(in_oklch,var(--bg-canvas)_78%,transparent)] p-1.5 shadow-[0_10px_30px_color-mix(in_oklch,var(--border-muted)_28%,transparent)] backdrop-blur-xl lg:flex"
    >
      <a
        href="#task-top"
        title="回到顶部"
        className="group flex h-10 w-10 items-center overflow-hidden rounded-xl bg-white/55 text-brand-medium shadow-[0_2px_7px_color-mix(in_oklch,var(--border-muted)_16%,transparent)] transition-[width,transform,background-color,color,box-shadow] duration-300 ease-out hover:w-32 hover:translate-x-1 hover:bg-palette-yellow-mist hover:text-brand-dark hover:shadow-[0_7px_18px_color-mix(in_oklch,var(--border-muted)_26%,transparent)] focus-visible:w-32 focus-visible:translate-x-1 focus-visible:bg-palette-yellow-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-palette-orange/35"
      >
        <span className="flex size-10 shrink-0 items-center justify-center">
          <ArrowUp
            className="size-[18px] transition-transform duration-300 ease-out group-hover:-translate-y-0.5 group-hover:scale-125 group-focus-visible:-translate-y-0.5 group-focus-visible:scale-125"
            strokeWidth={2.3}
          />
        </span>
        <span className="whitespace-nowrap pr-3 text-xs font-extrabold opacity-0 transition-opacity delay-0 duration-150 group-hover:opacity-100 group-hover:delay-100 group-focus-visible:opacity-100">
          回到顶部
        </span>
        <span className="sr-only">回到学习任务顶部</span>
      </a>
      {visibleSections.map(({ id, label, icon: Icon, tone }) => (
        <a
          key={id}
          href={`#${id}`}
          title={label}
          className={`group flex h-10 w-10 items-center overflow-hidden rounded-xl bg-white/55 text-brand-medium shadow-[0_2px_7px_color-mix(in_oklch,var(--border-muted)_16%,transparent)] transition-[width,transform,background-color,color,box-shadow] duration-300 ease-out hover:w-32 hover:translate-x-1 hover:bg-white/95 hover:shadow-[0_7px_18px_color-mix(in_oklch,var(--border-muted)_26%,transparent)] focus-visible:w-32 focus-visible:translate-x-1 focus-visible:bg-white/95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-palette-orange/35 ${tone}`}
        >
          <span className="flex size-10 shrink-0 items-center justify-center">
            <Icon
              className="size-[18px] transition-transform duration-300 ease-out group-hover:scale-125 group-focus-visible:scale-125"
              strokeWidth={2.15}
            />
          </span>
          <span className="whitespace-nowrap pr-3 text-xs font-extrabold opacity-0 transition-opacity delay-0 duration-150 group-hover:opacity-100 group-hover:delay-100 group-focus-visible:opacity-100">
            {label}
          </span>
          <span className="sr-only">跳转到{label}</span>
        </a>
      ))}
    </nav>
  );
}
