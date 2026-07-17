import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { FIXTURES } from "../shared/fixtures.js";
import { runtimeStateSchema, userProfileSchema } from "../shared/schema.js";
import { AgentConfigurationError, NotFoundError, VersionConflictError } from "./errors.js";
import { SseWriter } from "./sse.js";
import type { AgentService } from "./services/agentService.js";
import type { VersionStore } from "./services/versionStore.js";

export interface AppDependencies {
  store: VersionStore;
  agents: AgentService;
}

const idSchema = z.string().uuid();
const generateRequestSchema = z.strictObject({
  concept: z.string().trim().min(1).max(240),
  profile: userProfileSchema.default({}),
  requestId: z.string().uuid(),
});
const agentRequestSchema = z.strictObject({
  message: z.string().trim().min(1).max(4000),
  baseVersionId: z.string().regex(/^[a-f0-9]{64}$/),
  requestId: z.string().uuid(),
  runtime: runtimeStateSchema.optional(),
});
const historyRequestSchema = z.strictObject({
  direction: z.enum(["undo", "redo"]),
  baseVersionId: z.string().regex(/^[a-f0-9]{64}$/),
});

function asyncRoute(handler: (request: Request, response: Response, next: NextFunction) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => { void handler(request, response, next).catch(next); };
}

function sseError(writer: SseWriter, error: unknown): void {
  if (error instanceof VersionConflictError) {
    writer.send({ type: "error", code: "VERSION_CONFLICT", message: error.message, currentVersionId: error.currentVersionId });
  } else if (error instanceof AgentConfigurationError) {
    writer.send({ type: "error", code: "AGENT_NOT_CONFIGURED", message: error.message });
  } else if (error instanceof z.ZodError) {
    writer.send({ type: "error", code: "INVALID_REQUEST", message: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("；") });
  } else {
    writer.send({ type: "error", code: "AGENT_FAILED", message: error instanceof Error ? error.message : "智能助手执行失败" });
  }
}

export function createApp({ store, agents }: AppDependencies) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json({ limit: "3mb" }));

  app.get("/health", (_request, response) => response.json({ status: "ok", service: "education2d", timestamp: new Date().toISOString() }));

  app.post("/api/visualizations/demo", asyncRoute(async (_request, response) => {
    const fixtureName = typeof _request.query.fixture === "string" ? _request.query.fixture : "array";
    const fixture = FIXTURES[fixtureName as keyof typeof FIXTURES] ?? FIXTURES.array;
    const stored = await store.create(fixture, crypto.randomUUID(), `载入内置演示：${fixture.title}`);
    response.status(201).json(stored);
  }));

  app.post("/api/visualizations/generate", asyncRoute(async (request, response) => {
    const input = generateRequestSchema.parse(request.body);
    const writer = new SseWriter(response);
    response.on("close", () => writer.end());
    try {
      const stored = await agents.author(input.concept, input.profile, input.requestId, (event) => writer.send(event));
      writer.send({ type: "complete", ...stored });
    } catch (error) {
      sseError(writer, error);
    } finally {
      writer.end();
    }
  }));

  app.get("/api/visualizations/:id", asyncRoute(async (request, response) => {
    const visualizationId = idSchema.parse(request.params.id);
    response.json(await store.getCurrent(visualizationId));
  }));

  app.get("/api/visualizations/:id/versions", asyncRoute(async (request, response) => {
    const visualizationId = idSchema.parse(request.params.id);
    response.json(await store.listVersions(visualizationId));
  }));

  app.post("/api/visualizations/:id/history", asyncRoute(async (request, response) => {
    const visualizationId = idSchema.parse(request.params.id);
    const input = historyRequestSchema.parse(request.body);
    response.json(await store.navigate(visualizationId, input.direction, input.baseVersionId));
  }));

  app.post("/api/visualizations/:id/agent", asyncRoute(async (request, response) => {
    const visualizationId = idSchema.parse(request.params.id);
    const input = agentRequestSchema.parse(request.body);
    const current = await store.getCurrent(visualizationId);
    if (current.index.currentVersionId !== input.baseVersionId) {
      throw new VersionConflictError(current.index.currentVersionId);
    }
    const writer = new SseWriter(response);
    response.on("close", () => writer.end());
    try {
      const stored = await agents.edit(visualizationId, input.baseVersionId, input.requestId, input.message, (event) => writer.send(event), input.runtime);
      writer.send({ type: "complete", ...stored });
    } catch (error) {
      sseError(writer, error);
    } finally {
      writer.end();
    }
  }));

  const clientDir = path.resolve(process.cwd(), "dist", "client");
  if (fs.existsSync(clientDir)) {
    app.use(express.static(clientDir, { index: false }));
    app.use((request, response, next) => {
      if (request.method === "GET" && !request.path.startsWith("/api/") && request.path !== "/health") {
        response.sendFile(path.join(clientDir, "index.html"));
      } else next();
    });
  }

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof NotFoundError) return response.status(404).json({ error: error.message });
    if (error instanceof VersionConflictError) return response.status(409).json({ error: error.message, currentVersionId: error.currentVersionId });
    if (error instanceof z.ZodError) return response.status(400).json({ error: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("；") });
    console.error(error);
    return response.status(500).json({ error: error instanceof Error ? error.message : "服务器错误" });
  });

  return app;
}
