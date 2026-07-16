import { useEffect, useMemo, useState } from "react";
import { VisualizationCanvas } from "./components/VisualizationCanvas.js";
import {
  createDemo,
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

function navigate(path: string): void {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function Home() {
  const [concept, setConcept] = useState("冒泡排序");
  const [language, setLanguage] = useState("Python");
  const [difficulty, setDifficulty] = useState<"beginner" | "intermediate" | "advanced">("beginner");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const finish = (stored: StoredVisualizationResponse) => navigate(`/viewer/${stored.index.visualizationId}`);
  const create = async () => {
    if (!concept.trim() || loading) return;
    setLoading(true); setStatus("启动可视化创作 Agent…");
    try {
      await generateVisualization(concept.trim(), { programmingLanguage: language, difficulty }, (event) => {
        if (event.type === "progress") setStatus(event.message);
        if (event.type === "tool") setStatus(`Agent 工具：${event.name} · ${event.status}`);
        if (event.type === "complete") finish(event);
        if (event.type === "error") throw new Error(event.message);
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "生成失败");
    } finally { setLoading(false); }
  };
  const demo = async () => {
    setLoading(true); setStatus("载入固定样式演示…");
    try { finish(await createDemo()); } catch (error) { setStatus(error instanceof Error ? error.message : "载入失败"); } finally { setLoading(false); }
  };

  return <main className="home-page" data-theme-token-hash={DESIGN_TOKEN_HASH}>
    <section className="hero-card">
      <div className="brand-badge">Education2D · Agent Native</div>
      <h1>把计算机知识点变成<br /><span>可持续编辑的二维交互图</span></h1>
      <p>Agent 负责理解与操作，固定 SVG 组件负责渲染。无论如何修改，视觉语言始终一致。</p>
      <div className="concept-form">
        <label>想可视化什么知识点？</label>
        <textarea value={concept} onChange={(event) => setConcept(event.target.value)} placeholder="例如：红黑树插入、TCP 三次握手、CPU 流水线…" rows={3} />
        <div className="form-row">
          <select value={language} onChange={(event) => setLanguage(event.target.value)} aria-label="编程语言"><option>Python</option><option>C++</option><option>Java</option><option>Go</option><option>JavaScript</option></select>
          <select value={difficulty} onChange={(event) => setDifficulty(event.target.value as typeof difficulty)} aria-label="难度"><option value="beginner">入门</option><option value="intermediate">进阶</option><option value="advanced">高级</option></select>
        </div>
        <div className="action-row"><button className="primary-button" onClick={create} disabled={loading}>用创作 Agent 生成</button><button className="secondary-button" onClick={demo} disabled={loading}>打开内置演示</button></div>
        {status && <div className="status-line">{loading && <span className="spinner" />}{status}</div>}
      </div>
      <div className="invariant-strip"><span>固定设计令牌</span><span>严格 Spec</span><span>原子 Patch</span><span>可撤销版本</span></div>
    </section>
  </main>;
}

function Viewer({ visualizationId }: { visualizationId: string }) {
  const [stored, setStored] = useState<StoredVisualizationResponse | null>(null);
  const [runtime, setRuntime] = useState<RuntimeState>({ ...INITIAL_RUNTIME_STATE });
  const [agentInput, setAgentInput] = useState("");
  const [agentMessages, setAgentMessages] = useState<Array<{ role: "user" | "agent" | "status"; text: string }>>([{ role: "agent", text: "我可以修改当前图的内容、结构、布局、数据和步骤，也可以重构整张图。样式始终锁定。" }]);
  const [agentBusy, setAgentBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { getVisualization(visualizationId).then(setStored).catch((reason) => setError(reason instanceof Error ? reason.message : "加载失败")); }, [visualizationId]);
  const spec = stored?.version.spec;
  useEffect(() => { setRuntime({ ...INITIAL_RUNTIME_STATE }); }, [stored?.version.versionId]);
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
    if (event.type === "tool") setAgentMessages((messages) => [...messages, { role: "status", text: `${event.name} · ${event.status}` }]);
    if (event.type === "message" || event.type === "out_of_scope") setAgentMessages((messages) => [...messages, { role: "agent", text: event.message }]);
    if (event.type === "runtime") dispatchRuntime(event.command);
    if (event.type === "version" || event.type === "complete") setStored(event);
    if (event.type === "error") setAgentMessages((messages) => [...messages, { role: "agent", text: `操作失败：${event.message}` }]);
  };
  const sendAgent = async () => {
    const message = agentInput.trim(); if (!message || !stored || agentBusy) return;
    setAgentInput(""); setAgentBusy(true); setAgentMessages((messages) => [...messages, { role: "user", text: message }]);
    try { await runVisualizationAgent(visualizationId, stored.index.currentVersionId, message, handleAgentEvent); } catch (reason) { setAgentMessages((messages) => [...messages, { role: "agent", text: reason instanceof Error ? reason.message : "Agent 请求失败" }]); } finally { setAgentBusy(false); }
  };

  if (error) return <main className="error-page"><h1>无法打开可视化</h1><p>{error}</p><button onClick={() => navigate("/")}>返回首页</button></main>;
  if (!stored || !spec) return <main className="loading-page"><span className="spinner" />正在载入二维可视化…</main>;

  return <main className="viewer-page" data-theme-version={DESIGN_TOKENS.version}>
    <header className="viewer-header"><button className="brand-button" onClick={() => navigate("/")}>Education2D</button><div><h1>{spec.title}</h1><p>{spec.concept}</p></div><div className="header-actions"><button onClick={() => history("undo")} disabled={stored.index.undoStack.length === 0}>撤销</button><button onClick={() => history("redo")} disabled={stored.index.redoStack.length === 0}>重做</button><span className="version-chip">v {stored.version.versionId.slice(0, 7)}</span></div></header>
    <div className="viewer-grid">
      <section className="visual-panel"><VisualizationCanvas spec={spec} step={runtime.step} highlightedIds={runtime.highlightedIds} /><div className="playback-bar"><button onClick={() => dispatchRuntime({ type: "reset" })}>重置</button><button onClick={() => dispatchRuntime({ type: "previous" })}>上一步</button><button className="play-button" onClick={() => dispatchRuntime({ type: runtime.playing ? "pause" : "play" })}>{runtime.playing ? "暂停" : "播放"}</button><button onClick={() => dispatchRuntime({ type: "next" })}>下一步</button><div className="progress-track"><div className="progress-fill" style={{ width: `${spec.steps.length ? (runtime.step / spec.steps.length) * 100 : 0}%` }} /></div><span>{runtime.step}/{spec.steps.length}</span></div></section>
      <aside className="detail-panel"><section className="step-card"><div className="section-label">当前步骤</div><h2>{currentStep?.title ?? "准备就绪"}</h2><p>{currentStep?.description ?? spec.description ?? "使用播放控件或自然语言 Agent 操作这张图。"}</p></section>{spec.code && <section className="code-card"><div className="section-label">{spec.code.title}</div><pre>{spec.code.lines.map((line, index) => <code key={index} className={currentStep?.codeLine === index ? "active-code-line" : ""}><span>{index + 1}</span>{line}{"\n"}</code>)}</pre></section>}<section className="meta-card"><div className="section-label">图像结构</div><div className="meta-grid"><span>元素<strong>{spec.elements.length}</strong></span><span>关系<strong>{spec.relations.length}</strong></span><span>步骤<strong>{spec.steps.length}</strong></span><span>样式<strong>锁定</strong></span></div></section></aside>
      <aside className="agent-panel"><div className="agent-heading"><div><div className="section-label">编辑 Agent</div><h2>自然语言操控</h2></div><span className="agent-status">{agentBusy ? "运行中" : "就绪"}</span></div><div className="agent-messages">{agentMessages.map((message, index) => <div key={index} className={`agent-message ${message.role}`}>{message.text}</div>)}</div><div className="agent-input"><textarea value={agentInput} onChange={(event) => setAgentInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendAgent(); } }} placeholder="例如：增加一个节点并连接到根节点；把整张图改成 DFS 演示…" rows={3} /><button onClick={sendAgent} disabled={agentBusy || !agentInput.trim()}>发送</button></div></aside>
    </div>
  </main>;
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => { const listener = () => setPath(window.location.pathname); window.addEventListener("popstate", listener); return () => window.removeEventListener("popstate", listener); }, []);
  const match = path.match(/^\/viewer\/([0-9a-f-]+)$/i);
  return match?.[1] ? <Viewer visualizationId={match[1]} /> : <Home />;
}
