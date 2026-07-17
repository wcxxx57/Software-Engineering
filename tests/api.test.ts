import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { FakeToolCallingModel } from "langchain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";
import { AgentService } from "../src/server/services/agentService.js";
import { VersionStore } from "../src/server/services/versionStore.js";
import { bubbleSortFixture, FIXTURES } from "../src/shared/fixtures.js";

function sseEvents(body: string): Array<Record<string, unknown>> {
  return body
    .split("\n\n")
    .flatMap((block) => block.split("\n").filter((line) => line.startsWith("data:")))
    .map((line) => JSON.parse(line.slice(5).trim()) as Record<string, unknown>);
}

describe("visualization API", () => {
  let dataDir: string;
  let store: VersionStore;

  beforeEach(async () => {
    dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "education2d-api-"));
    store = new VersionStore(dataDir);
  });
  afterEach(async () => { await fs.promises.rm(dataDir, { recursive: true, force: true }); });

  it("creates and reads the built-in demo without an AI key", async () => {
    const agents = new AgentService(store, { baseUrl: "http://invalid", apiKey: "", editorModel: "", authorModel: "", timeoutMs: 100 }, dataDir);
    const app = createApp({ store, agents });
    const created = await request(app).post("/api/visualizations/demo").expect(201);
    const id = created.body.index.visualizationId as string;
    const loaded = await request(app).get(`/api/visualizations/${id}`).expect(200);
    expect(loaded.body.version.spec.title).toBe("冒泡排序");
    expect(loaded.body.version.spec.elements[0]).not.toHaveProperty("style");
  });

  it("returns a validation error for malformed IDs", async () => {
    const agents = new AgentService(store, { baseUrl: "http://invalid", apiKey: "", editorModel: "", authorModel: "", timeoutMs: 100 }, dataDir);
    await request(createApp({ store, agents })).get("/api/visualizations/not-an-id").expect(400);
  });

  it("returns HTTP 409 before opening SSE for a stale Agent base version", async () => {
    const agents = new AgentService(store, { baseUrl: "http://invalid", apiKey: "", editorModel: "", authorModel: "", timeoutMs: 100 }, dataDir);
    const created = await store.create(bubbleSortFixture, crypto.randomUUID(), "initial");
    const committed = await store.commit({
      visualizationId: created.index.visualizationId,
      baseVersionId: created.version.versionId,
      sourceRequestId: crypto.randomUUID(),
      summary: "rename",
      spec: { ...created.version.spec, title: "new title" },
    });
    const response = await request(createApp({ store, agents }))
      .post(`/api/visualizations/${created.index.visualizationId}/agent`)
      .send({ message: "继续修改", baseVersionId: created.version.versionId, requestId: crypto.randomUUID() })
      .expect(409);
    expect(response.body.currentVersionId).toBe(committed.version.versionId);
    expect(response.headers["content-type"]).toContain("application/json");
  });

  it("validates Agent generation input before opening an event stream", async () => {
    const agents = new AgentService(store, { baseUrl: "http://invalid", apiKey: "", editorModel: "", authorModel: "", timeoutMs: 100 }, dataDir);
    const response = await request(createApp({ store, agents }))
      .post("/api/visualizations/generate")
      .send({ concept: "", profile: {}, requestId: crypto.randomUUID() })
      .expect(400);
    expect(response.headers["content-type"]).toContain("application/json");
  });

  it("streams Author Agent tools and a persisted visualization through the HTTP API", async () => {
    const model = new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_component_catalog", args: {}, id: "catalog" }],
      [{ name: "submit_visualization_spec", args: { spec: bubbleSortFixture }, id: "submit" }],
      [],
    ] });
    const agents = new AgentService(store, { baseUrl: "test", apiKey: "test", editorModel: "test", authorModel: "test", timeoutMs: 5000 }, dataDir, () => model);
    const response = await request(createApp({ store, agents }))
      .post("/api/visualizations/generate")
      .send({ concept: "冒泡排序", profile: { difficulty: "beginner" }, requestId: crypto.randomUUID() })
      .expect(200)
      .expect("Content-Type", /text\/event-stream/);
    const events = sseEvents(response.text);
    expect(events.filter((event) => event.type === "tool" && event.status === "completed").map((event) => event.name)).toEqual([
      "inspect_component_catalog",
      "submit_visualization_spec",
    ]);
    const complete = events.find((event) => event.type === "complete");
    expect(complete?.version).toMatchObject({ spec: { title: "冒泡排序" } });
    const visualizationId = (complete?.index as { visualizationId: string }).visualizationId;
    await request(createApp({ store, agents })).get(`/api/visualizations/${visualizationId}`).expect(200);
  });

  it("streams an Editor Agent Patch and exposes immutable version history", async () => {
    const created = await store.create(bubbleSortFixture, crypto.randomUUID(), "initial");
    const model = new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_visualization", args: {}, id: "inspect" }],
      [{ name: "edit_visualization", args: { patch: { summary: "修改标题", operations: [{ op: "setTitle", title: "API 编辑版" }] } }, id: "edit" }],
      [],
    ] });
    const agents = new AgentService(store, { baseUrl: "test", apiKey: "test", editorModel: "test", authorModel: "test", timeoutMs: 5000 }, dataDir, () => model);
    const response = await request(createApp({ store, agents }))
      .post(`/api/visualizations/${created.index.visualizationId}/agent`)
      .send({ message: "修改标题", baseVersionId: created.version.versionId, requestId: crypto.randomUUID() })
      .expect(200)
      .expect("Content-Type", /text\/event-stream/);
    const events = sseEvents(response.text);
    const versionEvent = events.find((event) => event.type === "version");
    expect(versionEvent?.version).toMatchObject({ spec: { title: "API 编辑版" } });
    const versions = await request(createApp({ store, agents })).get(`/api/visualizations/${created.index.visualizationId}/versions`).expect(200);
    expect(versions.body).toHaveLength(2);
  });

  it("performs deterministic undo/redo through the HTTP history endpoint", async () => {
    const agents = new AgentService(store, { baseUrl: "test", apiKey: "", editorModel: "", authorModel: "", timeoutMs: 100 }, dataDir);
    const app = createApp({ store, agents });
    const created = await store.create(bubbleSortFixture, crypto.randomUUID(), "initial");
    const committed = await store.commit({ visualizationId: created.index.visualizationId, baseVersionId: created.version.versionId, sourceRequestId: crypto.randomUUID(), summary: "rename", spec: { ...created.version.spec, title: "changed" } });
    const undone = await request(app)
      .post(`/api/visualizations/${created.index.visualizationId}/history`)
      .send({ direction: "undo", baseVersionId: committed.version.versionId })
      .expect(200);
    expect(undone.body.version.spec.title).toBe("冒泡排序");
    const redone = await request(app)
      .post(`/api/visualizations/${created.index.visualizationId}/history`)
      .send({ direction: "redo", baseVersionId: undone.body.version.versionId })
      .expect(200);
    expect(redone.body.version.spec.title).toBe("changed");
  });

  it("serves every fixed fixture through the demo API", async () => {
    const agents = new AgentService(store, { baseUrl: "test", apiKey: "", editorModel: "", authorModel: "", timeoutMs: 100 }, dataDir);
    const app = createApp({ store, agents });
    for (const [fixtureName, fixture] of Object.entries(FIXTURES)) {
      const response = await request(app).post(`/api/visualizations/demo?fixture=${fixtureName}`).expect(201);
      expect(response.body.version.spec.title).toBe(fixture.title);
    }
  });
});
