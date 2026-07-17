import { ChatOpenAI } from "@langchain/openai";
import { createAgent, tool } from "langchain";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { config } from "../src/server/config.js";
import { AgentService, type AgentStreamEvent } from "../src/server/services/agentService.js";
import { VersionStore } from "../src/server/services/versionStore.js";

const enabled = process.env.RUN_PROVIDER_CONTRACT === "1";

describe.skipIf(!enabled)("DMX provider tool-call contract", () => {
  it("preserves two sequential tool calls", async () => {
    const apiKey = config.dmxApiKey;
    const modelName = config.editorModel;
    if (!apiKey || !modelName) throw new Error("需要 DMX_API_KEY 和 AGENT_MODEL/LOGIC_MODEL");
    const calls: string[] = [];
    const first = tool(async () => { calls.push("first"); return "第一步完成，现在必须调用 second_probe"; }, { name: "first_probe", description: "契约测试第一步，必须先调用", schema: z.strictObject({}) });
    const second = tool(async () => { calls.push("second"); return "第二步完成"; }, { name: "second_probe", description: "收到 first_probe 结果后调用", schema: z.strictObject({}) });
    const model = new ChatOpenAI({ model: modelName, apiKey, temperature: 0, timeout: 30000, maxRetries: 0, streamUsage: false, configuration: { baseURL: config.dmxBaseUrl } });
    const agent = createAgent({ model, tools: [first, second], systemPrompt: "必须先调用 first_probe，读取结果后调用 second_probe，最后结束。" });
    await agent.invoke({ messages: [{ role: "user", content: "执行两步工具契约测试" }] });
    expect(calls).toEqual(["first", "second"]);
  }, 180000);

  it("runs the real Author and Editor Agent operation boundary end to end", async () => {
    if (!config.dmxApiKey || !config.editorModel || !config.authorModel) {
      throw new Error("需要 DMX_API_KEY、AGENT_MODEL/LOGIC_MODEL 和 AUTHOR_MODEL/CODE_MODEL");
    }
    const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "education2d-provider-"));
    const protectedFiles = ["src/client/designTokens.ts", "src/client/styles.css", "src/client/components/VisualizationCanvas.tsx"];
    const protectedHash = async () => {
      const hash = crypto.createHash("sha256");
      for (const file of protectedFiles) hash.update(await fs.promises.readFile(path.resolve(file)));
      return hash.digest("hex");
    };
    const completedTools = (events: AgentStreamEvent[]) => events
      .filter((event) => event.type === "tool" && event.status === "completed")
      .map((event) => event.type === "tool" ? event.name : "");
    const validationProgress = (events: AgentStreamEvent[]) => events
      .filter((event): event is Extract<AgentStreamEvent, { type: "progress" }> => event.type === "progress" && event.message.includes("Spec 校验未通过"))
      .map((event) => event.message);
    const allEvents: AgentStreamEvent[] = [];
    let stage = "author";

    try {
      const store = new VersionStore(dataDir);
      const service = new AgentService(store, {
        baseUrl: config.dmxBaseUrl,
        apiKey: config.dmxApiKey,
        editorModel: config.editorModel,
        authorModel: config.authorModel,
        timeoutMs: Math.max(config.agentTimeoutMs, 180000),
      }, dataDir);
      const styleHash = await protectedHash();

      const authorEvents: AgentStreamEvent[] = [];
      let current = await service.author(
        "二叉堆插入",
        { programmingLanguage: "Python", difficulty: "beginner", learningGoal: "理解最小堆插入后的上浮过程" },
        crypto.randomUUID(),
        (event) => { authorEvents.push(event); allEvents.push(event); },
      );
      expect(completedTools(authorEvents)[0]).toBe("inspect_component_catalog");
      expect(completedTools(authorEvents)).toContain("submit_visualization_spec");
      expect(current.version.spec.concept).not.toBe("");
      expect(await protectedHash()).toBe(styleHash);

      const firstVersion = current.version.versionId;
      stage = "first_edit";
      const firstEvents: AgentStreamEvent[] = [];
      current = await service.edit(
        current.index.visualizationId,
        current.version.versionId,
        crypto.randomUUID(),
        "只把当前可视化标题改为“真实契约：二叉堆插入”，不要改变样式或其他内容。",
        (event) => { firstEvents.push(event); allEvents.push(event); },
      );
      expect(completedTools(firstEvents)).toEqual(["inspect_visualization", "edit_visualization"]);
      expect(current.version.versionId).not.toBe(firstVersion);
      expect(current.version.spec.title).toBe("真实契约：二叉堆插入");
      expect(await protectedHash()).toBe(styleHash);

      const secondBase = current.version.versionId;
      stage = "second_edit";
      const secondEvents: AgentStreamEvent[] = [];
      current = await service.edit(
        current.index.visualizationId,
        current.version.versionId,
        crypto.randomUUID(),
        "只把当前可视化的 concept 改为“最小堆插入与向上调整”，不要改变标题、样式或其他内容。",
        (event) => { secondEvents.push(event); allEvents.push(event); },
      );
      expect(completedTools(secondEvents)).toEqual(["inspect_visualization", "edit_visualization"]);
      expect(current.version.versionId).not.toBe(secondBase);
      expect(current.version.spec.concept).toBe("最小堆插入与向上调整");
      expect(await store.listVersions(current.index.visualizationId)).toHaveLength(3);
      expect(await protectedHash()).toBe(styleHash);

      const explainBase = current.version.versionId;
      stage = "explain";
      const explainEvents: AgentStreamEvent[] = [];
      current = await service.edit(current.index.visualizationId, explainBase, crypto.randomUUID(), "请解释当前图展示的计算机知识。", (event) => { explainEvents.push(event); allEvents.push(event); });
      expect(completedTools(explainEvents)).toEqual(["inspect_visualization", "explain_visualization"]);
      expect(current.version.versionId).toBe(explainBase);

      const scopeEvents: AgentStreamEvent[] = [];
      stage = "out_of_scope";
      current = await service.edit(current.index.visualizationId, current.version.versionId, crypto.randomUUID(), "请帮我写一封请假邮件。", (event) => { scopeEvents.push(event); allEvents.push(event); });
      expect(completedTools(scopeEvents)).toEqual(["explain_visualization"]);
      expect(scopeEvents.some((event) => event.type === "out_of_scope")).toBe(true);
      expect(current.version.versionId).toBe(explainBase);

      const styleEvents: AgentStreamEvent[] = [];
      stage = "style_lock";
      current = await service.edit(current.index.visualizationId, current.version.versionId, crypto.randomUUID(), "把配色改成红色，字体改成宋体，并加重阴影。", (event) => { styleEvents.push(event); allEvents.push(event); });
      expect(completedTools(styleEvents).at(-1)).toBe("explain_visualization");
      expect(completedTools(styleEvents)).not.toContain("edit_visualization");
      expect(completedTools(styleEvents)).not.toContain("replace_visualization");
      expect(styleEvents.some((event) => event.type === "version")).toBe(false);
      expect(current.version.versionId).toBe(explainBase);
      expect(await protectedHash()).toBe(styleHash);
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      throw new Error(`真实 Agent 契约失败阶段=${stage}；已完成工具=${completedTools(allEvents).join(",") || "无"}；校验反馈=${validationProgress(allEvents).join(" | ") || "无"}；${message}`);
    } finally {
      await fs.promises.rm(dataDir, { recursive: true, force: true });
    }
  }, 600000);
});
