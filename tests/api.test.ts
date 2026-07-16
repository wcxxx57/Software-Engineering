import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";
import { AgentService } from "../src/server/services/agentService.js";
import { VersionStore } from "../src/server/services/versionStore.js";

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
});
