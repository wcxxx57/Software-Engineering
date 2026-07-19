// @vitest-environment jsdom
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import { FakeToolCallingModel } from "langchain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VisualizationCanvas } from "../src/client/components/VisualizationCanvas.js";
import { applyDesignTokens, COMPONENT_CLASS_MAP, DESIGN_TOKEN_HASH, SEMANTIC_STATE_CLASS_MAP, STYLE_CONTRACT_HASH } from "../src/client/designTokens.js";
import { bubbleSortFixture, treeTraversalFixture } from "../src/shared/fixtures.js";
import { AgentService } from "../src/server/services/agentService.js";
import { VersionStore } from "../src/server/services/versionStore.js";
import "../src/client/styles.css";

const PROTECTED_FILES = [
  "src/client/designTokens.ts",
  "src/client/styles.css",
  "src/client/components/VisualizationCanvas.tsx",
];

async function protectedHash(): Promise<string> {
  const hash = crypto.createHash("sha256");
  for (const file of PROTECTED_FILES) hash.update(file).update(await fs.promises.readFile(path.resolve(file)));
  return hash.digest("hex");
}

describe("fixed style contract", () => {
  let dataDir: string;
  let store: VersionStore;

  beforeEach(async () => {
    dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "education2d-style-"));
    store = new VersionStore(dataDir);
    applyDesignTokens();
  });
  afterEach(async () => { await fs.promises.rm(dataDir, { recursive: true, force: true }); });

  it("derives CSS colors from the single token file and exposes stable class maps", async () => {
    const css = await fs.promises.readFile(path.resolve("src/client/styles.css"), "utf8");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
    expect(css).toMatch(/\.viz-element\.is-unfocused[^}]+opacity:\s*0\.9[0-9]/);
    expect(Object.keys(COMPONENT_CLASS_MAP)).toHaveLength(14);
    expect(Object.keys(SEMANTIC_STATE_CLASS_MAP)).toEqual(["normal", "active", "visited", "success", "error", "muted"]);
    expect(DESIGN_TOKEN_HASH).toMatch(/^[a-f0-9]{8}$/);
    expect(STYLE_CONTRACT_HASH).toMatch(/^[a-f0-9]{8}$/);
    expect(document.documentElement.style.getPropertyValue("--theme-primary")).not.toBe("");
  });

  it("keeps element classes and computed token values stable when content and layout change", () => {
    const { container, rerender } = render(<VisualizationCanvas spec={bubbleSortFixture} step={0} />);
    const beforeElement = container.querySelector('[data-element-id="array"]')!;
    const beforeClass = beforeElement.getAttribute("class");
    const beforePrimary = getComputedStyle(document.documentElement).getPropertyValue("--theme-primary");
    const changed = structuredClone(bubbleSortFixture);
    changed.elements[0] = { ...changed.elements[0]!, label: "新标签", value: [9, 8, 7], layout: { x: 550, y: 280, width: 680 } };
    rerender(<VisualizationCanvas spec={changed} step={0} />);
    expect(container.querySelector('[data-element-id="array"]')?.getAttribute("class")).toBe(beforeClass);
    expect(container.querySelector(".canvas-shell")).toHaveAttribute("data-style-contract-hash", STYLE_CONTRACT_HASH);
    expect(getComputedStyle(document.documentElement).getPropertyValue("--theme-primary")).toBe(beforePrimary);
  });

  it("preserves protected style files before and after every Agent operation class", async () => {
    let current = await store.create(bubbleSortFixture, crypto.randomUUID(), "initial");
    const run = async (message: string, toolCalls: ConstructorParameters<typeof FakeToolCallingModel>[0]["toolCalls"]) => {
      const before = await protectedHash();
      const model = new FakeToolCallingModel({ toolCalls });
      const service = new AgentService(store, { baseUrl: "test", apiKey: "test", editorModel: "test", authorModel: "test", timeoutMs: 5000 }, dataDir, () => model);
      current = await service.edit(current.index.visualizationId, current.version.versionId, crypto.randomUUID(), message, () => undefined);
      expect(await protectedHash()).toBe(before);
    };

    await run("修改标签、数据、布局和步骤", [
      [{ name: "inspect_visualization", args: {}, id: "inspect-edit" }],
      [{ name: "edit_visualization", args: { patch: { summary: "受控编辑", operations: [
        { op: "updateElement", id: "left", changes: { label: "左指针", value: 2, layout: { x: 300, y: 390 } } },
        { op: "updateStep", id: "advance", step: { title: "移动指针" } },
      ] } }, id: "edit" }],
      [],
    ]);
    await run("聚焦数组", [
      [{ name: "inspect_visualization", args: {}, id: "inspect-focus" }],
      [{ name: "control_timeline", args: { command: { type: "focus", targetIds: ["array"] }, explanation: "已聚焦数组" }, id: "focus" }],
      [],
    ]);
    await run("解释当前图", [
      [{ name: "inspect_visualization", args: {}, id: "inspect-explain" }],
      [{ name: "explain_visualization", args: { status: "related", message: "这是冒泡排序。" }, id: "explain" }],
      [],
    ]);
    await run("整图改成树", [
      [{ name: "inspect_visualization", args: {}, id: "inspect-replace" }],
      [{ name: "replace_visualization", args: { spec: treeTraversalFixture, summary: "改成树" }, id: "replace" }],
      [],
    ]);
    await run("改成红色宋体", [
      [{ name: "explain_visualization", args: { status: "unsupported", message: "样式已锁定。" }, id: "style" }],
      [],
    ]);
    await run("查询天气", [
      [{ name: "explain_visualization", args: { status: "out_of_scope", message: "与当前图无关。" }, id: "scope" }],
      [],
    ]);
  });

  it("contains no model-controlled HTML or code execution sinks", async () => {
    const sources = await Promise.all([
      fs.promises.readFile(path.resolve("src/client/App.tsx"), "utf8"),
      fs.promises.readFile(path.resolve("src/client/components/VisualizationCanvas.tsx"), "utf8"),
      fs.promises.readFile(path.resolve("src/server/services/agentService.ts"), "utf8"),
    ]);
    expect(sources.join("\n")).not.toMatch(/dangerouslySetInnerHTML|\.innerHTML\s*=|\beval\s*\(|new\s+Function|document\.write/);
  });
});
