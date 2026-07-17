import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { materializeVisualization } from "../../src/shared/runtime.js";
import type { VisualizationSpec } from "../../src/shared/schema.js";

const FIXTURE_NAMES = ["array", "tree", "graph", "containers", "callStack", "timeline", "pipeline", "densePipeline", "blockedRelation", "collisionStress", "denseGroup", "gallery", "denseLabels"] as const;

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => errors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`));
  return errors;
}

async function openFixture(page: Page, fixture: string): Promise<{ visualizationId: string; spec: VisualizationSpec }> {
  const response = await page.request.post(`/api/visualizations/demo?fixture=${fixture}`);
  expect(response.ok()).toBe(true);
  const stored = await response.json() as {
    index: { visualizationId: string };
    version: { spec: VisualizationSpec };
  };
  await page.goto(`/viewer/${stored.index.visualizationId}`);
  await expect(page.locator(".visualization-canvas")).toBeVisible();
  return { visualizationId: stored.index.visualizationId, spec: stored.version.spec };
}

function expectedText(value: unknown): string {
  if (value === null) return "∅";
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

async function assertCanvasGeometry(page: Page, spec: VisualizationSpec): Promise<void> {
  await expect(page.locator("[data-element-id]")).toHaveCount(spec.elements.filter((element) => element.visible).length);
  await expect(page.locator("[data-relation-id]")).toHaveCount(spec.relations.filter((relation) => relation.visible).length);
  const geometry = await page.locator(".visualization-canvas").evaluate((svg) => {
    const canvas = svg.getBoundingClientRect();
    const nodes = [...svg.querySelectorAll<SVGGElement>("[data-element-id]")].map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        id: node.dataset.elementId ?? "",
        kind: node.dataset.kind ?? "",
        parentId: node.dataset.parentId ?? "",
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    });
    const outside = nodes.filter((node) => node.width <= 0 || node.height <= 0 || node.left < canvas.left - 2 || node.right > canvas.right + 2 || node.top < canvas.top - 2 || node.bottom > canvas.bottom + 2).map((node) => node.id);
    const textOutside = [...svg.querySelectorAll<SVGTextElement>("text")].filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && (rect.left < canvas.left - 2 || rect.right > canvas.right + 2 || rect.top < canvas.top - 2 || rect.bottom > canvas.bottom + 2);
    }).map((node) => node.textContent ?? "");
    const textOutsideElements = [...svg.querySelectorAll<SVGGElement>("[data-element-id]")].flatMap((node) => {
      const shape = node.querySelector<SVGGraphicsElement>(".element-shape");
      if (!shape) return [];
      const bounds = shape.getBoundingClientRect();
      return [...node.querySelectorAll<SVGTextElement>("text")]
        .filter((text) => {
          const rect = text.getBoundingClientRect();
          return rect.width > 0 && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1);
        })
        .map((text) => {
          const textBounds = text.getBoundingClientRect();
          return `${node.dataset.elementId}:${text.textContent ?? ""} text=${Math.round(textBounds.left)},${Math.round(textBounds.top)},${Math.round(textBounds.right)},${Math.round(textBounds.bottom)} shape=${Math.round(bounds.left)},${Math.round(bounds.top)},${Math.round(bounds.right)},${Math.round(bounds.bottom)}`;
        });
    });
    const relationLabels = [...svg.querySelectorAll<SVGTextElement>("[data-relation-id] text")].map((node) => ({ text: node.textContent ?? "", rect: node.getBoundingClientRect() }));
    const relationLabelBoxes = [...svg.querySelectorAll<SVGRectElement>("[data-relation-id] .relation-label-bg")].map((node) => ({
      relationId: node.closest<SVGGElement>("[data-relation-id]")?.dataset.relationId ?? "",
      rect: node.getBoundingClientRect(),
    }));
    const labelOverlaps: string[] = [];
    for (let leftIndex = 0; leftIndex < relationLabels.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < relationLabels.length; rightIndex += 1) {
        const left = relationLabels[leftIndex]!;
        const right = relationLabels[rightIndex]!;
        const width = Math.max(0, Math.min(left.rect.right, right.rect.right) - Math.max(left.rect.left, right.rect.left));
        const height = Math.max(0, Math.min(left.rect.bottom, right.rect.bottom) - Math.max(left.rect.top, right.rect.top));
        if (width * height > 2) labelOverlaps.push(`${left.text}<->${right.text}`);
      }
    }
    const overlaps: string[] = [];
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const left = nodes[leftIndex]!;
        const right = nodes[rightIndex]!;
        if (left.kind === "group" || right.kind === "group" || left.parentId === right.id || right.parentId === left.id) continue;
        const intersectionWidth = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
        const intersectionHeight = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
        if (intersectionWidth > 1 && intersectionHeight > 1) overlaps.push(`${left.id}<->${right.id}`);
      }
    }
    const parentContainment = nodes.flatMap((node) => {
      if (!node.parentId) return [];
      const parent = nodes.find((candidate) => candidate.id === node.parentId);
      if (!parent) return [`${node.id}->missing:${node.parentId}`];
      return node.left < parent.left - 1 || node.right > parent.right + 1 || node.top < parent.top - 1 || node.bottom > parent.bottom + 1
        ? [`${node.id}->${parent.id}`]
        : [];
    });
    const groupHeaderOverlaps = nodes.filter((node) => node.kind === "group").flatMap((group) => {
      const groupElement = svg.querySelector<SVGGElement>(`[data-element-id='${CSS.escape(group.id)}']`);
      if (!groupElement) return [];
      const ownTextBoxes = [...groupElement.querySelectorAll<SVGTextElement>(":scope > g:last-child text, :scope > text")].map((text) => ({
        text: text.textContent ?? "",
        rect: text.getBoundingClientRect(),
      }));
      const children = nodes.filter((candidate) => candidate.parentId === group.id);
      return ownTextBoxes.flatMap((text) => children.flatMap((child) => {
        const width = Math.max(0, Math.min(text.rect.right, child.right) - Math.max(text.rect.left, child.left));
        const height = Math.max(0, Math.min(text.rect.bottom, child.bottom) - Math.max(text.rect.top, child.top));
        return width > 1 && height > 1 ? [`${group.id}:${text.text}<->${child.id}`] : [];
      }));
    });
    const labelElementOverlaps = relationLabelBoxes.flatMap((label) => nodes.filter((node) => node.kind !== "group").flatMap((node) => {
      const width = Math.max(0, Math.min(label.rect.right, node.right) - Math.max(label.rect.left, node.left));
      const height = Math.max(0, Math.min(label.rect.bottom, node.bottom) - Math.max(label.rect.top, node.top));
      return width > 1 && height > 1 ? [`${label.relationId}<->${node.id}`] : [];
    }));
    const pathElementCrossings = [...svg.querySelectorAll<SVGPathElement>("[data-relation-id] .relation-path")].flatMap((path) => {
      const relation = path.closest<SVGGElement>("[data-relation-id]");
      const relationId = relation?.dataset.relationId ?? "";
      const from = relation?.dataset.from ?? "";
      const to = relation?.dataset.to ?? "";
      const length = path.getTotalLength();
      return nodes.filter((node) => node.kind !== "group" && node.id !== from && node.id !== to).flatMap((node) => {
        for (let distance = 2; distance < length - 2; distance += 3) {
          const point = svg.createSVGPoint();
          const local = path.getPointAtLength(distance);
          point.x = local.x;
          point.y = local.y;
          const screen = point.matrixTransform(path.getScreenCTM() ?? new DOMMatrix());
          if (screen.x > node.left + 1 && screen.x < node.right - 1 && screen.y > node.top + 1 && screen.y < node.bottom - 1) return [`${relationId}<->${node.id}`];
        }
        return [];
      });
    });
    return { outside, textOutside, textOutsideElements, overlaps, parentContainment, groupHeaderOverlaps, labelOverlaps, labelElementOverlaps, pathElementCrossings };
  });
  expect(geometry.outside).toEqual([]);
  expect(geometry.textOutside).toEqual([]);
  expect(geometry.textOutsideElements).toEqual([]);
  expect(geometry.overlaps).toEqual([]);
  expect(geometry.parentContainment).toEqual([]);
  expect(geometry.groupHeaderOverlaps).toEqual([]);
  expect(geometry.labelOverlaps).toEqual([]);
  expect(geometry.labelElementOverlaps).toEqual([]);
  expect(geometry.pathElementCrossings).toEqual([]);
  await expect(page.locator(".visualization-canvas")).not.toContainText("…");
  for (const element of spec.elements.filter((candidate) => candidate.visible)) {
    const rendered = page.locator(`[data-element-id='${element.id}']`);
    if (element.label) await expect(rendered).toContainText(element.label);
    if (Array.isArray(element.value)) {
      for (const item of element.value) await expect(rendered).toContainText(expectedText(item));
    } else if (element.value !== undefined) await expect(rendered).toContainText(expectedText(element.value));
  }
  for (const relation of spec.relations.filter((candidate) => candidate.visible && candidate.label)) {
    await expect(page.locator(`[data-relation-id='${relation.id}']`)).toContainText(relation.label!);
  }
}

test("home uses the unified Zhiying brand language and stays responsive", async ({ page }, testInfo: TestInfo) => {
  const browserErrors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 2048, height: 1056 });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "智映通学" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /把计算机知识点变成/ })).toBeVisible();
  await expect(page.getByText("二维交互可视化 · 智能体驱动")).toBeVisible();
  await expect(page.getByRole("button", { name: "打开内置演示" })).toHaveCount(0);
  const conceptInput = page.locator(".concept-form textarea");
  await expect(conceptInput).toHaveValue("");
  await expect(conceptInput).toHaveAttribute("placeholder", "例如：二叉搜索树查找、图的广度优先搜索、哈希表冲突与链地址法");
  const wideLayout = await page.evaluate(() => {
    const background = document.querySelector<HTMLElement>(".home-background")!.getBoundingClientRect();
    const introduction = document.querySelector<HTMLElement>(".hero-card > p")!;
    return {
      backgroundWidth: background.width,
      clientWidth: document.documentElement.clientWidth,
      introductionHeight: introduction.getBoundingClientRect().height,
      introductionLineHeight: Number.parseFloat(getComputedStyle(introduction).lineHeight),
    };
  });
  expect(Math.abs(wideLayout.backgroundWidth - wideLayout.clientWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(wideLayout.introductionHeight - wideLayout.introductionLineHeight)).toBeLessThanOrEqual(1);
  const language = page.getByRole("combobox", { name: "编程语言" });
  await language.click();
  await expect(page.getByRole("listbox", { name: "编程语言" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Python" })).toHaveAttribute("aria-selected", "true");
  for (const option of ["Python", "Java", "C++", "Go", "Rust"]) await expect(page.getByRole("option", { name: option })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(language).toContainText("Java");
  const difficulty = page.getByRole("combobox", { name: "难度" });
  await difficulty.click();
  for (const option of ["入门", "进阶", "高级"]) await expect(page.getByRole("option", { name: option })).toBeVisible();
  await page.keyboard.press("Escape");
  const palette = await page.evaluate(() => ["--theme-primary", "--theme-active", "--theme-success", "--theme-visited", "--theme-accent"].map((name) => getComputedStyle(document.documentElement).getPropertyValue(name)));
  expect(new Set(palette).size).toBe(palette.length);
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("home-mobile.png"), fullPage: true });
  expect(browserErrors).toEqual([]);
});

test("renders every fixed component fixture inside the SVG without unintended overlap", async ({ page }, testInfo: TestInfo) => {
  const browserErrors = collectBrowserErrors(page);
  let themeHash: string | null = null;
  let styleHash: string | null = null;

  for (const fixture of FIXTURE_NAMES) {
    const { spec } = await openFixture(page, fixture);
    await assertCanvasGeometry(page, spec);
    const currentThemeHash = await page.locator(".canvas-shell").getAttribute("data-theme-token-hash");
    const currentStyleHash = await page.locator(".canvas-shell").getAttribute("data-style-contract-hash");
    expect(currentThemeHash).toMatch(/^[a-f0-9]{8}$/);
    expect(currentStyleHash).toMatch(/^[a-f0-9]{8}$/);
    themeHash ??= currentThemeHash;
    styleHash ??= currentStyleHash;
    expect(currentThemeHash).toBe(themeHash);
    expect(currentStyleHash).toBe(styleHash);
    await page.screenshot({ path: testInfo.outputPath(`${fixture}.png`), fullPage: true });
  }

  expect(browserErrors).toEqual([]);
});

test("every playback step keeps complete text and collision-free geometry", async ({ page }, testInfo: TestInfo) => {
  const browserErrors = collectBrowserErrors(page);
  for (const fixture of FIXTURE_NAMES) {
    const { spec } = await openFixture(page, fixture);
    for (let step = 0; step <= spec.steps.length; step += 1) {
      const materialized = materializeVisualization(spec, step);
      await assertCanvasGeometry(page, { ...spec, elements: materialized.elements, relations: materialized.relations });
      if (step < spec.steps.length) await page.getByRole("button", { name: "下一步" }).click();
    }
    if (spec.steps.length > 0) await page.screenshot({ path: testInfo.outputPath(`${fixture}-final-step.png`), fullPage: true });
  }
  expect(browserErrors).toEqual([]);
});

test("dense content stays complete and collision-free at all supported viewer widths", async ({ page }, testInfo: TestInfo) => {
  const browserErrors = collectBrowserErrors(page);
  for (const viewport of [
    { width: 720, height: 900, name: "narrow" },
    { width: 1024, height: 900, name: "tablet" },
    { width: 1440, height: 900, name: "desktop" },
    { width: 1920, height: 1080, name: "wide" },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const { spec } = await openFixture(page, "densePipeline");
    await assertCanvasGeometry(page, spec);
    await page.screenshot({ path: testInfo.outputPath(`dense-pipeline-${viewport.name}.png`), fullPage: true });
  }
  expect(browserErrors).toEqual([]);
});

test("playback is transient, bounded and resets after refresh", async ({ page }, testInfo: TestInfo) => {
  const browserErrors = collectBrowserErrors(page);
  const { visualizationId } = await openFixture(page, "array");
  const codeOverflow = await page.locator(".code-card pre").evaluate((node) => node.scrollWidth - node.clientWidth);
  expect(codeOverflow).toBeLessThanOrEqual(1);
  const defaultVerticalOverflow = await page.locator(".code-card pre").evaluate((node) => node.scrollHeight - node.clientHeight);
  expect(defaultVerticalOverflow).toBeLessThanOrEqual(1);
  const readVersion = async () => {
    const response = await page.request.get(`/api/visualizations/${visualizationId}`);
    return (await response.json() as { version: { versionId: string } }).version.versionId;
  };
  const version = await readVersion();
  await expect(page.getByText("准备就绪")).toBeVisible();
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByText("比较 5 和 2")).toBeVisible();
  const unfocusedOpacity = await page.locator('[data-element-id="note"]').evaluate((node) => Number(getComputedStyle(node).opacity));
  expect(unfocusedOpacity).toBeGreaterThanOrEqual(0.9);
  await page.screenshot({ path: testInfo.outputPath("focus-preserves-context.png"), fullPage: true });
  await page.getByRole("button", { name: "上一步" }).click();
  await expect(page.getByText("准备就绪")).toBeVisible();
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect(page.getByRole("button", { name: "暂停" })).toBeVisible();
  await page.waitForTimeout(1050);
  await page.getByRole("button", { name: "暂停" }).click();
  expect(await readVersion()).toBe(version);
  await page.reload();
  await expect(page.getByText("准备就绪")).toBeVisible();
  await expect(page.locator(".playback-bar > span")).toHaveText("0/3");
  await page.screenshot({ path: testInfo.outputPath("playback-reset.png"), fullPage: true });
  expect(browserErrors).toEqual([]);
});

test("viewer stays usable without horizontal overflow on a narrow viewport", async ({ page }, testInfo: TestInfo) => {
  const browserErrors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 720, height: 900 });
  await openFixture(page, "gallery");
  await expect(page.locator(".visualization-canvas")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("gallery-narrow.png"), fullPage: true });
  expect(browserErrors).toEqual([]);
});

test("canvas zoom controls enlarge details and restore the fitted view", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFixture(page, "tree");
  const canvas = page.locator(".visualization-canvas");
  const initialWidth = await canvas.evaluate((element) => element.viewBox.baseVal.width);

  await page.getByRole("button", { name: "放大画布" }).click();
  await expect(page.getByRole("button", { name: "适应画布" })).toHaveText("125%");
  expect(await canvas.evaluate((element) => element.viewBox.baseVal.width)).toBeLessThan(initialWidth);
  await expect(canvas).toHaveClass(/is-zoomed/);

  await page.getByRole("button", { name: "适应画布" }).click();
  await expect(page.getByRole("button", { name: "适应画布" })).toHaveText("100%");
  expect(await canvas.evaluate((element) => element.viewBox.baseVal.width)).toBeCloseTo(initialWidth, 5);
});

test("viewer keeps the main visualization and Agent controls usable across product breakpoints", async ({ page }, testInfo: TestInfo) => {
  const browserErrors = collectBrowserErrors(page);
  const viewports = [
    { width: 1024, height: 900, name: "tablet" },
    { width: 1440, height: 900, name: "desktop" },
    { width: 1920, height: 1080, name: "wide" },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openFixture(page, "tree");
    await expect(page.locator(".visualization-canvas")).toBeVisible();
    await expect(page.locator(".agent-input textarea")).toBeVisible();
    await expect(page.getByRole("button", { name: "换种演示方式" })).toBeVisible();
    const measurements = await page.evaluate(() => ({
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      canvasWidth: document.querySelector(".visualization-canvas")?.getBoundingClientRect().width ?? 0,
      agentWidth: document.querySelector(".agent-panel")?.getBoundingClientRect().width ?? 0,
    }));
    expect(measurements.documentOverflow).toBeLessThanOrEqual(1);
    expect(measurements.canvasWidth).toBeGreaterThan(600);
    expect(measurements.agentWidth).toBeGreaterThan(320);
    if (viewport.name !== "desktop") await page.screenshot({ path: testInfo.outputPath(`viewer-${viewport.name}.png`), fullPage: true });
  }

  expect(browserErrors).toEqual([]);
});
