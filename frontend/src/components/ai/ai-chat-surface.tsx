"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  BookOpen,
  Clock3,
  Loader2,
  Maximize2,
  MessageSquareText,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  Target,
  Trash2,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

import type {
  AiChatConversation,
  AiChatMessage,
  AiContext,
} from "@/lib/api/schemas";
import { consumeAiStream } from "@/lib/ai/stream";
import {
  appendAiHistory,
  clearAiHistory,
  listAiConversations,
  loadAiHistory,
} from "@/lib/ai/history";

type AiChatSurfaceProps = {
  context: AiContext;
  mode?: "compact" | "fullscreen";
  className?: string;
  onClose?: () => void;
  initialConversationId?: string;
};

export function AiChatSurface({
  context,
  mode = "compact",
  className = "",
  onClose,
  initialConversationId,
}: AiChatSurfaceProps) {
  const compact = mode === "compact";
  const previewOnly = context.is_preview === true;
  const scopeIdentity =
    context.scope.type === "general" ? "general" : `task:${context.scope.task_id}`;
  const [conversationId, setConversationId] = useState(initialConversationId ?? "");
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [conversations, setConversations] = useState<AiChatConversation[]>([]);
  const [draft, setDraft] = useState("");
  const [isHydrated, setIsHydrated] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isDeletingConversation, setIsDeletingConversation] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const [historyListError, setHistoryListError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastQuestionRef = useRef<string | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastMessageContent = messages[messages.length - 1]?.content;

  const refreshConversations = useCallback(
    async (signal?: AbortSignal) => {
      if (compact || previewOnly) return;
      setIsHistoryLoading(true);
      try {
        const items = await listAiConversations(context.scope, signal);
        setConversations(items);
        setHistoryListError(null);
      } catch (error) {
        if (signal?.aborted) return;
        setHistoryListError(
          error instanceof Error ? error.message : "历史会话列表加载失败",
        );
      } finally {
        if (!signal?.aborted) setIsHistoryLoading(false);
      }
    },
    [compact, context.scope, previewOnly],
  );

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const nextConversationId = initialConversationId ?? createConversationId();
    setConversationId(nextConversationId);
    setIsHydrated(false);
    setMessages([]);
    setDraft("");
    setStreamError(null);
    setHistoryNotice(null);
    abortRef.current?.abort();
    setIsStreaming(false);
    if (previewOnly || !initialConversationId) {
      setIsHydrated(true);
      return () => {
        active = false;
        controller.abort();
      };
    }
    void loadAiHistory(context.scope, nextConversationId, controller.signal)
      .then((serverMessages) => {
        if (!active) return;
        setMessages(serverMessages);
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return;
        setHistoryNotice(error instanceof Error ? error.message : "AI 伴学历史暂时不可用");
      })
      .finally(() => {
        if (active) setIsHydrated(true);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [context.scope, initialConversationId, previewOnly, scopeIdentity]);

  useEffect(() => {
    if (compact || previewOnly) return;
    const controller = new AbortController();
    void refreshConversations(controller.signal);
    return () => controller.abort();
  }, [compact, previewOnly, refreshConversations, scopeIdentity]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      node.scrollTo({ top: node.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
    }
  }, [messages.length, lastMessageContent]);

  const sendMessage = async (rawQuestion: string, startingMessages = messages) => {
    const question = rawQuestion.trim();
    if (!question || !conversationId || !isHydrated || isStreaming || context.is_preview) return;
    const userMessage: AiChatMessage = {
      id: createMessageId(),
      role: "user",
      content: question,
      created_at: Date.now(),
    };
    const assistantMessage: AiChatMessage = {
      id: createMessageId(),
      role: "assistant",
      content: "",
      created_at: Date.now(),
    };
    // A stopped/failed generation can leave an empty assistant placeholder;
    // never send that invalid message back to the gateway on the next turn.
    const previousMessages = startingMessages.filter((message) => message.content.trim().length > 0);
    const history = [...previousMessages, userMessage];
    setMessages([...history, assistantMessage]);
    setDraft("");
    setStreamError(null);
    setIsStreaming(true);
    lastQuestionRef.current = question;
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      try {
        await appendAiHistory(context.scope, conversationId, [userMessage]);
        setHistoryNotice(null);
        void refreshConversations();
      } catch (error) {
        setHistoryNotice(
          error instanceof Error
            ? `${error.message}；本轮消息不会写入历史记录`
            : "数据库暂时不可用，本轮消息不会写入历史记录",
        );
      }

      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { accept: "text/event-stream", "content-type": "application/json" },
        body: JSON.stringify({
          scope: context.scope,
          messages: history.map(({ role, content }) => ({ role, content })),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(payload?.message ?? "AI 服务暂时不可用");
      }
      let assistantContent = "";
      let streamFinished = false;
      await consumeAiStream(response, (event) => {
        if (event.type === "delta") {
          assistantContent += event.data.text;
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantMessage.id
                ? { ...message, content: message.content + event.data.text }
                : message,
            ),
          );
        }
        if (event.type === "done") streamFinished = true;
        if (event.type === "error") {
          setStreamError(event.data.message);
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantMessage.id
                ? { ...message, content: event.data.message }
                : message,
            ),
          );
        }
      });
      if (streamFinished && assistantContent.trim()) {
        const persistedAssistant: AiChatMessage = {
          ...assistantMessage,
          content: assistantContent,
        };
        try {
          // Re-send the user message with the assistant response. The backend
          // is idempotent, so this also repairs a transient first-write failure.
          await appendAiHistory(context.scope, conversationId, [
            userMessage,
            persistedAssistant,
          ]);
          setHistoryNotice(null);
          void refreshConversations();
        } catch (error) {
          setHistoryNotice(
            error instanceof Error
              ? `${error.message}；本轮消息不会写入历史记录`
              : "数据库暂时不可用，本轮消息不会写入历史记录",
          );
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : "AI 生成失败，请重试";
        setStreamError(message);
        setMessages((current) =>
          current.map((item) =>
            item.id === assistantMessage.id && !item.content
              ? { ...item, content: message }
              : item,
          ),
        );
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsStreaming(false);
    }
  };

  const regenerateLastAnswer = () => {
    if (isStreaming) return;
    const assistantIndex = [...messages].map((message) => message.role).lastIndexOf("assistant");
    if (assistantIndex < 0) return;
    const userIndex = [...messages.slice(0, assistantIndex)].map((message) => message.role).lastIndexOf("user");
    if (userIndex < 0) return;
    const question = messages[userIndex].content;
    const startingMessages = messages.slice(0, userIndex);
    setMessages(startingMessages);
    void sendMessage(question, startingMessages);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendMessage(draft);
  };

  const startNewConversation = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setConversationId(createConversationId());
    setMessages([]);
    setDraft("");
    setStreamError(null);
    setHistoryNotice(null);
    setIsHydrated(true);
    lastQuestionRef.current = null;
    if (!compact && typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("conversationId");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  };

  const openConversation = async (nextConversationId: string) => {
    if (nextConversationId === conversationId || isStreaming || previewOnly) return;
    abortRef.current?.abort();
    setConversationId(nextConversationId);
    setMessages([]);
    setDraft("");
    setStreamError(null);
    setHistoryNotice(null);
    setIsHydrated(false);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("conversationId", nextConversationId);
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
    try {
      setMessages(await loadAiHistory(context.scope, nextConversationId));
    } catch (error) {
      setHistoryNotice(error instanceof Error ? error.message : "AI 伴学历史暂时不可用");
    } finally {
      setIsHydrated(true);
    }
  };

  const deleteConversation = () => {
    if (previewOnly) {
      startNewConversation();
      return;
    }
    if (isDeletingConversation) return;
    if (!window.confirm("确定删除当前对话吗？删除后无法恢复。")) return;
    const deletingConversationId = conversationId;
    setIsDeletingConversation(true);
    void clearAiHistory(context.scope, deletingConversationId)
      .then(() => {
        startNewConversation();
        void refreshConversations();
      })
      .catch((error: unknown) => {
        setHistoryNotice(error instanceof Error ? error.message : "数据库历史删除失败");
      })
      .finally(() => setIsDeletingConversation(false));
  };

  const taskTitle = context.task?.knowledge_point_title;
  const fullscreenHref = context.is_preview
    ? "/preview/iteration4?view=chat"
    : context.task
      ? `/ai-chat?taskId=${context.task.task_id}${conversationId ? `&conversationId=${encodeURIComponent(conversationId)}` : ""}`
      : conversationId
        ? `/ai-chat?conversationId=${encodeURIComponent(conversationId)}`
        : "/ai-chat";
  const welcome = context.task
    ? `你现在正在学习「${context.task.knowledge_point_title}」，可以直接问我概念、代码或易错点。`
    : context.profile.active_subject
      ? `我会结合「${context.profile.active_subject.subject}」的学习目标和你的薄弱点来陪你学习。`
      : "先创建一个计算机学习主题，我就能为你提供更精准的伴学建议。";

  return (
    <section
      aria-label="AI 伴学"
      className={`flex min-h-0 flex-col overflow-hidden ${
        compact
          ? "h-[min(480px,65dvh)] rounded-[24px] border border-palette-orange-light/50 bg-white/75 shadow-[var(--shadow-soft)]"
          : "h-full bg-canvas"
      } ${className}`}
    >
      <header className={`flex shrink-0 items-center justify-between gap-3 border-b border-border/25 ${compact ? "px-4 py-3" : "px-5 py-4 md:px-8"}`}>
        <div className="flex min-w-0 items-center gap-3">
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭 AI 伴学"
              className="flex size-11 shrink-0 items-center justify-center rounded-xl text-brand-medium transition-colors hover:bg-palette-orange-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-palette-orange"
            >
              <ArrowLeft className="size-5" />
            </button>
          ) : null}
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-palette-orange-mist text-palette-orange shadow-[0_4px_8px_color-mix(in_oklch,var(--palette-orange)_30%,transparent)]">
            <Bot className="size-5" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <h2 className={`${compact ? "text-base" : "text-xl"} truncate font-extrabold text-brand-dark`}>AI 伴学</h2>
            <p className="truncate text-xs font-semibold text-brand-medium">
              {taskTitle ? `正在陪你学习：${taskTitle}` : "只回答计算机学习相关问题"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {messages.length ? (
            <button
              type="button"
              onClick={deleteConversation}
              disabled={isStreaming || isDeletingConversation}
              aria-label="删除当前对话"
              title="删除当前对话"
              className="flex size-11 items-center justify-center rounded-xl text-brand-medium transition-colors hover:bg-danger-soft hover:text-danger disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-palette-orange"
            >
              <Trash2 className="size-4" />
            </button>
          ) : null}
          {compact ? (
            <Link
              href={fullscreenHref}
              aria-label="打开全屏 AI 伴学"
              title="打开全屏 AI 伴学"
              className="flex size-11 items-center justify-center rounded-xl text-brand-medium transition-colors hover:bg-palette-orange-mist hover:text-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-palette-orange"
            >
              <Maximize2 className="size-4" />
            </Link>
          ) : null}
        </div>
      </header>

      <div className={`flex min-h-0 flex-1 ${compact ? "flex-col" : "flex-col xl:flex-row"}`}>
        {!compact ? (
          <ConversationHistoryPanel
            conversations={conversations}
            currentConversationId={conversationId}
            isLoading={isHistoryLoading}
            error={historyListError}
            disabled={isStreaming || isDeletingConversation}
            onNew={startNewConversation}
            onRetry={() => void refreshConversations()}
            onSelect={(id) => void openConversation(id)}
          />
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!compact ? (
            <MobileConversationSelector
              conversations={conversations}
              currentConversationId={conversationId}
              disabled={isStreaming || isDeletingConversation}
              error={historyListError}
              onNew={startNewConversation}
              onSelect={(id) => void openConversation(id)}
            />
          ) : null}
          <div
            ref={scrollRef}
            aria-live="polite"
            className={`min-h-0 flex-1 overflow-y-auto ${compact ? "px-4 py-4" : "px-4 py-6 md:px-8"}`}
          >
            {!messages.length ? (
              <div className="mb-4 flex items-start gap-3">
                <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-xl bg-palette-orange-lighter text-palette-orange">
                  <Sparkles className="size-4" />
                </div>
                <div className="max-w-[min(680px,90%)] rounded-2xl rounded-bl-sm bg-palette-orange-lighter/75 px-4 py-3 text-sm font-medium leading-7 text-brand-deep">
                  {!isHydrated ? (
                    <span className="inline-flex items-center gap-2" role="status">
                      <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />正在读取对话…
                    </span>
                  ) : welcome}
                </div>
              </div>
            ) : null}

            {!messages.some((message) => message.role === "user") ? (
              <SuggestionList
                questions={context.task
                  ? [
                      ...context.task.suggested_questions.map((item) => item.question),
                      ...context.task.popular_questions.map((item) => item.question),
                    ]
                  : [
                      "如何制定今天的计算机学习计划？",
                      "请用一个例子帮我理解当前知识点。",
                      "学习编程时如何定位错误？",
                    ]}
                onPick={(question) => {
                  setDraft(question);
                  textAreaRef.current?.focus();
                }}
              />
            ) : null}

            <div className="flex flex-col gap-4">
              {messages.map((message, index) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  onRegenerate={
                    !isStreaming && message.role === "assistant" && index === messages.length - 1
                      ? regenerateLastAnswer
                      : undefined
                  }
                />
              ))}
            </div>
            {streamError && !isStreaming ? (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-danger/20 bg-danger-soft px-3 py-2 text-xs font-semibold text-danger">
                <AlertTriangle className="size-4 shrink-0" />
                <span className="min-w-0 flex-1">{streamError}</span>
                {lastQuestionRef.current ? (
                  <button
                    type="button"
                    onClick={() => void sendMessage(lastQuestionRef.current ?? "")}
                    className="flex min-h-9 items-center gap-1 rounded-lg bg-white/70 px-2.5 text-danger transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
                  >
                    <RotateCcw className="size-3.5" />重试
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <form onSubmit={handleSubmit} className={`shrink-0 border-t border-border/25 bg-white/60 ${compact ? "p-3" : "p-4 md:px-8 md:py-5"}`}>
            <label htmlFor={`ai-chat-input-${context.profile.user_id}-${context.scope.type}`} className="sr-only">输入计算机学习问题</label>
            <div className="flex items-end gap-2 rounded-2xl border-2 border-palette-orange-light/60 bg-white/80 p-2 shadow-[0_4px_12px_color-mix(in_oklch,var(--border-strong)_15%,transparent)] focus-within:border-palette-orange focus-within:ring-2 focus-within:ring-palette-orange/20">
              <textarea
                ref={textAreaRef}
                id={`ai-chat-input-${context.profile.user_id}-${context.scope.type}`}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage(draft);
                  }
                }}
                disabled={isStreaming || previewOnly || !isHydrated}
                rows={compact ? 1 : 2}
                maxLength={4000}
                placeholder={previewOnly ? "本地预览模式，连接真实课程后可提问…" : "输入计算机学习问题，Enter 发送…"}
                className="max-h-32 min-h-11 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm font-medium leading-6 text-brand-dark outline-none placeholder:text-brand-light disabled:cursor-not-allowed disabled:opacity-60"
              />
              {isStreaming ? (
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  aria-label="停止生成"
                  title="停止生成"
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-dark text-white transition hover:bg-brand-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-palette-orange"
                >
                  <Square className="size-4" fill="currentColor" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!draft.trim() || previewOnly}
                  aria-label="发送问题"
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--chat-orange-accent)] text-brand-dark shadow-[0_2px_8px_color-mix(in_oklch,var(--palette-orange)_40%,transparent)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-palette-orange"
                >
                  <Send className="size-4" strokeWidth={2.5} />
                </button>
              )}
            </div>
            {historyNotice ? (
              <p className="mt-2 text-center text-[11px] font-medium text-danger/80">{historyNotice}</p>
            ) : null}
            <p className="mt-2 text-center text-[11px] font-medium text-brand-medium/75">
              {previewOnly ? "这是本地界面预览，真实课程中会结合你的学习画像回答问题。" : "AI 只回答计算机与当前课程学习问题；重要命令请先在测试环境验证。"}
            </p>
          </form>
        </div>

        {!compact ? <LearningProfileCard context={context} /> : null}
      </div>
    </section>
  );
}

function ConversationHistoryPanel({
  conversations,
  currentConversationId,
  isLoading,
  error,
  disabled,
  onNew,
  onRetry,
  onSelect,
}: {
  conversations: AiChatConversation[];
  currentConversationId: string;
  isLoading: boolean;
  error: string | null;
  disabled: boolean;
  onNew: () => void;
  onRetry: () => void;
  onSelect: (conversationId: string) => void;
}) {
  return (
    <aside
      aria-label="历史对话"
      className="hidden w-[280px] shrink-0 flex-col border-r border-border/25 bg-white/45 xl:flex"
    >
      <div className="border-b border-border/20 p-4">
        <button
          type="button"
          onClick={onNew}
          disabled={disabled}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-dark px-4 text-sm font-extrabold text-white transition hover:bg-brand-deep disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-palette-orange focus-visible:ring-offset-2"
        >
          <Plus className="size-4" />新对话
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mb-2 flex items-center gap-2 px-2 text-xs font-extrabold tracking-wide text-brand-medium">
          <MessageSquareText className="size-4 text-palette-orange" />历史对话
        </div>
        {error ? (
          <div role="alert" className="m-2 rounded-xl bg-danger-soft p-3 text-xs font-semibold leading-5 text-danger">
            <p>{error}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-white/80 px-3 text-danger transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
            >
              <RotateCcw className="size-3.5" />重新加载
            </button>
          </div>
        ) : null}
        {isLoading ? (
          <p className="px-2 py-4 text-xs font-semibold text-brand-medium">正在读取 PostgreSQL 历史…</p>
        ) : conversations.length ? (
          <div className="space-y-1.5">
            {conversations.map((conversation) => {
              const active = conversation.id === currentConversationId;
              return (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  disabled={disabled}
                  aria-current={active ? "true" : undefined}
                  title={conversation.title}
                  className={`min-h-11 w-full rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-palette-orange ${
                    active
                      ? "border-palette-orange-light bg-palette-orange-mist text-brand-dark"
                      : "border-transparent text-brand-medium hover:border-palette-orange-light/60 hover:bg-white/80 hover:text-brand-dark"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <span className="block truncate text-sm font-extrabold">{conversation.title}</span>
                  <span className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold opacity-75">
                    <Clock3 className="size-3" />
                    {formatConversationTime(conversation.updated_at)} · {conversation.message_count} 条
                    {active ? " · 当前" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="px-2 py-4 text-xs font-semibold leading-5 text-brand-medium">
            还没有历史对话。发送第一条消息后，会话会保存到 PostgreSQL。
          </p>
        )}
      </div>
    </aside>
  );
}

function MobileConversationSelector({
  conversations,
  currentConversationId,
  disabled,
  error,
  onNew,
  onSelect,
}: {
  conversations: AiChatConversation[];
  currentConversationId: string;
  disabled: boolean;
  error: string | null;
  onNew: () => void;
  onSelect: (conversationId: string) => void;
}) {
  const hasCurrent = conversations.some((item) => item.id === currentConversationId);
  return (
    <div className="shrink-0 border-b border-border/20 bg-white/45 px-4 py-2.5 xl:hidden">
      <div className="flex items-center gap-2">
        <label htmlFor="ai-chat-conversation" className="sr-only">选择历史对话</label>
        <select
          id="ai-chat-conversation"
          value={hasCurrent ? currentConversationId : ""}
          onChange={(event) => {
            if (event.target.value) onSelect(event.target.value);
          }}
          disabled={disabled || conversations.length === 0}
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-palette-orange-light/60 bg-white px-3 text-sm font-bold text-brand-dark outline-none focus-visible:ring-2 focus-visible:ring-palette-orange disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="">{conversations.length ? "选择历史对话" : "暂无历史对话"}</option>
          {conversations.map((conversation) => (
            <option key={conversation.id} value={conversation.id}>
              {conversation.title}（{conversation.message_count} 条）
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onNew}
          disabled={disabled}
          aria-label="开始新对话"
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-dark text-white transition hover:bg-brand-deep disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-palette-orange"
        >
          <Plus className="size-4" />
        </button>
      </div>
      {error ? <p role="alert" className="mt-2 text-xs font-semibold text-danger">{error}</p> : null}
    </div>
  );
}

function MessageBubble({ message, onRegenerate }: { message: AiChatMessage; onRegenerate?: () => void }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex items-start gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser ? (
        <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-xl bg-palette-orange-mist text-palette-orange">
          <Bot className="size-4" />
        </div>
      ) : null}
      <div className={`max-w-[min(760px,88%)] rounded-2xl px-4 py-3 text-sm leading-7 ${isUser ? "rounded-br-sm bg-brand-dark text-white" : "rounded-bl-sm bg-white/85 text-brand-deep shadow-[0_3px_12px_color-mix(in_oklch,var(--border-strong)_12%,transparent)]"}`}>
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : message.content ? (
          <div className="prose prose-sm max-w-none text-brand-deep [&_a]:font-semibold [&_a]:text-palette-blue [&_code]:rounded [&_code]:bg-palette-orange-mist [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.9em] [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-brand-deep [&_pre]:p-3 [&_pre]:text-xs [&_pre]:leading-5 [&_table]:block [&_table]:overflow-x-auto [&_td]:border [&_td]:border-border/40 [&_td]:px-2 [&_th]:border [&_th]:border-border/40 [&_th]:bg-palette-orange-mist [&_th]:px-2">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        ) : (
          <span className="inline-flex gap-1 py-1" aria-label="AI 正在生成">
            <span className="size-1.5 animate-pulse motion-reduce:animate-none rounded-full bg-palette-orange" />
            <span className="size-1.5 animate-pulse motion-reduce:animate-none rounded-full bg-palette-orange [animation-delay:120ms]" />
            <span className="size-1.5 animate-pulse motion-reduce:animate-none rounded-full bg-palette-orange [animation-delay:240ms]" />
          </span>
        )}
        {onRegenerate ? (
          <button
            type="button"
            onClick={onRegenerate}
            className="mt-2 inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-bold text-brand-medium transition hover:bg-palette-orange-mist hover:text-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-palette-orange"
          >
            <RotateCcw className="size-3.5" />重新生成
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SuggestionList({ questions, onPick }: { questions: string[]; onPick: (question: string) => void }) {
  return (
    <div className="mb-5 flex flex-wrap gap-2" aria-label="推荐问题">
      {questions.slice(0, 4).map((question) => (
        <button
          key={question}
          type="button"
          onClick={() => onPick(question)}
          className="min-h-11 rounded-xl border border-palette-orange-light/60 bg-palette-yellow-mist/80 px-3 py-2 text-left text-xs font-semibold leading-5 text-brand-medium transition hover:border-palette-orange hover:bg-palette-orange-mist hover:text-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-palette-orange"
        >
          <Sparkles className="mr-1 inline size-3.5 text-palette-orange" />
          {question}
        </button>
      ))}
    </div>
  );
}

function LearningProfileCard({ context }: { context: AiContext }) {
  const subject = context.profile.active_subject;
  return (
    <aside className="w-full shrink-0 border-t border-border/25 bg-palette-yellow-mist/45 p-5 xl:w-[300px] xl:border-l xl:border-t-0 xl:p-6">
      {context.task ? (
        <div className="mb-5 rounded-2xl border border-palette-orange-light/55 bg-white/75 p-4">
          <p className="text-xs font-extrabold tracking-wide text-brand-medium">当前知识点</p>
          <p className="mt-2 text-sm font-black text-brand-dark">{context.task.course_title}</p>
          <p className="mt-1 text-xs font-semibold text-brand-medium">{context.task.stage_title} · {context.task.knowledge_point_title}</p>
          <p className="mt-3 text-xs leading-5 text-brand-medium">{context.task.knowledge_point_prompt}</p>
        </div>
      ) : null}
      <div className="mb-5 flex items-center gap-2 text-brand-dark">
        <Target className="size-5 text-palette-orange" />
        <h3 className="font-extrabold">我会参考这些信息</h3>
      </div>
      <div className="space-y-3 text-sm text-brand-medium">
        <ProfileRow icon={<BookOpen className="size-4" />} label="当前课程" value={subject?.subject ?? "尚未创建"} />
        {subject ? <ProfileRow icon={<Target className="size-4" />} label="学习进度" value={`${subject.progress_percent}% · ${subject.language}`} /> : null}
        {subject?.quiz_accuracy_percent != null ? <ProfileRow icon={<Sparkles className="size-4" />} label="测验正确率" value={`${subject.quiz_accuracy_percent}%`} /> : null}
      </div>
      <div className="mt-6 rounded-2xl border border-palette-orange-light/50 bg-white/70 p-4">
        <p className="mb-2 text-xs font-extrabold tracking-wide text-brand-dark">当前薄弱点</p>
        {subject?.weak_points.length ? (
          <ul className="space-y-2 text-xs font-semibold leading-5">
            {subject.weak_points.map((point) => <li key={point.title} className="flex items-start justify-between gap-3"><span>{point.title}</span><span className="shrink-0 text-palette-orange">{point.mistake_count} 次</span></li>)}
          </ul>
        ) : <p className="text-xs leading-5 text-brand-medium">完成几次小测后，我会根据错题帮你调整讲解重点。</p>}
      </div>
      <p className="mt-5 text-xs leading-5 text-brand-medium/80">这些信息只用于调整解释难度和练习建议，不会显示或发送你的密码、资产等无关数据。</p>
    </aside>
  );
}

function ProfileRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="flex items-start gap-2"><span className="mt-0.5 text-palette-orange">{icon}</span><span className="shrink-0 font-semibold">{label}</span><span className="min-w-0 truncate text-right font-extrabold text-brand-dark">{value}</span></div>;
}

function createMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createConversationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `conversation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatConversationTime(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}
