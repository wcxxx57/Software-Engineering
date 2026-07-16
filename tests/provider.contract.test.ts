import { ChatOpenAI } from "@langchain/openai";
import { createAgent, tool } from "langchain";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { config } from "../src/server/config.js";

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
});
