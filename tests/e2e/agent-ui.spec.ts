import { expect, test, type Page, type TestInfo } from "@playwright/test";
import type { Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeToolCallingModel } from "langchain";
import { bubbleSortFixture, densePipelineFixture, graphSearchFixture, treeTraversalFixture } from "../../src/shared/fixtures.js";
import { createApp } from "../../src/server/app.js";
import { AgentService } from "../../src/server/services/agentService.js";
import { VersionStore } from "../../src/server/services/versionStore.js";

const MODELS = { baseUrl: "test", apiKey: "test", editorModel: "test", authorModel: "test", timeoutMs: 5000 };

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => errors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`));
  return errors;
}

async function expectNoCanvasCollisionOrClipping(page: Page): Promise<void> {
  const result = await page.locator(".visualization-canvas").evaluate((svg) => {
    const nodes = [...svg.querySelectorAll<SVGGElement>("[data-element-id]")].map((node) => {
      const rect = node.getBoundingClientRect();
      return { id: node.dataset.elementId ?? "", kind: node.dataset.kind ?? "", parentId: node.dataset.parentId ?? "", rect };
    });
    const overlaps: string[] = [];
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const left = nodes[leftIndex]!;
        const right = nodes[rightIndex]!;
        if (left.kind === "group" || right.kind === "group" || left.parentId === right.id || right.parentId === left.id) continue;
        const width = Math.max(0, Math.min(left.rect.right, right.rect.right) - Math.max(left.rect.left, right.rect.left));
        const height = Math.max(0, Math.min(left.rect.bottom, right.rect.bottom) - Math.max(left.rect.top, right.rect.top));
        if (width > 1 && height > 1) overlaps.push(`${left.id}<->${right.id}`);
      }
    }
    const textOutside = [...svg.querySelectorAll<SVGGElement>("[data-element-id]")].flatMap((node) => {
      const shape = node.querySelector<SVGGraphicsElement>(".element-shape");
      if (!shape) return [];
      const bounds = shape.getBoundingClientRect();
      return [...node.querySelectorAll<SVGTextElement>("text")].flatMap((text) => {
        const rect = text.getBoundingClientRect();
        return rect.width > 0 && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1)
          ? [`${node.dataset.elementId}:${text.textContent ?? ""}`]
          : [];
      });
    });
    return { overlaps, textOutside, text: svg.textContent ?? "" };
  });
  expect(result.overlaps).toEqual([]);
  expect(result.textOutside).toEqual([]);
  expect(result.text).not.toContain("…");
}

test("natural-language Agent operations stay consistent through the browser, SSE API and history", async ({ page }, testInfo: TestInfo) => {
  const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "education2d-e2e-agent-"));
  const store = new VersionStore(dataDir);
  const modelQueue: FakeToolCallingModel[] = [];
  const agents = new AgentService(store, MODELS, dataDir, () => {
    const model = modelQueue.shift();
    if (!model) throw new Error("E2E Agent model queue is empty");
    return model;
  });
  let server: Server | undefined;

  try {
    server = await new Promise<Server>((resolve) => {
      const listening = createApp({ store, agents }).listen(0, "127.0.0.1", () => resolve(listening));
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("E2E Agent server did not expose a TCP port");
    const origin = `http://127.0.0.1:${address.port}`;
    const browserErrors = collectBrowserErrors(page);

    modelQueue.push(new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_component_catalog", args: {}, id: "inspect-catalog" }],
      [{ name: "submit_visualization_spec", args: { spec: bubbleSortFixture }, id: "submit-spec" }],
      [],
    ] }));
    await page.goto(origin);
    await page.locator(".concept-form textarea").fill("冒泡排序");
    await page.getByRole("button", { name: "生成交互图" }).click();
    await expect(page).toHaveURL(/\/viewer\/[0-9a-f-]+$/i);
    await expect(page.locator(".visualization-canvas")).toBeVisible();
    const visualizationId = new URL(page.url()).pathname.split("/").at(-1)!;
    const readVersion = async () => (await store.getCurrent(visualizationId)).version.versionId;

    const themeHash = await page.locator(".canvas-shell").getAttribute("data-theme-token-hash");
    const styleHash = await page.locator(".canvas-shell").getAttribute("data-style-contract-hash");
    const initialVersion = await readVersion();
    await page.getByRole("button", { name: "下一步" }).click();
    await expect(page.locator(".playback-bar > span")).toHaveText("1/3");

    modelQueue.push(new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_visualization", args: {}, id: "inspect-title" }],
      [{ name: "edit_visualization", args: { patch: { summary: "只修改标题", operations: [{ op: "setTitle", title: "浏览器 Agent 编辑版" }] } }, id: "edit-title" }],
      [],
    ] }));
    await page.locator(".agent-input textarea").fill("只把标题改成浏览器 Agent 编辑版，其他内容保持不变");
    const agentRequestPromise = page.waitForRequest((request) => request.method() === "POST" && /\/api\/visualizations\/[0-9a-f-]+\/agent$/i.test(request.url()));
    await page.locator(".agent-input button").click();
    const agentRequest = await agentRequestPromise;
    expect(agentRequest.postDataJSON()).toMatchObject({
      runtime: { step: 1, playing: false, highlightedIds: [], focusedIds: [] },
    });
    await expect(page.locator(".viewer-header h1")).toHaveText("浏览器 Agent 编辑版");
    await expect(page.getByText("已读取当前图形")).toBeVisible();
    await expect(page.getByText("图形修改已完成")).toBeVisible();
    await expect(page.locator(".agent-status")).toHaveText("可以操作");
    await expect(page.locator(".agent-messages")).not.toContainText("inspect_visualization");
    await expect(page.locator(".agent-messages")).not.toContainText("completed");
    await expect(page.locator(".agent-messages")).not.toContainText("正在应用图形修改");
    await page.screenshot({ path: testInfo.outputPath("agent-progress-chinese.png"), fullPage: true });
    const editedVersion = await readVersion();
    expect(editedVersion).not.toBe(initialVersion);
    await expect(page.locator(".canvas-shell")).toHaveAttribute("data-theme-token-hash", themeHash ?? "");
    await expect(page.locator(".canvas-shell")).toHaveAttribute("data-style-contract-hash", styleHash ?? "");

    await page.getByRole("button", { name: "上一版" }).click();
    await expect(page.locator(".viewer-header h1")).toHaveText("冒泡排序");
    await page.getByRole("button", { name: "下一版" }).click();
    await expect(page.locator(".viewer-header h1")).toHaveText("浏览器 Agent 编辑版");
    await page.reload();
    await expect(page.locator(".viewer-header h1")).toHaveText("浏览器 Agent 编辑版");
    await expect(page.locator(".playback-bar > span")).toHaveText("0/3");

    modelQueue.push(new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_visualization", args: {}, id: "inspect-style" }],
      [{ name: "explain_visualization", args: { status: "unsupported", message: "配色、字体和阴影属于锁定样式，当前图保持不变。" }, id: "reject-style" }],
      [],
    ] }));
    await page.locator(".agent-input textarea").fill("把配色改成红色，字体改成宋体");
    await page.locator(".agent-input button").click();
    await expect(page.getByText("配色、字体和阴影属于锁定样式，当前图保持不变。")).toBeVisible();
    expect(await readVersion()).toBe(editedVersion);
    await expect(page.locator(".canvas-shell")).toHaveAttribute("data-style-contract-hash", styleHash ?? "");

    modelQueue.push(new FakeToolCallingModel({ toolCalls: [
      [{ name: "explain_visualization", args: { status: "out_of_scope", message: "这个请求与当前二维可视化无关。" }, id: "reject-scope" }],
      [],
    ] }));
    await page.locator(".agent-input textarea").fill("帮我写一封请假邮件");
    await page.locator(".agent-input button").click();
    await expect(page.getByText("这个请求与当前二维可视化无关。")).toBeVisible();
    expect(await readVersion()).toBe(editedVersion);

    modelQueue.push(new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_visualization", args: {}, id: "inspect-focus" }],
      [{ name: "control_timeline", args: { command: { type: "focus", targetIds: ["array"] }, explanation: "已临时聚焦数组。" }, id: "focus-array" }],
      [],
    ] }));
    await page.locator(".agent-input textarea").fill("临时聚焦数组");
    await page.locator(".agent-input button").click();
    await expect(page.getByText("已临时聚焦数组。")).toBeVisible();
    await expect(page.locator("[data-element-id='array']")).not.toHaveClass(/is-unfocused/);
    await expect(page.locator("[data-element-id='left']")).toHaveClass(/is-unfocused/);
    expect(await readVersion()).toBe(editedVersion);
    await page.reload();
    await expect(page.locator(".viz-element.is-unfocused")).toHaveCount(0);
    expect(await readVersion()).toBe(editedVersion);

    await page.getByRole("button", { name: "探索边界情况" }).click();
    await expect(page.locator(".agent-input textarea")).toHaveValue("探索边界情况");
    modelQueue.push(new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_visualization", args: {}, id: "inspect-boundaries" }],
      [{ name: "explain_visualization", args: { status: "related", message: "当前可以演示空数组、单元素数组、已经有序、完全逆序或包含重复值。你想先看哪一种？" }, id: "ask-boundary" }],
      [],
    ] }));
    await page.locator(".agent-input button").click();
    await expect(page.getByText(/你想先看哪一种/)).toBeVisible();
    expect(await readVersion()).toBe(editedVersion);

    modelQueue.push(new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_visualization", args: {}, id: "inspect-replace-tree" }],
      [{ name: "replace_visualization", args: { spec: treeTraversalFixture, summary: "改成二叉树遍历图" }, id: "replace-tree" }],
      [],
    ] }));
    await page.locator(".agent-input textarea").fill("把整张图重构成二叉树前序遍历，让父子关系更直观");
    await page.locator(".agent-input button").click();
    await expect(page.locator(".viewer-header h1")).toHaveText("二叉树前序遍历");
    await expect(page.locator("[data-element-id]")).toHaveCount(treeTraversalFixture.elements.length);
    await expect(page.locator("[data-relation-id]")).toHaveCount(treeTraversalFixture.relations.length);
    await expect(page.locator(".detail-panel")).toHaveClass(/without-code/);
    await expect(page.locator(".canvas-shell")).toHaveAttribute("data-style-contract-hash", styleHash ?? "");

    modelQueue.push(new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_visualization", args: {}, id: "inspect-add-child" }],
      [{ name: "edit_visualization", args: { patch: { summary: "为 C 添加右孩子 F 和演示步骤", operations: [
        { op: "addElement", element: { id: "rightChild", kind: "node", label: "新增", value: "F", state: "normal", visible: true } },
        { op: "addRelation", relation: { id: "cf", kind: "edge", from: "right", to: "rightChild", label: "右孩子", state: "normal", directed: true, visible: true } },
        { op: "addStep", step: { id: "visitF", title: "访问 F", description: "最后访问新增的右孩子 F。", operations: [{ type: "setState", targetId: "rightChild", state: "active" }] } },
      ] } }, id: "add-child" }],
      [],
    ] }));
    await page.locator(".agent-input textarea").fill("在 C 下面增加右孩子 F，连线标明右孩子，并补一个访问 F 的步骤");
    await page.locator(".agent-input button").click();
    await expect(page.locator("[data-element-id='rightChild']")).toBeVisible();
    await expect(page.locator("[data-relation-id='cf']")).toBeVisible();
    await expect(page.locator(".playback-bar > span")).toHaveText("0/3");
    const treeEditedVersion = await readVersion();

    modelQueue.push(new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_visualization", args: {}, id: "inspect-explain-tree" }],
      [{ name: "explain_visualization", args: { status: "related", message: "前序遍历会先访问根节点，再递归访问左子树，最后访问右子树；图中的箭头表示父子关系。" }, id: "explain-tree" }],
      [],
    ] }));
    await page.locator(".agent-input textarea").fill("这张图为什么先访问 A，再访问左边？");
    await page.locator(".agent-input button").click();
    await expect(page.getByText(/前序遍历会先访问根节点/)).toBeVisible();
    expect(await readVersion()).toBe(treeEditedVersion);

    modelQueue.push(new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_visualization", args: {}, id: "inspect-replace-graph" }],
      [{ name: "replace_visualization", args: { spec: graphSearchFixture, summary: "改成广度优先搜索图" }, id: "replace-graph" }],
      [],
    ] }));
    await page.locator(".agent-input textarea").fill("现在换成图的广度优先搜索，从 A 开始展示逐层访问");
    await page.locator(".agent-input button").click();
    await expect(page.locator(".viewer-header h1")).toHaveText("图的广度优先搜索");
    await expect(page.locator("[data-element-id]")).toHaveCount(graphSearchFixture.elements.length);
    await expect(page.locator("[data-relation-id]")).toHaveCount(graphSearchFixture.relations.length);

    modelQueue.push(new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_visualization", args: {}, id: "inspect-edit-graph" }],
      [{ name: "edit_visualization", args: { patch: { summary: "突出目标节点并删除 A-B 边", operations: [
        { op: "updateElement", id: "nodeE", changes: { label: "目标节点", state: "success" } },
        { op: "removeRelation", id: "edgeAB" },
      ] } }, id: "edit-graph" }],
      [],
    ] }));
    await page.locator(".agent-input textarea").fill("把 E 标成目标节点并显示成功状态，同时删除 A 到 B 的边");
    await page.locator(".agent-input button").click();
    await expect(page.locator("[data-element-id='nodeE']")).toHaveClass(/state-success/);
    await expect(page.locator("[data-element-id='nodeE']")).toContainText("目标节点");
    await expect(page.locator("[data-relation-id='edgeAB']")).toHaveCount(0);
    const graphEditedVersion = await readVersion();

    modelQueue.push(new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_visualization", args: {}, id: "inspect-natural-undo" }],
      [{ name: "navigate_history", args: { direction: "undo", explanation: "已撤销刚才对图节点和连线的修改。" }, id: "natural-undo" }],
      [],
    ] }));
    await page.locator(".agent-input textarea").fill("撤销刚才那次修改");
    await page.locator(".agent-input button").click();
    await expect(page.locator("[data-relation-id='edgeAB']")).toBeVisible();
    await expect(page.locator("[data-element-id='nodeE']")).not.toContainText("目标节点");

    modelQueue.push(new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_visualization", args: {}, id: "inspect-natural-redo" }],
      [{ name: "navigate_history", args: { direction: "redo", explanation: "已恢复刚才对图节点和连线的修改。" }, id: "natural-redo" }],
      [],
    ] }));
    await page.locator(".agent-input textarea").fill("再恢复刚才的修改");
    await page.locator(".agent-input button").click();
    await expect(page.locator("[data-relation-id='edgeAB']")).toHaveCount(0);
    expect(await readVersion()).toBe(graphEditedVersion);
    await expect(page.locator(".canvas-shell")).toHaveAttribute("data-theme-token-hash", themeHash ?? "");
    await expect(page.locator(".canvas-shell")).toHaveAttribute("data-style-contract-hash", styleHash ?? "");

    modelQueue.push(new FakeToolCallingModel({ toolCalls: [
      [{ name: "inspect_visualization", args: {}, id: "inspect-dense-pipeline" }],
      [{ name: "replace_visualization", args: { spec: densePipelineFixture, summary: "换成完整的冒泡排序流水线演示" }, id: "replace-dense-pipeline" }],
      [],
    ] }));
    await page.getByRole("button", { name: "换种演示方式" }).click();
    await page.locator(".agent-input button").click();
    await expect(page.locator(".viewer-header h1")).toHaveText("冒泡排序：比较流水线");
    await expect(page.locator("[data-element-id='invariant']")).toHaveCount(0);
    await expect(page.locator("[data-element-id='earlyStop']")).toHaveCount(0);
    await expectNoCanvasCollisionOrClipping(page);
    for (let step = 0; step < densePipelineFixture.steps.length; step += 1) {
      await page.getByRole("button", { name: "下一步" }).click();
      await expectNoCanvasCollisionOrClipping(page);
    }
    await expect(page.locator(".step-card p")).toContainText("可以直接结束排序");
    await expect(page.locator(".canvas-shell")).toHaveAttribute("data-theme-token-hash", themeHash ?? "");
    await expect(page.locator(".canvas-shell")).toHaveAttribute("data-style-contract-hash", styleHash ?? "");
    await page.screenshot({ path: testInfo.outputPath("agent-dense-pipeline-final.png"), fullPage: true });

    expect(modelQueue).toHaveLength(0);
    expect(browserErrors).toEqual([]);
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    await fs.promises.rm(dataDir, { recursive: true, force: true });
  }
});
