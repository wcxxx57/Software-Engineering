import { useEffect, useMemo, useRef, useState } from "react";
import { VisualizationCanvas } from "./components/VisualizationCanvas.js";
import { SelectDropdown } from "./components/SelectDropdown.js";
import {
  generateVisualization,
  getVisualization,
  navigateHistory,
  runVisualizationAgent,
  type AgentEvent,
  type StoredVisualizationResponse,
} from "./api.js";
import { applyRuntimeCommand, INITIAL_RUNTIME_STATE, type RuntimeState } from "../shared/runtime.js";
import type { RuntimeCommand } from "../shared/schema.js";
import { DESIGN_TOKEN_HASH, DESIGN_TOKENS } from "./designTokens.js";
import { agentToolProgress } from "./agentProgress.js";

const PLATFORM_HOME_URL = import.meta.env.VITE_PLATFORM_HOME_URL || "http://localhost:3000/dashboard";
const BASE_PATH = (import.meta.env.VITE_BASE_PATH || "/education2d").replace(/\/$/, "");
type AgentMessage = { role: "user" | "agent" | "status"; text: string; toolName?: string };

const QUICK_AGENT_PROMPTS = [
  "换种演示方式",
  "更换演示数据",
  "重组图形结构",
  "探索边界情况",
];

const LANGUAGE_OPTIONS = ["Python", "Java", "C++", "Go", "Rust"].map((value) => ({ value, label: value }));
const DIFFICULTY_OPTIONS = [
  { value: "beginner", label: "入门" },
  { value: "intermediate", label: "进阶" },
  { value: "advanced", label: "高级" },
];

function navigate(path: string): void {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function Home() {
  const [concept, setConcept] = useState("");
  const [language, setLanguage] = useState("Python");
  const [difficulty, setDifficulty] = useState<"beginner" | "intermediate" | "advanced">("beginner");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const finish = (stored: StoredVisualizationResponse) => navigate(`${BASE_PATH}/viewer/${stored.index.visualizationId}`);
  const create = async () => {
    if (!concept.trim() || loading) return;
    setLoading(true); setStatus("正在理解知识点并规划图形…");
    try {
      await generateVisualization(concept.trim(), { programmingLanguage: language, difficulty }, (event) => {
        if (event.type === "progress") setStatus(event.message);
        if (event.type === "tool") setStatus(agentToolProgress(event.name, event.status));
        if (event.type === "complete") finish(event);
        if (event.type === "error") throw new Error(event.message);
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "生成失败");
    } finally { setLoading(false); }
  };
  return <main className="home-page" data-theme-token-hash={DESIGN_TOKEN_HASH}>
    <div className="home-background" aria-hidden="true" />
    <header className="home-nav"><a className="back-link" href={PLATFORM_HOME_URL}>← 返回智映通学</a></header>
    <section className="hero-card">
      <div className="brand-badge">二维交互可视化 · 智能体驱动</div>
      <h1><span className="hero-title-main">把计算机知识点变成</span><br /><span className="hero-title-accent">可持续编辑的二维交互图</span></h1>
      <p>智能助手理解你的修改要求，固定的二维组件负责稳定呈现。内容可以持续调整，画面风格始终一致。</p>
      <div className="concept-form">
        <label>想可视化什么知识点？</label>
        <textarea value={concept} onChange={(event) => setConcept(event.target.value)} placeholder="例如：二叉搜索树查找、图的广度优先搜索、哈希表冲突与链地址法" rows={3} />
        <div className="form-row">
          <SelectDropdown value={language} options={LANGUAGE_OPTIONS} ariaLabel="编程语言" onChange={setLanguage} />
          <SelectDropdown value={difficulty} options={DIFFICULTY_OPTIONS} ariaLabel="难度" onChange={(value) => setDifficulty(value as typeof difficulty)} />
        </div>
        <div className="action-row"><button className="primary-button" onClick={create} disabled={loading}>生成交互图</button></div>
        {status && <div className="status-line">{loading && <span className="spinner" />}{status}</div>}
      </div>
      <div className="invariant-strip"><span>样式始终一致</span><span>自然语言修改</span><span>逐步播放</span><span>版本可回退</span></div>
    </section>
  </main>;
}

function Viewer({ visualizationId }: { visualizationId: string }) {
  const [stored, setStored] = useState<StoredVisualizationResponse | null>(null);
  const [runtime, setRuntime] = useState<RuntimeState>({ ...INITIAL_RUNTIME_STATE });
  const [agentInput, setAgentInput] = useState("");
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([{ role: "agent", text: "我可以修改当前图的内容、结构、布局、数据和步骤，也可以重构整张图。样式始终锁定。" }]);
  const [agentBusy, setAgentBusy] = useState(false);
  const [error, setError] = useState("");
  const agentMessagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => { getVisualization(visualizationId).then(setStored).catch((reason) => setError(reason instanceof Error ? reason.message : "加载失败")); }, [visualizationId]);
  const spec = stored?.version.spec;
  useEffect(() => { setRuntime({ ...INITIAL_RUNTIME_STATE }); }, [stored?.version.versionId]);
  useEffect(() => {
    const container = agentMessagesRef.current;
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [agentMessages]);
  useEffect(() => {
    if (!runtime.playing || !spec) return;
    if (runtime.step >= spec.steps.length) { setRuntime((current) => ({ ...current, playing: false })); return; }
    const timer = window.setTimeout(() => setRuntime((current) => ({ ...current, step: Math.min(spec.steps.length, current.step + 1) })), 900);
    return () => window.clearTimeout(timer);
  }, [runtime.playing, runtime.step, spec]);

  const dispatchRuntime = (command: RuntimeCommand) => { if (spec) setRuntime((current) => applyRuntimeCommand(current, command, spec.steps.length)); };
  const currentStep = useMemo(() => spec && runtime.step > 0 ? spec.steps[runtime.step - 1] : undefined, [spec, runtime.step]);
  const history = async (direction: "undo" | "redo") => {
    if (!stored) return;
    try { setStored(await navigateHistory(visualizationId, stored.index.currentVersionId, direction)); } catch (reason) { setError(reason instanceof Error ? reason.message : "历史操作失败"); }
  };
  const handleAgentEvent = (event: AgentEvent) => {
    if (event.type === "progress") setAgentMessages((messages) => [...messages, { role: "status", text: event.message }]);
    if (event.type === "tool") setAgentMessages((messages) => {
      const next: AgentMessage = { role: "status", toolName: event.name, text: agentToolProgress(event.name, event.status) };
      if (event.status !== "started") {
        let existingIndex = -1;
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          if (messages[index]?.role === "status" && messages[index]?.toolName === event.name) { existingIndex = index; break; }
        }
        if (existingIndex >= 0) return messages.map((message, index) => index === existingIndex ? next : message);
      }
      return [...messages, next];
    });
    if (event.type === "message" || event.type === "out_of_scope") setAgentMessages((messages) => [...messages, { role: "agent", text: event.message }]);
    if (event.type === "runtime") dispatchRuntime(event.command);
    if (event.type === "version" || event.type === "complete") setStored(event);
    if (event.type === "error") setAgentMessages((messages) => [...messages, { role: "agent", text: `操作失败：${event.message}` }]);
  };
  const sendAgent = async () => {
    const message = agentInput.trim(); if (!message || !stored || agentBusy) return;
    setAgentInput(""); setAgentBusy(true); setAgentMessages((messages) => [...messages, { role: "user", text: message }]);
    try { await runVisualizationAgent(visualizationId, stored.index.currentVersionId, message, runtime, handleAgentEvent); } catch (reason) { setAgentMessages((messages) => [...messages, { role: "agent", text: reason instanceof Error ? reason.message : "智能助手请求失败" }]); } finally { setAgentBusy(false); }
  };

  if (error) return <main className="error-page"><h1>无法打开可视化</h1><p>{error}</p><button onClick={() => navigate(`${BASE_PATH}/`)}>返回首页</button></main>;
  if (!stored || !spec) return <main className="loading-page"><span className="spinner" />正在载入二维可视化…</main>;

  return <main className="viewer-page" data-theme-version={DESIGN_TOKENS.version}>
      <header className="viewer-header"><div className="brand-lockup"><a className="platform-brand" href={PLATFORM_HOME_URL}>智映通学</a><button className="product-button" onClick={() => navigate(`${BASE_PATH}/`)}>图形化学习</button></div><div><h1>{spec.title}</h1><p>{spec.concept}</p></div><div className="header-actions"><button onClick={() => history("undo")} disabled={stored.index.undoStack.length === 0}>上一版</button><button onClick={() => history("redo")} disabled={stored.index.redoStack.length === 0}>下一版</button></div></header>
    <div className="viewer-grid">
      <section className="visual-panel"><VisualizationCanvas spec={spec} step={runtime.step} highlightedIds={runtime.highlightedIds} focusedIds={runtime.focusedIds} /><div className="playback-bar"><button onClick={() => dispatchRuntime({ type: "reset" })}>重置</button><button onClick={() => dispatchRuntime({ type: "previous" })}>上一步</button><button className="play-button" onClick={() => dispatchRuntime({ type: runtime.playing ? "pause" : "play" })}>{runtime.playing ? "暂停" : "播放"}</button><button onClick={() => dispatchRuntime({ type: "next" })}>下一步</button><div className="progress-track"><div className="progress-fill" style={{ width: `${spec.steps.length ? (runtime.step / spec.steps.length) * 100 : 0}%` }} /></div><span>{runtime.step}/{spec.steps.length}</span></div></section>
      <aside className={`detail-panel${spec.code ? "" : " without-code"}`}><section className="step-card"><div className="section-label">当前步骤</div><h2>{currentStep?.title ?? "准备就绪"}</h2><p>{currentStep?.description ?? spec.description ?? "使用播放控件或自然语言助手操作这张图。"}</p></section>{spec.code && <section className="code-card"><div className="section-label">{spec.code.title}</div><pre>{spec.code.lines.map((line, index) => <code key={index} className={currentStep?.codeLine === index ? "active-code-line" : ""}><span className="code-line-number">{index + 1}</span><span className="code-line-text">{line}</span></code>)}</pre></section>}</aside>
      <aside className="agent-panel" aria-busy={agentBusy}><div className="agent-heading"><div><div className="section-label">智能编辑助手</div><h2>用自然语言修改图形</h2></div><span className="agent-status">{agentBusy ? "处理中" : "可以操作"}</span></div><div className="agent-messages" ref={agentMessagesRef} aria-live="polite">{agentMessages.map((message, index) => <div key={index} className={`agent-message ${message.role}`}>{message.text}</div>)}</div><div className="agent-suggestions"><span>你可以这样说</span><div>{QUICK_AGENT_PROMPTS.map((prompt) => <button key={prompt} type="button" onClick={() => setAgentInput(prompt)} disabled={agentBusy}>{prompt}</button>)}</div></div><div className="agent-input"><textarea value={agentInput} onChange={(event) => setAgentInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendAgent(); } }} placeholder="例如：增加一个节点并连接到根节点；把整张图改成深度优先搜索演示…" rows={3} disabled={agentBusy} /><button onClick={sendAgent} disabled={agentBusy || !agentInput.trim()}>{agentBusy ? "正在处理…" : "发送修改要求"}</button></div></aside>
    </div>
  </main>;
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => { const listener = () => setPath(window.location.pathname); window.addEventListener("popstate", listener); return () => window.removeEventListener("popstate", listener); }, []);
  const relativePath = path.startsWith(BASE_PATH) ? path.slice(BASE_PATH.length) || "/" : path;
  const match = relativePath.match(/^\/viewer\/([0-9a-f-]+)$/i);
  return match?.[1] ? <Viewer visualizationId={match[1]} /> : <Home />;
}
