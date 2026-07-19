import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeToolCallingModel } from "langchain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bubbleSortFixture, treeTraversalFixture } from "../src/shared/fixtures.js";
import type { RuntimeCommand } from "../src/shared/schema.js";
import { AgentService, type AgentStreamEvent } from "../src/server/services/agentService.js";
import { VersionStore } from "../src/server/services/versionStore.js";

const MODELS = { baseUrl: "test", apiKey: "test", editorModel: "test", authorModel: "test", timeoutMs: 5000 };

describe("LangChain tool-calling agents", () => {
  let dataDir: string;
  let store: VersionStore;

  beforeEach(async () => {
    dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "education2d-agent-"));
    store = new VersionStore(dataDir);
  });
  afterEach(async () => { await fs.promises.rm(dataDir, { recursive: true, force: true }); });

  function service(model: FakeToolCallingModel): AgentService {
    return new AgentService(store, MODELS, dataDir, () => model);
  }

  function completedTools(events: AgentStreamEvent[]): string[] {
    return events
      .filter((event) => event.type === "tool" && event.status === "completed")
      .map((event) => event.type === "tool" ? event.name : "");
  }

  it("author Agent observes the catalog and submits a validated spec", async () => {
    const model = new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_component_catalog", args: {}, id: "catalog" }],
      [{ name: "submit_visualization_spec", args: { spec: bubbleSortFixture }, id: "submit" }],
      [],
    ] });
    const events: AgentStreamEvent[] = [];
    const result = await service(model).author("冒泡排序", { difficulty: "beginner" }, crypto.randomUUID(), (event) => events.push(event));
    expect(result.version.spec.title).toBe("冒泡排序");
    expect(completedTools(events)).toEqual(["inspect_component_catalog", "submit_visualization_spec"]);
  });

  it("server-enforces catalog inspection even when the model chooses submit first", async () => {
    const model = new FakeToolCallingModel({ toolCalls: [
      [{ name: "submit_visualization_spec", args: { spec: bubbleSortFixture }, id: "early-submit" }],
      [{ name: "inspect_component_catalog", args: {}, id: "catalog" }],
      [{ name: "submit_visualization_spec", args: { spec: bubbleSortFixture }, id: "valid-submit" }],
      [],
    ] });
    const events: AgentStreamEvent[] = [];
    const result = await service(model).author("冒泡排序", {}, crypto.randomUUID(), (event) => events.push(event));
    expect(result.version.spec.title).toBe("冒泡排序");
    expect(completedTools(events)).toEqual(["submit_visualization_spec", "inspect_component_catalog", "submit_visualization_spec"]);
  });

  it("author Agent reads validation feedback and repairs an invalid cross-reference", async () => {
    const invalid = structuredClone(bubbleSortFixture);
    invalid.relations.push({ id: "badEdge", kind: "edge", from: "array", to: "missing", state: "normal", directed: true, visible: true });
    const model = new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_component_catalog", args: {}, id: "catalog" }],
      [{ name: "submit_visualization_spec", args: { spec: invalid }, id: "invalid" }],
      [{ name: "submit_visualization_spec", args: { spec: bubbleSortFixture }, id: "repaired" }],
      [],
    ] });
    const events: AgentStreamEvent[] = [];
    const result = await service(model).author("冒泡排序", {}, crypto.randomUUID(), (event) => events.push(event));
    expect(result.version.spec.relations).toHaveLength(0);
    expect(completedTools(events).filter((name) => name === "submit_visualization_spec")).toHaveLength(2);
  });

  it("author Agent stops deterministically after three rejected Spec submissions", async () => {
    const invalid = structuredClone(bubbleSortFixture);
    invalid.relations.push({ id: "badEdge", kind: "edge", from: "array", to: "missing", state: "normal", directed: true, visible: true });
    const model = new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_component_catalog", args: {}, id: "catalog" }],
      [{ name: "submit_visualization_spec", args: { spec: invalid }, id: "invalid-1" }],
      [{ name: "submit_visualization_spec", args: { spec: invalid }, id: "invalid-2" }],
      [{ name: "submit_visualization_spec", args: { spec: invalid }, id: "invalid-3" }],
      [{ name: "submit_visualization_spec", args: { spec: bubbleSortFixture }, id: "must-not-run" }],
    ] });
    const events: AgentStreamEvent[] = [];
    let thrown: unknown;
    try {
      await service(model).author("冒泡排序", {}, crypto.randomUUID(), (event) => events.push(event));
    } catch (error) {
      thrown = error;
    }
    expect(completedTools(events).filter((name) => name === "submit_visualization_spec")).toHaveLength(3);
    expect(events.filter((event) => event.type === "progress" && event.message.includes("Spec 校验未通过"))).toHaveLength(3);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/3 次尝试仍未生成有效的图形结构/);
  });

  it("editor Agent inspects then commits one validated PatchSet", async () => {
    const created = await store.create(bubbleSortFixture, crypto.randomUUID(), "initial");
    const model = new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_visualization", args: {}, id: "inspect" }],
      [{ name: "edit_visualization", args: { patch: { summary: "修改标题", operations: [{ op: "setTitle", title: "冒泡排序 Agent 编辑版" }] } }, id: "edit" }],
      [],
    ] });
    const events: AgentStreamEvent[] = [];
    const result = await service(model).edit(created.index.visualizationId, created.version.versionId, crypto.randomUUID(), "修改标题", (event) => events.push(event));
    expect(result.version.spec.title).toContain("Agent 编辑版");
    expect(result.index.undoStack).toEqual([created.version.versionId]);
    expect(events.some((event) => event.type === "version")).toBe(true);
  });

  it("server-enforces visualization inspection before mutation", async () => {
    const created = await store.create(bubbleSortFixture, crypto.randomUUID(), "initial");
    const patch = { summary: "检查后修改", operations: [{ op: "setTitle", title: "已检查" }] };
    const model = new FakeToolCallingModel({ toolCalls: [
      [{ name: "edit_visualization", args: { patch }, id: "early-edit" }],
      [{ name: "inspect_visualization", args: {}, id: "inspect" }],
      [{ name: "edit_visualization", args: { patch }, id: "valid-edit" }],
      [],
    ] });
    const result = await service(model).edit(created.index.visualizationId, created.version.versionId, crypto.randomUUID(), "修改标题", () => undefined);
    expect(result.version.spec.title).toBe("已检查");
    expect(await store.listVersions(created.index.visualizationId)).toHaveLength(2);
  });

  it("repairs a rejected PatchSet before committing atomically", async () => {
    const created = await store.create(bubbleSortFixture, crypto.randomUUID(), "initial");
    const model = new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_visualization", args: {}, id: "inspect" }],
      [{ name: "edit_visualization", args: { patch: { summary: "非法关系", operations: [{ op: "addRelation", relation: { id: "bad", kind: "edge", from: "array", to: "missing", state: "normal", directed: true, visible: true } }] } }, id: "invalid" }],
      [{ name: "edit_visualization", args: { patch: { summary: "改为合法标签", operations: [{ op: "setTitle", title: "修正完成" }] } }, id: "valid" }],
      [],
    ] });
    const result = await service(model).edit(created.index.visualizationId, created.version.versionId, crypto.randomUUID(), "修改图", () => undefined);
    expect(result.version.spec.title).toBe("修正完成");
    expect(result.version.spec.relations).toHaveLength(0);
    expect(await store.listVersions(created.index.visualizationId)).toHaveLength(2);
  });

  it("replaces the complete visualization with fixed components and creates one version", async () => {
    const created = await store.create(bubbleSortFixture, crypto.randomUUID(), "initial");
    const model = new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_visualization", args: {}, id: "inspect" }],
      [{ name: "replace_visualization", args: { spec: treeTraversalFixture, summary: "改成二叉树" }, id: "replace" }],
      [],
    ] });
    const result = await service(model).edit(created.index.visualizationId, created.version.versionId, crypto.randomUUID(), "整图改成二叉树", () => undefined);
    expect(result.version.spec.title).toBe("二叉树前序遍历");
    expect(result.index.undoStack).toEqual([created.version.versionId]);
  });

  it("allows at most one successful persistent mutation in one Agent run", async () => {
    const created = await store.create(bubbleSortFixture, crypto.randomUUID(), "initial");
    const model = new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_visualization", args: {}, id: "inspect" }],
      [{ name: "edit_visualization", args: { patch: { summary: "第一次修改", operations: [{ op: "setTitle", title: "第一次修改" }] } }, id: "edit" }],
      [{ name: "replace_visualization", args: { spec: treeTraversalFixture, summary: "不应执行" }, id: "replace" }],
      [],
    ] });
    const result = await service(model).edit(created.index.visualizationId, created.version.versionId, crypto.randomUUID(), "连续修改", () => undefined);
    expect(result.version.spec.title).toBe("第一次修改");
    expect(await store.listVersions(created.index.visualizationId)).toHaveLength(2);
  });

  it.each<RuntimeCommand>([
    { type: "play" },
    { type: "pause" },
    { type: "reset" },
    { type: "next" },
    { type: "previous" },
    { type: "seek", step: 1 },
    { type: "highlight", targetIds: ["array"] },
    { type: "clearHighlight" },
    { type: "focus", targetIds: ["array", "left"] },
  ])("emits transient runtime command $type without creating a version", async (command) => {
    const created = await store.create(bubbleSortFixture, crypto.randomUUID(), "initial");
    const model = new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_visualization", args: {}, id: "inspect" }],
      [{ name: "control_timeline", args: { command, explanation: "执行运行控制" }, id: "runtime" }],
      [],
    ] });
    const events: AgentStreamEvent[] = [];
    const result = await service(model).edit(created.index.visualizationId, created.version.versionId, crypto.randomUUID(), "控制播放", (event) => events.push(event));
    expect(result.version.versionId).toBe(created.version.versionId);
    expect(await store.listVersions(created.index.visualizationId)).toHaveLength(1);
    expect(events.find((event) => event.type === "runtime")).toMatchObject({ type: "runtime", command });
  });

  it("rejects unknown runtime targets without emitting a command", async () => {
    const created = await store.create(bubbleSortFixture, crypto.randomUUID(), "initial");
    const model = new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_visualization", args: {}, id: "inspect" }],
      [{ name: "control_timeline", args: { command: { type: "focus", targetIds: ["missing"] }, explanation: "聚焦" }, id: "runtime" }],
      [],
    ] });
    const events: AgentStreamEvent[] = [];
    await service(model).edit(created.index.visualizationId, created.version.versionId, crypto.randomUUID(), "聚焦不存在节点", (event) => events.push(event));
    expect(events.some((event) => event.type === "runtime")).toBe(false);
  });

  it("navigates undo and redo through Agent tools", async () => {
    const created = await store.create(bubbleSortFixture, crypto.randomUUID(), "initial");
    const committed = await store.commit({ visualizationId: created.index.visualizationId, baseVersionId: created.version.versionId, sourceRequestId: crypto.randomUUID(), summary: "rename", spec: { ...created.version.spec, title: "changed" } });
    const undoModel = new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_visualization", args: {}, id: "inspect-undo" }],
      [{ name: "navigate_history", args: { direction: "undo", explanation: "已撤销" }, id: "undo" }],
      [],
    ] });
    const undone = await service(undoModel).edit(created.index.visualizationId, committed.version.versionId, crypto.randomUUID(), "撤销", () => undefined);
    expect(undone.version.spec.title).toBe("冒泡排序");

    const redoModel = new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_visualization", args: {}, id: "inspect-redo" }],
      [{ name: "navigate_history", args: { direction: "redo", explanation: "已重做" }, id: "redo" }],
      [],
    ] });
    const redone = await service(redoModel).edit(created.index.visualizationId, undone.version.versionId, crypto.randomUUID(), "重做", () => undefined);
    expect(redone.version.spec.title).toBe("changed");
  });

  it("answers related explanations after inspection without mutation", async () => {
    const created = await store.create(bubbleSortFixture, crypto.randomUUID(), "initial");
    const model = new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_visualization", args: {}, id: "inspect" }],
      [{ name: "explain_visualization", args: { status: "related", message: "当前数组展示相邻比较。" }, id: "explain" }],
      [],
    ] });
    const events: AgentStreamEvent[] = [];
    const result = await service(model).edit(created.index.visualizationId, created.version.versionId, crypto.randomUUID(), "解释当前图", (event) => events.push(event));
    expect(result.version.versionId).toBe(created.version.versionId);
    expect(events).toContainEqual({ type: "message", message: "当前数组展示相邻比较。" });
    expect(await store.listVersions(created.index.visualizationId)).toHaveLength(1);
  });

  it("out-of-scope requests emit a boundary message and create no version", async () => {
    const created = await store.create(bubbleSortFixture, crypto.randomUUID(), "initial");
    const model = new FakeToolCallingModel({ toolCalls: [
      [{ name: "explain_visualization", args: { status: "out_of_scope", message: "这个请求与当前二维可视化无关。" }, id: "scope" }],
      [],
    ] });
    const events: AgentStreamEvent[] = [];
    const result = await service(model).edit(created.index.visualizationId, created.version.versionId, crypto.randomUUID(), "今天天气如何", (event) => events.push(event));
    expect(result.version.versionId).toBe(created.version.versionId);
    expect(await store.listVersions(created.index.visualizationId)).toHaveLength(1);
    expect(events.some((event) => event.type === "out_of_scope")).toBe(true);
    expect(completedTools(events)).toEqual(["explain_visualization"]);
  });

  it("style requests return unsupported and preserve spec, version and theme files", async () => {
    const created = await store.create(bubbleSortFixture, crypto.randomUUID(), "initial");
    const tokenPath = path.resolve("src/client/designTokens.ts");
    const cssPath = path.resolve("src/client/styles.css");
    const before = [await fs.promises.readFile(tokenPath, "utf8"), await fs.promises.readFile(cssPath, "utf8")];
    const model = new FakeToolCallingModel({ toolCalls: [
      [{ name: "explain_visualization", args: { status: "unsupported", message: "配色和字体属于锁定样式，当前图保持不变。" }, id: "style" }],
      [],
    ] });
    const result = await service(model).edit(created.index.visualizationId, created.version.versionId, crypto.randomUUID(), "把字体换成宋体并改成红色", () => undefined);
    const after = [await fs.promises.readFile(tokenPath, "utf8"), await fs.promises.readFile(cssPath, "utf8")];
    expect(result.version).toEqual(created.version);
    expect(after).toEqual(before);
    expect(await store.listVersions(created.index.visualizationId)).toHaveLength(1);
  });

  it("audit logs contain tool metadata but not the user request or hidden reasoning", async () => {
    const created = await store.create(bubbleSortFixture, crypto.randomUUID(), "initial");
    const requestId = crypto.randomUUID();
    const privateMessage = "请解释当前图但不要记录这句话";
    const model = new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_visualization", args: {}, id: "inspect" }],
      [{ name: "explain_visualization", args: { status: "related", message: "解释完成" }, id: "explain" }],
      [],
    ] });
    await service(model).edit(created.index.visualizationId, created.version.versionId, requestId, privateMessage, () => undefined);
    const audit = await fs.promises.readFile(path.join(dataDir, "agent-runs", `${requestId}.jsonl`), "utf8");
    expect(audit).toContain("inspect_visualization");
    expect(audit).toContain("explain_visualization");
    expect(audit).not.toContain(privateMessage);
    expect(audit).not.toMatch(/reasoning|thought|messages/i);
  });
});
