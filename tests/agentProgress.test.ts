import { describe, expect, it } from "vitest";
import { agentToolProgress } from "../src/client/agentProgress.js";

describe("user-facing Agent progress", () => {
  it("translates every operation and status into plain Chinese", () => {
    expect(agentToolProgress("inspect_visualization", "started")).toBe("正在读取当前图形和操作状态…");
    expect(agentToolProgress("edit_visualization", "completed")).toBe("图形修改已完成");
    expect(agentToolProgress("replace_visualization", "failed")).toBe("整图重构失败");
  });

  it("does not leak unknown internal tool names", () => {
    expect(agentToolProgress("future_internal_tool", "completed")).toBe("这一步已经完成");
  });
});
