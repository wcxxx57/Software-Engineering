import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeToolCallingModel } from "langchain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bubbleSortFixture } from "../src/shared/fixtures.js";
import { AgentService, type AgentStreamEvent } from "../src/server/services/agentService.js";
import { VersionStore } from "../src/server/services/versionStore.js";

describe("LangChain tool-calling agents", () => {
  let dataDir: string;
  let store: VersionStore;

  beforeEach(async () => {
    dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "education2d-agent-"));
    store = new VersionStore(dataDir);
  });
  afterEach(async () => { await fs.promises.rm(dataDir, { recursive: true, force: true }); });

  it("author Agent observes the catalog and submits a validated spec", async () => {
    const model = new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_component_catalog", args: {}, id: "catalog" }],
      [{ name: "submit_visualization_spec", args: { spec: bubbleSortFixture }, id: "submit" }],
      [],
    ] });
    const events: AgentStreamEvent[] = [];
    const service = new AgentService(store, { baseUrl: "test", apiKey: "test", editorModel: "test", authorModel: "test", timeoutMs: 5000 }, dataDir, () => model);
    const result = await service.author("冒泡排序", { difficulty: "beginner" }, crypto.randomUUID(), (event) => events.push(event));
    expect(result.version.spec.title).toBe("冒泡排序");
    expect(events.filter((event) => event.type === "tool").map((event) => event.type === "tool" ? event.name : "")).toContain("inspect_component_catalog");
    expect(model.index).toBe(0);
  });

  it("editor Agent inspects then commits one validated PatchSet", async () => {
    const created = await store.create(bubbleSortFixture, crypto.randomUUID(), "initial");
    const model = new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_visualization", args: {}, id: "inspect" }],
      [{ name: "edit_visualization", args: { patch: { summary: "修改标题", operations: [{ op: "setTitle", title: "冒泡排序 Agent 编辑版" }] } }, id: "edit" }],
      [],
    ] });
    const events: AgentStreamEvent[] = [];
    const service = new AgentService(store, { baseUrl: "test", apiKey: "test", editorModel: "test", authorModel: "test", timeoutMs: 5000 }, dataDir, () => model);
    const result = await service.edit(created.index.visualizationId, created.version.versionId, crypto.randomUUID(), "修改标题", (event) => events.push(event));
    expect(result.version.spec.title).toContain("Agent 编辑版");
    expect(result.index.undoStack).toEqual([created.version.versionId]);
    expect(events.some((event) => event.type === "version")).toBe(true);
  });

  it("out-of-scope requests emit a boundary message and create no version", async () => {
    const created = await store.create(bubbleSortFixture, crypto.randomUUID(), "initial");
    const model = new FakeToolCallingModel({ toolCalls: [
      [{ name: "explain_visualization", args: { status: "out_of_scope", message: "这个请求与当前二维可视化无关。" }, id: "scope" }],
      [],
    ] });
    const events: AgentStreamEvent[] = [];
    const service = new AgentService(store, { baseUrl: "test", apiKey: "test", editorModel: "test", authorModel: "test", timeoutMs: 5000 }, dataDir, () => model);
    const result = await service.edit(created.index.visualizationId, created.version.versionId, crypto.randomUUID(), "今天天气如何", (event) => events.push(event));
    expect(result.version.versionId).toBe(created.version.versionId);
    expect(await store.listVersions(created.index.visualizationId)).toHaveLength(1);
    expect(events.some((event) => event.type === "out_of_scope")).toBe(true);
  });
});
