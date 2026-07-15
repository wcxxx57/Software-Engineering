"use client";

import {
  BookmarkX,
  BookOpen,
  Check,
  ChevronDown,
  Clapperboard,
  FlaskConical,
  Loader2,
  Search,
  SearchCode,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { setActiveSubjectAction } from "@/app/(app)/dashboard/actions";
import type {
  CodeVideo,
  InteractiveHtml,
  KnowledgeVideo,
  QuizProblemReview,
  StudySubject,
} from "@/lib/api/schemas";
import { humanizeApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

type SearchResults = {
  subjects: StudySubject[];
  knowledge_videos: KnowledgeVideo[];
  code_videos: CodeVideo[];
  interactive_htmls: InteractiveHtml[];
  mistakes: QuizProblemReview[];
};

type Scope =
  | "all"
  | "subjects"
  | "knowledge_videos"
  | "code_videos"
  | "interactive_htmls"
  | "mistakes";

const SCOPE_OPTIONS: { value: Scope; label: string; placeholder: string }[] = [
  { value: "all", label: "全部", placeholder: "搜索知识点、计划或问题…" },
  { value: "subjects", label: "学习主题", placeholder: "按主题名称搜索…" },
  { value: "knowledge_videos", label: "K2V 视频", placeholder: "按知识点 prompt 搜索…" },
  { value: "code_videos", label: "C2V 视频", placeholder: "按代码题目 prompt 搜索…" },
  { value: "interactive_htmls", label: "交互式实验室", placeholder: "按实验 prompt 搜索…" },
  { value: "mistakes", label: "错题本", placeholder: "按错题题干搜索…" },
];

const EMPTY: SearchResults = {
  subjects: [],
  knowledge_videos: [],
  code_videos: [],
  interactive_htmls: [],
  mistakes: [],
};

function truncate(s: string, n = 60): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function DashboardSearch() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [scopeOpen, setScopeOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const scopeMeta = useMemo(
    () => SCOPE_OPTIONS.find((o) => o.value === scope) ?? SCOPE_OPTIONS[0],
    [scope],
  );

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!debounced) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({ q: debounced });
    if (scope !== "all") params.set("scope", scope);
    fetch(`/api/search?${params.toString()}`, {
      signal: ctrl.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message ?? `请求失败 (${res.status})`);
        }
        return res.json();
      })
      .then((body) => {
        setResults((body.data as SearchResults) ?? EMPTY);
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        toast.error(humanizeApiError(err));
        setResults(EMPTY);
      })
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [debounced, scope]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setScopeOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const total =
    results.subjects.length +
    results.knowledge_videos.length +
    results.code_videos.length +
    results.interactive_htmls.length +
    results.mistakes.length;

  const showPanel = open && debounced.length > 0;

  const closeAfterNav = () => {
    setOpen(false);
    setScopeOpen(false);
  };

  const handleSubjectClick = (id: number) => {
    startTransition(async () => {
      const result = await setActiveSubjectAction(id);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      closeAfterNav();
      router.refresh();
    });
  };

  const showSection = (s: Scope) => scope === "all" || scope === s;

  return (
    <div ref={wrapRef} className="relative w-full max-w-[680px]">
      <div className="flex h-[60px] items-center rounded-3xl border-2 border-palette-yellow-light bg-white/95 shadow-[inset_2px_2px_6px_rgba(0,0,0,0.05),inset_-2px_-2px_6px_rgba(255,255,255,0.8),0_4px_12px_rgba(0,0,0,0.1)] backdrop-blur-sm">
        <button
          type="button"
          onClick={() => {
            setScopeOpen((o) => !o);
            setOpen(false);
          }}
          className="flex h-full items-center gap-1.5 border-r border-border/30 px-5 text-[15px] font-semibold text-brand-medium transition hover:text-brand-dark"
          aria-haspopup="listbox"
          aria-expanded={scopeOpen}
        >
          {scopeMeta.label}
          <ChevronDown
            className={cn(
              "size-3.5 transition-transform",
              scopeOpen && "rotate-180",
            )}
          />
        </button>
        <div className="flex flex-1 items-center gap-3 px-6 text-base text-brand-dark">
          <Search className="size-4 text-brand-light" />
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
              setScopeOpen(false);
            }}
            onFocus={() => {
              setOpen(true);
              setScopeOpen(false);
            }}
            placeholder={scopeMeta.placeholder}
            className="flex-1 bg-transparent text-base font-medium placeholder:text-brand-light focus:outline-none"
          />
          {loading ? (
            <Loader2 className="size-4 animate-spin text-brand-light" />
          ) : null}
        </div>
      </div>

      {scopeOpen ? (
        <div
          role="listbox"
          className="absolute top-full left-0 z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-palette-yellow-light/80 bg-white/98 shadow-[0_8px_24px_rgba(0,0,0,0.12)] backdrop-blur-sm"
        >
          {SCOPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={opt.value === scope}
              onClick={() => {
                setScope(opt.value);
                setScopeOpen(false);
                if (debounced) setOpen(true);
              }}
              className={cn(
                "flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm font-medium transition hover:bg-palette-yellow-light/30",
                opt.value === scope
                  ? "text-brand-dark"
                  : "text-brand-medium",
              )}
            >
              {opt.label}
              {opt.value === scope ? (
                <Check className="size-4 text-palette-orange" />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {showPanel ? (
        <div className="absolute top-full left-0 right-0 z-50 mt-2 max-h-[60vh] overflow-y-auto rounded-2xl border border-palette-yellow-light/80 bg-white/98 shadow-[0_8px_24px_rgba(0,0,0,0.12)] backdrop-blur-sm">
          {total === 0 && !loading ? (
            <div className="px-6 py-8 text-center text-sm font-medium text-brand-light">
              没有找到与「{debounced}」相关的{scope === "all" ? "内容" : scopeMeta.label}
            </div>
          ) : null}

          <Section
            title="学习主题"
            visible={showSection("subjects") && results.subjects.length > 0}
            icon={BookOpen}
            color="text-palette-orange"
          >
            {results.subjects.map((s) => (
              <button
                key={`subject-${s.id}`}
                type="button"
                onClick={() => handleSubjectClick(s.id)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-palette-yellow-light/30"
              >
                <span className="flex-1 truncate text-sm font-semibold text-brand-dark">
                  {s.subject}
                </span>
                <span className="rounded-full bg-palette-yellow-light/60 px-2 py-0.5 text-xs font-bold text-brand-medium">
                  {s.language}
                </span>
              </button>
            ))}
          </Section>

          <Section
            title="K2V · 知识视频"
            visible={
              showSection("knowledge_videos") &&
              results.knowledge_videos.length > 0
            }
            icon={Clapperboard}
            color="text-palette-yellow"
          >
            {results.knowledge_videos.map((kv) => (
              <Link
                key={`kv-${kv.id}`}
                href="/k2v"
                onClick={closeAfterNav}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-palette-yellow-light/30"
              >
                <span className="flex-1 truncate text-sm font-medium text-brand-dark">
                  {truncate(kv.prompt)}
                </span>
                <StatusBadge status={kv.status} />
              </Link>
            ))}
          </Section>

          <Section
            title="C2V · 代码视频"
            visible={
              showSection("code_videos") && results.code_videos.length > 0
            }
            icon={SearchCode}
            color="text-palette-orange"
          >
            {results.code_videos.map((cv) => (
              <Link
                key={`cv-${cv.id}`}
                href="/c2v"
                onClick={closeAfterNav}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-palette-yellow-light/30"
              >
                <span className="flex-1 truncate text-sm font-medium text-brand-dark">
                  {truncate(cv.prompt)}
                </span>
                <StatusBadge status={cv.status} />
              </Link>
            ))}
          </Section>

          <Section
            title="交互式实验室"
            visible={
              showSection("interactive_htmls") &&
              results.interactive_htmls.length > 0
            }
            icon={FlaskConical}
            color="text-palette-blue"
          >
            {results.interactive_htmls.map((ih) => (
              <Link
                key={`ih-${ih.id}`}
                href="/interactive"
                onClick={closeAfterNav}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-palette-yellow-light/30"
              >
                <span className="flex-1 truncate text-sm font-medium text-brand-dark">
                  {truncate(ih.prompt)}
                </span>
                <StatusBadge status={ih.status} />
              </Link>
            ))}
          </Section>

          <Section
            title="错题本"
            visible={showSection("mistakes") && results.mistakes.length > 0}
            icon={BookmarkX}
            color="text-destructive"
          >
            {results.mistakes.map((m) => (
              <Link
                key={`m-${m.id}`}
                href="/mistakes"
                onClick={closeAfterNav}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-palette-yellow-light/30"
              >
                <span className="flex-1 truncate text-sm font-medium text-brand-dark">
                  {truncate(m.content)}
                </span>
                <span className="rounded-full bg-danger-surface/60 px-2 py-0.5 text-xs font-bold text-destructive">
                  {m.source.subject_name}
                </span>
              </Link>
            ))}
          </Section>
        </div>
      ) : null}
    </div>
  );
}

function Section({
  title,
  visible,
  icon: Icon,
  color,
  children,
}: {
  title: string;
  visible: boolean;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  children: React.ReactNode;
}) {
  if (!visible) return null;
  return (
    <div className="border-b border-border/20 last:border-b-0">
      <div className="flex items-center gap-2 px-4 pt-3 pb-1 text-xs font-bold tracking-wide text-brand-medium uppercase">
        <Icon className={cn("size-3.5", color)} />
        {title}
      </div>
      <div className="pb-2">{children}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    QUEUING: {
      label: "排队中",
      className: "bg-palette-yellow-light/70 text-brand-medium",
    },
    GENERATING: {
      label: "生成中",
      className: "bg-palette-yellow-light/70 text-brand-medium",
    },
    FINISHED: {
      label: "已完成",
      className: "bg-palette-green-lighter text-palette-green",
    },
    FAILED: {
      label: "失败",
      className: "bg-danger-surface/60 text-destructive",
    },
  };
  const info = map[status] ?? { label: status, className: "bg-border/20 text-brand-medium" };
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", info.className)}>
      {info.label}
    </span>
  );
}
