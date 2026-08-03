"use client";

import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Film,
  Eye,
  EyeOff,
  FilePen,
  BookOpen,
  Lightbulb,
  Search,
  Star,
  X,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  useBookmarks,
  useMistakes,
} from "@/lib/query/mistakes";
import { requestJson } from "@/lib/query/utils";
import type { BookmarkItem, QuizProblemReview } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

type Mode = "mistakes" | "bookmarks";

export function MistakesClient() {
  const [mode, setMode] = useState<Mode>("mistakes");
  const [includeHidden, setIncludeHidden] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());

  const mistakesQuery = useMistakes(includeHidden, deferredSearch);
  const bookmarksQuery = useBookmarks(deferredSearch);

  const mistakeItems = mistakesQuery.data ?? [];
  const bookmarkItems = bookmarksQuery.data ?? [];

  const activeIndex = useMemo(
    () => mistakeItems.findIndex((it) => it.id === activeId),
    [mistakeItems, activeId],
  );
  const activeItem = activeIndex >= 0 ? mistakeItems[activeIndex] : null;

  return (
    <div className="min-h-dvh w-full bg-canvas">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-10 px-8 py-10 lg:px-12">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-1.5 rounded-full border border-white/80 bg-white/60 px-4 py-2 text-sm font-bold text-brand-dark shadow-[0_4px_12px_color-mix(in_oklch,var(--border-muted)_30%,transparent)] backdrop-blur-md transition-all duration-200 hover:-translate-y-px hover:bg-white/95"
        >
          <ArrowLeft className="size-4" />
          返回主页面
        </Link>

        <header className="flex flex-col gap-3">
          <h1 className="flex items-center bg-gradient-to-br from-brand-dark to-palette-orange bg-clip-text text-5xl font-extrabold tracking-tight text-transparent md:text-[56px]">
            错题本 / 收藏夹
            <span className="ml-1 animate-pulse font-normal text-palette-orange [text-shadow:0_0_10px_color-mix(in_oklch,var(--palette-orange)_50%,transparent)]">
              |
            </span>
          </h1>
          <p className="text-2xl font-medium text-brand-medium md:text-[28px]">
            智能收集错题与收藏题目，精准定位薄弱环节
          </p>
        </header>

        <Tabs
          value={mode}
          onValueChange={(value) => {
            setMode(value as Mode);
            setActiveId(null);
          }}
        >
          <TabsList className="grid h-auto w-full max-w-[360px] grid-cols-2 gap-1 rounded-full bg-canvas p-1 shadow-[inset_2px_2px_5px_color-mix(in_oklch,var(--border-muted)_25%,transparent),inset_-2px_-2px_5px_rgba(255,255,255,0.8)]">
            <TabsTrigger
              value="mistakes"
              className="h-[46px] gap-1.5 rounded-full text-[15px] font-semibold text-brand-medium transition-colors data-active:bg-gradient-to-br data-active:from-palette-yellow data-active:to-palette-yellow-light data-active:text-brand-dark data-active:shadow-[0_2px_8px_color-mix(in_oklch,var(--palette-yellow)_35%,transparent)]"
            >
              <FilePen className="size-4" />
              错题本
            </TabsTrigger>
            <TabsTrigger
              value="bookmarks"
              className="h-[46px] gap-1.5 rounded-full text-[15px] font-semibold text-brand-medium transition-colors data-active:bg-gradient-to-br data-active:from-palette-yellow data-active:to-palette-yellow-light data-active:text-brand-dark data-active:shadow-[0_2px_8px_color-mix(in_oklch,var(--palette-yellow)_35%,transparent)]"
            >
              <Star className="size-4" />
              收藏夹
            </TabsTrigger>
          </TabsList>

          <TabsContent value="mistakes" className="mt-6 flex flex-col gap-6">
            <ProblemSearch value={search} onChange={setSearch} />
            <CountBar count={mistakeItems.length} mode="mistakes">
              <label className="flex cursor-pointer items-center gap-2 rounded-full bg-white/70 px-3 py-1.5 text-xs font-semibold text-brand-medium shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                <Checkbox
                  checked={includeHidden}
                  onCheckedChange={(v) => setIncludeHidden(v === true)}
                />
                显示已隐藏错题
              </label>
            </CountBar>
            <CardGrid
              items={mistakeItems}
              isLoading={mistakesQuery.isLoading}
              mode="mistakes"
              onOpen={setActiveId}
              emptyHint={
                deferredSearch
                  ? "没有找到匹配的错题，换个关键词试试"
                  : "还没有错题，先去做几次小测吧"
              }
            />
          </TabsContent>

          <TabsContent value="bookmarks" className="mt-6 flex flex-col gap-6">
            <ProblemSearch value={search} onChange={setSearch} />
            <CountBar count={bookmarkItems.length} mode="bookmarks" />
            <BookmarkGrid
              items={bookmarkItems}
              isLoading={bookmarksQuery.isLoading}
              emptyHint={
                deferredSearch
                  ? "没有找到匹配的收藏题目，换个关键词试试"
                  : "还没有收藏题目，做小测时点击星标即可"
              }
            />
          </TabsContent>
        </Tabs>
      </div>

      <DetailDialog
        item={activeItem}
        index={activeIndex}
        total={mistakeItems.length}
        onClose={() => setActiveId(null)}
        onPrev={() =>
          activeIndex > 0 && setActiveId(mistakeItems[activeIndex - 1].id)
        }
        onNext={() =>
          activeIndex >= 0 &&
          activeIndex < mistakeItems.length - 1 &&
          setActiveId(mistakeItems[activeIndex + 1].id)
        }
      />
    </div>
  );
}

function ProblemSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative">
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-0.5 rounded-[30px] bg-gradient-to-br from-palette-yellow via-palette-orange-light to-palette-orange opacity-50 blur-[2px]"
      />
      <div className="relative flex h-14 items-center gap-3 rounded-[28px] border-2 border-transparent bg-white/95 px-6 text-base text-brand-light shadow-[inset_2px_2px_6px_color-mix(in_oklch,var(--border-muted)_15%,transparent),inset_-2px_-2px_6px_rgba(255,255,255,0.8),0_4px_12px_color-mix(in_oklch,var(--border-muted)_15%,transparent)] backdrop-blur-md focus-within:text-brand-medium focus-within:shadow-[0_6px_20px_color-mix(in_oklch,var(--palette-orange)_24%,transparent)]">
        <Search className="size-5 shrink-0" />
        <input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="搜索题目内容…"
          aria-label="搜索题目"
          className="h-full min-w-0 flex-1 bg-transparent font-medium text-brand-dark outline-none placeholder:text-brand-light"
        />
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="清空搜索"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-palette-yellow-mist text-brand-medium transition hover:bg-palette-yellow-light hover:text-brand-dark"
          >
            <X className="size-3.5" strokeWidth={2.5} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CountBar({
  count,
  mode,
  children,
}: {
  count: number;
  mode: Mode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span
        className={cn(
          "inline-flex items-center gap-2 rounded-2xl border px-5 py-2.5 text-sm font-bold text-brand-dark shadow-[0_2px_6px_color-mix(in_oklch,var(--border-muted)_25%,transparent)] transition hover:-translate-y-0.5 hover:shadow-[0_6px_16px_color-mix(in_oklch,var(--border-muted)_30%,transparent)]",
          mode === "mistakes"
            ? "border-palette-orange/30 bg-gradient-to-br from-palette-orange-mist to-palette-orange-lighter"
            : "border-palette-yellow/40 bg-gradient-to-br from-palette-yellow-lighter to-palette-yellow-light",
        )}
      >
        <span aria-hidden className="flex size-5 items-center justify-center">
          {mode === "mistakes" ? (
            <ClipboardList className="size-4" strokeWidth={2.2} />
          ) : (
            <Star className="size-4 fill-palette-orange stroke-palette-orange" strokeWidth={2} />
          )}
        </span>
        <span>共</span>
        <strong className="text-xl font-black">{count}</strong>
        <span>题</span>
      </span>
      {children}
    </div>
  );
}

function BookmarkGrid({
  items,
  isLoading,
  emptyHint,
}: {
  items: BookmarkItem[];
  isLoading: boolean;
  emptyHint: string;
}) {
  const queryClient = useQueryClient();
  const toggleBookmark = useMutation({
    mutationFn: async (item: BookmarkItem) => {
      const url =
        item.kind === "quiz_problem"
          ? `/api/quiz-problems/${item.id}/bookmark`
          : item.kind === "knowledge_video"
            ? `/api/knowledge-videos/${item.id}`
            : `/api/knowledge-explanations/${item.id}`;
      await requestJson(url, { method: "PATCH" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me", "bookmarks"] });
      queryClient.invalidateQueries({ queryKey: ["me", "mistakes"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-44 animate-pulse rounded-2xl border border-border/30 bg-white/60" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-[28px] border-2 border-dashed border-border/30 bg-white/40 px-10 py-20 text-center shadow-[0_2px_6px_color-mix(in_oklch,var(--border-muted)_20%,transparent)]">
        <Star className="size-8 fill-palette-orange stroke-palette-orange" />
        <p className="text-lg font-extrabold text-brand-dark">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-6" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
      {items.map((item) => {
        const Icon =
          item.kind === "knowledge_video"
            ? Film
            : item.kind === "knowledge_explanation"
              ? BookOpen
              : ClipboardList;
        return (
          <article
            key={`${item.kind}-${item.id}`}
            className="flex min-h-44 flex-col gap-3.5 rounded-[20px] border-[1.5px] border-white/70 bg-gradient-to-b from-white/85 to-palette-yellow-mist/50 p-6 shadow-[0_4px_12px_color-mix(in_oklch,var(--border-muted)_25%,transparent)]"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-gradient-to-br from-palette-yellow-lighter to-palette-yellow-light text-palette-orange">
                <Icon className="size-5" strokeWidth={2} />
              </span>
              <button
                type="button"
                onClick={() => toggleBookmark.mutate(item)}
                disabled={toggleBookmark.isPending}
                aria-label="取消收藏"
                title="取消收藏"
                className="flex size-8 items-center justify-center rounded-[10px] bg-canvas text-palette-orange transition hover:scale-110 hover:bg-palette-yellow-light disabled:opacity-60"
              >
                <Star className="size-3.5 fill-current" />
              </button>
            </div>
            <p className="text-sm font-bold text-palette-orange">{item.title}</p>
            <p className="line-clamp-3 text-base font-bold leading-relaxed text-brand-dark">{item.description}</p>
            <span className="mt-auto text-xs font-semibold text-brand-light">{formatTime(item.created_at)}</span>
          </article>
        );
      })}
    </div>
  );
}

function CardGrid({
  items,
  isLoading,
  mode,
  onOpen,
  emptyHint,
}: {
  items: QuizProblemReview[];
  isLoading: boolean;
  mode: Mode;
  onOpen: (id: number) => void;
  emptyHint: string;
}) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-44 animate-pulse rounded-2xl border border-border/30 bg-white/60"
          />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-[28px] border-2 border-dashed border-border/30 bg-white/40 px-10 py-20 text-center shadow-[0_2px_6px_color-mix(in_oklch,var(--border-muted)_20%,transparent)]">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-palette-yellow-light to-palette-orange-mist text-palette-orange shadow-[0_4px_12px_color-mix(in_oklch,var(--palette-orange)_25%,transparent)] [filter:drop-shadow(0_4px_8px_color-mix(in_oklch,var(--palette-orange)_25%,transparent))]">
          {mode === "mistakes" ? (
            <ClipboardList className="size-8" strokeWidth={1.6} />
          ) : (
            <Star className="size-8 fill-palette-orange stroke-palette-orange" strokeWidth={1.6} />
          )}
        </div>
        <p className="text-lg font-extrabold text-brand-dark">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div
      className="grid gap-6"
      style={{
        gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
      }}
    >
      {items.map((it) => (
        <Card key={it.id} item={it} mode={mode} onOpen={onOpen} />
      ))}
    </div>
  );
}

function Card({
  item,
  mode,
  onOpen,
}: {
  item: QuizProblemReview;
  mode: Mode;
  onOpen: (id: number) => void;
}) {
  const qc = useQueryClient();

  const toggleHide = useMutation({
    mutationFn: async () => {
      await requestJson(
        `/api/quiz-problems/${item.id}/mistake-visibility`,
        { method: "PATCH" },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me", "mistakes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleBookmark = useMutation({
    mutationFn: async () => {
      await requestJson(`/api/quiz-problems/${item.id}/bookmark`, {
        method: "PATCH",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me", "bookmarks"] });
      qc.invalidateQueries({ queryKey: ["me", "mistakes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const dimmed = mode === "mistakes" && item.mistake_hidden;

  return (
    <button
      type="button"
      onClick={() => onOpen(item.id)}
      className={cn(
        "group relative flex flex-col gap-3.5 overflow-hidden rounded-[20px] border-[1.5px] border-white/70 bg-gradient-to-b from-white/85 to-palette-yellow-mist/50 p-6 text-left shadow-[0_4px_12px_color-mix(in_oklch,var(--border-muted)_25%,transparent)] backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-palette-orange/40 hover:shadow-[0_12px_28px_color-mix(in_oklch,var(--border-muted)_35%,transparent)]",
        dimmed && "opacity-55",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-x-0 top-0 h-[3px]",
          mode === "mistakes"
            ? "bg-gradient-to-r from-palette-orange to-palette-orange-light"
            : "bg-gradient-to-r from-palette-yellow to-palette-yellow-light",
        )}
      />

      <div className="flex items-start justify-between gap-3">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-[14px] shadow-[0_2px_8px_color-mix(in_oklch,var(--border-muted)_25%,transparent)]",
            mode === "mistakes"
              ? "bg-gradient-to-br from-palette-orange-mist to-palette-orange-lighter text-destructive"
              : "bg-gradient-to-br from-palette-yellow-lighter to-palette-yellow-light text-palette-orange",
          )}
        >
          {mode === "mistakes" ? (
            <XCircle className="size-5" strokeWidth={2} />
          ) : (
            <Star className="size-5 fill-palette-orange stroke-palette-orange" strokeWidth={1.8} />
          )}
        </div>
      </div>

      <p className="line-clamp-2 text-base font-bold leading-relaxed text-brand-dark">
        {item.content}
      </p>

      <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-bold tracking-[0.02em]">
        <span className="rounded-lg bg-palette-purple-mist px-3 py-[5px] text-palette-purple">
          {item.source.subject_name}
        </span>
        <span className="rounded-lg bg-palette-blue-mist px-3 py-[5px] text-palette-blue">
          {item.source.stage_title}
        </span>
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-dashed border-border/25 pt-3 text-xs font-semibold text-brand-light">
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3.5" strokeWidth={2} />
          {formatTime(item.created_at)}
        </span>
        {mode === "mistakes" ? (
          <span
            role="button"
            aria-label={item.mistake_hidden ? "取消隐藏" : "隐藏错题"}
            onClick={(e) => {
              e.stopPropagation();
              toggleHide.mutate();
            }}
            className="flex size-8 items-center justify-center rounded-[10px] bg-canvas text-brand-medium shadow-[0_2px_6px_color-mix(in_oklch,var(--border-muted)_20%,transparent)] transition hover:scale-110 hover:bg-palette-yellow-mist hover:text-palette-orange hover:shadow-[0_4px_10px_color-mix(in_oklch,var(--border-muted)_30%,transparent)]"
          >
            {item.mistake_hidden ? (
              <EyeOff className="size-3.5" />
            ) : (
              <Eye className="size-3.5" />
            )}
          </span>
        ) : (
          <span
            role="button"
            aria-label="取消收藏"
            onClick={(e) => {
              e.stopPropagation();
              toggleBookmark.mutate();
            }}
            className="flex size-8 items-center justify-center rounded-[10px] bg-canvas text-palette-orange shadow-[0_2px_6px_color-mix(in_oklch,var(--border-muted)_20%,transparent)] transition hover:scale-110 hover:bg-palette-yellow-light hover:shadow-[0_4px_10px_color-mix(in_oklch,var(--border-muted)_30%,transparent)]"
          >
            <Star className="size-3.5 fill-current" />
          </span>
        )}
      </div>
    </button>
  );
}

const OPTION_LETTERS = ["A", "B", "C", "D"] as const;

function DetailDialog({
  item,
  index,
  total,
  onClose,
  onPrev,
  onNext,
}: {
  item: QuizProblemReview | null;
  index: number;
  total: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const open = item !== null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="overflow-hidden border-[1.5px] border-palette-yellow-light/50 bg-white/90 p-0 shadow-[0_12px_28px_color-mix(in_oklch,var(--border-muted)_35%,transparent)] backdrop-blur-xl sm:max-w-[820px]"
      >
        <DialogTitle className="sr-only">题目详情</DialogTitle>
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-palette-orange via-palette-yellow to-palette-blue-light"
        />

        {item && (
          <div className="flex flex-col gap-5 px-10 pt-9 pb-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={index <= 0}
                  onClick={onPrev}
                  className="flex size-[38px] items-center justify-center rounded-xl bg-canvas text-brand-medium shadow-[0_2px_6px_color-mix(in_oklch,var(--border-muted)_25%,transparent)] transition hover:-translate-y-px hover:bg-palette-yellow-mist hover:text-brand-dark hover:shadow-[0_4px_10px_color-mix(in_oklch,var(--border-muted)_30%,transparent)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0 disabled:hover:bg-canvas disabled:hover:text-brand-medium"
                  aria-label="上一题"
                >
                  <ChevronLeft className="size-4" strokeWidth={2.5} />
                </button>
                <span className="min-w-[50px] text-center text-[15px] font-bold text-brand-medium">
                  {index + 1} / {total}
                </span>
                <button
                  type="button"
                  disabled={index >= total - 1}
                  onClick={onNext}
                  className="flex size-[38px] items-center justify-center rounded-xl bg-canvas text-brand-medium shadow-[0_2px_6px_color-mix(in_oklch,var(--border-muted)_25%,transparent)] transition hover:-translate-y-px hover:bg-palette-yellow-mist hover:text-brand-dark hover:shadow-[0_4px_10px_color-mix(in_oklch,var(--border-muted)_30%,transparent)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0 disabled:hover:bg-canvas disabled:hover:text-brand-medium"
                  aria-label="下一题"
                >
                  <ChevronRight className="size-4" strokeWidth={2.5} />
                </button>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭"
                className="flex size-9 items-center justify-center rounded-full border-[1.5px] border-border/25 bg-canvas text-brand-dark shadow-[0_2px_8px_color-mix(in_oklch,var(--border-muted)_20%,transparent)] transition duration-200 hover:rotate-90 hover:scale-110 hover:border-palette-orange-light hover:shadow-[0_4px_12px_color-mix(in_oklch,var(--palette-orange)_25%,transparent)]"
              >
                <X className="size-3.5" strokeWidth={2.5} />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-palette-orange to-palette-yellow px-4 py-1.5 text-[15px] font-bold text-white shadow-[0_2px_8px_color-mix(in_oklch,var(--palette-orange)_35%,transparent)] [text-shadow:0_1px_2px_color-mix(in_oklch,var(--brand-medium)_30%,transparent)]">
                {item.source.task_title}
              </span>
              <span className="rounded-full bg-palette-purple-mist px-2.5 py-1 text-xs font-bold text-palette-purple">
                {item.source.subject_name}
              </span>
              <span className="rounded-full bg-palette-blue-mist px-2.5 py-1 text-xs font-bold text-palette-blue">
                {item.source.stage_title}
              </span>
            </div>

            <p
              className="text-lg font-semibold leading-[1.7] text-brand-dark"
              style={{ whiteSpace: "pre-wrap" }}
            >
              {item.content}
            </p>

            <div className="flex flex-col gap-2.5">
              {OPTION_LETTERS.map((letter) => {
                const text =
                  item[
                    `choice_${letter.toLowerCase()}` as
                      | "choice_a"
                      | "choice_b"
                      | "choice_c"
                      | "choice_d"
                  ];
                const isCorrect = item.answer === letter;
                const isChosen = item.chosen_answer === letter;
                const isUserWrong = isChosen && !isCorrect;

                return (
                  <div
                    key={letter}
                    className={cn(
                      "flex items-center gap-4 rounded-2xl border-2 px-[18px] py-3.5 text-[15px] shadow-[0_2px_6px_color-mix(in_oklch,var(--border-muted)_15%,transparent)]",
                      isCorrect
                        ? "border-palette-green/30 bg-palette-green-lighter/45"
                        : isUserWrong
                          ? "border-destructive/30 bg-danger-surface"
                          : "border-palette-yellow-light bg-canvas",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-[34px] shrink-0 items-center justify-center rounded-[10px] text-sm font-bold shadow-[3px_3px_6px_color-mix(in_oklch,var(--border-muted)_25%,transparent),-3px_-3px_6px_rgba(255,255,255,0.9)]",
                        isCorrect
                          ? "bg-gradient-to-br from-palette-green-light to-palette-green text-white"
                          : isUserWrong
                            ? "bg-gradient-to-br from-danger-light to-destructive text-white"
                            : "bg-gradient-to-br from-palette-yellow-lighter to-palette-yellow-light text-brand-medium",
                      )}
                    >
                      {letter}
                    </span>
                    <span
                      className="flex-1 font-medium leading-relaxed text-brand-dark"
                      style={{ whiteSpace: "pre-wrap" }}
                    >
                      {text}
                    </span>
                    {isCorrect ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-palette-green-lighter px-3 py-0.5 text-[13px] font-bold text-palette-green">
                        <Check className="size-3.5" strokeWidth={3} />
                        正确答案
                      </span>
                    ) : isUserWrong ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-danger-surface px-3 py-0.5 text-[13px] font-bold text-destructive">
                        <X className="size-3.5" strokeWidth={3} />
                        你的选择
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {item.explanation ? (
              <div className="rounded-2xl bg-palette-yellow-mist/60 p-4 text-sm leading-relaxed text-brand-dark">
                <div className="mb-1 inline-flex items-center gap-1 text-xs font-bold text-brand-medium">
                  <Lightbulb className="size-3.5" strokeWidth={2.2} />
                  解析
                </div>
                <p style={{ whiteSpace: "pre-wrap" }}>{item.explanation}</p>
              </div>
            ) : null}

            <div className="flex items-center gap-4 border-t border-dashed border-border/25 pt-4 text-xs font-semibold text-brand-light">
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3.5" strokeWidth={2} />
                {formatTime(item.created_at)}
              </span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function formatTime(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
