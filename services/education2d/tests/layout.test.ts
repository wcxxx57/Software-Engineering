import { describe, expect, it } from "vitest";
import { computeLayout, findElementOverlaps } from "../src/client/layout.js";
import { densePipelineFixture } from "../src/shared/fixtures.js";
import { materializeVisualization } from "../src/shared/runtime.js";
import type { ElementKind, VisualizationElement, VisualizationSpec } from "../src/shared/schema.js";

const kinds: ElementKind[] = ["array", "node", "pointer", "annotation", "rect", "circle", "diamond"];

function baseSpec(layout: VisualizationSpec["layout"], elements: VisualizationElement[], relations: VisualizationSpec["relations"] = []): VisualizationSpec {
  return {
    schemaVersion: 1,
    title: "布局碰撞回归",
    concept: "验证任意合法元素不会重叠",
    description: "",
    layout,
    elements,
    relations,
    parameters: [],
    variants: [],
    steps: [],
  };
}

function element(id: string, kind: ElementKind, index: number, layout?: VisualizationElement["layout"]): VisualizationElement {
  return { id, kind, label: `元素 ${index}`, value: `值 ${index}`, state: "normal", visible: true, layout };
}

function expectNoOverlap(spec: VisualizationSpec): void {
  const boxes = computeLayout(spec);
  expect(findElementOverlaps(spec, boxes, 0)).toEqual([]);
  for (const box of boxes.values()) {
    expect(Number.isFinite(box.x) && Number.isFinite(box.y)).toBe(true);
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  }
}

describe("collision-safe visualization layout", () => {
  it("honors explicit pipeline rows and columns from the reported overlap", () => {
    const spec = baseSpec(
      { type: "pipeline", direction: "left-to-right", gap: 36 },
      [
        element("inputArray", "array", 0, { row: 0, column: 0, width: 480, height: 82 }),
        element("pair", "array", 1, { row: 1, column: 0, width: 210, height: 82 }),
        element("compare", "diamond", 2, { row: 1, column: 1, width: 180, height: 100 }),
        element("swap", "node", 3, { row: 1, column: 2, width: 210, height: 82 }),
        element("fixed", "array", 4, { row: 1, column: 3, width: 180, height: 82 }),
        element("roundInfo", "annotation", 5, { row: 2, column: 0, width: 260, height: 72 }),
        element("movement", "annotation", 6, { row: 2, column: 1, width: 300, height: 72 }),
        element("invariant", "annotation", 7, { row: 2, column: 2, width: 360, height: 72 }),
        element("earlyStop", "annotation", 8, { row: 3, column: 1, width: 360, height: 72 }),
      ],
    );
    expectNoOverlap(spec);
    const boxes = computeLayout(spec);
    expect(boxes.get("inputArray")!.y).toBeLessThan(boxes.get("pair")!.y);
    expect(boxes.get("pair")!.x).toBeLessThan(boxes.get("compare")!.x);
    expect(boxes.get("roundInfo")!.y).toBeGreaterThan(boxes.get("pair")!.y);
  });

  it("separates many elements that receive the same manual position", () => {
    const elements = Array.from({ length: 18 }, (_, index) => element(`same${index}`, kinds[index % kinds.length]!, index, { x: 550, y: 320, width: 120 + (index % 4) * 70, height: 70 + (index % 3) * 35 }));
    expectNoOverlap(baseSpec({ type: "manual", direction: "left-to-right", gap: 28 }, elements));
  });

  it("separates one hundred mixed elements generated at the same coordinate", () => {
    const elements = Array.from({ length: 100 }, (_, index) => element(
      `crowded${index}`,
      kinds[index % kinds.length]!,
      index,
      { x: 550, y: 320, width: 80 + (index % 8) * 45, height: 55 + (index % 6) * 24 },
    ));
    expectNoOverlap(baseSpec({ type: "manual", direction: "left-to-right", gap: 18 }, elements));
  });

  it("expands undersized boxes instead of clipping very long labels and values", () => {
    const longText = "每一段文字都必须完整显示，不能出现省略号，也不能因为用户或智能体给出的尺寸太小而被裁切。".repeat(6);
    const spec = baseSpec({ type: "manual", direction: "left-to-right", gap: 24 }, [
      { ...element("longNote", "annotation", 0, { x: 300, y: 200, width: 120, height: 42 }), label: "完整说明", value: longText },
      { ...element("longArray", "array", 1, { x: 700, y: 400, width: 140, height: 50 }), label: "完整数组值", value: [longText] },
    ]);
    const boxes = computeLayout(spec);
    expectNoOverlap(spec);
    expect(boxes.get("longNote")!.height).toBeGreaterThan(42);
    expect(boxes.get("longNote")!.width).toBeGreaterThan(120);
    expect(boxes.get("longArray")!.width).toBeGreaterThan(140);
  });

  it("keeps dense children from overlapping inside a group scope", () => {
    const elements: VisualizationElement[] = [
      element("group", "group", 0, { x: 550, y: 320, width: 420, height: 320 }),
      ...Array.from({ length: 8 }, (_, index) => ({ ...element(`child${index}`, kinds[(index + 1) % kinds.length]!, index + 1, { x: 550, y: 320, width: 130, height: 80 }), parentId: "group" })),
    ];
    const spec = baseSpec({ type: "manual", direction: "left-to-right", gap: 20 }, elements);
    expectNoOverlap(spec);
    const boxes = computeLayout(spec);
    const parent = boxes.get("group")!;
    for (const child of elements.filter((candidate) => candidate.parentId === "group")) {
      const box = boxes.get(child.id)!;
      expect(box.x).toBeGreaterThanOrEqual(parent.x);
      expect(box.y).toBeGreaterThanOrEqual(parent.y);
      expect(box.x + box.width).toBeLessThanOrEqual(parent.x + parent.width);
      expect(box.y + box.height).toBeLessThanOrEqual(parent.y + parent.height);
    }
  });

  it("keeps two nested group levels contained while resolving child collisions", () => {
    const elements: VisualizationElement[] = [
      { ...element("outer", "group", 0, { x: 420, y: 300, width: 360, height: 260 }), label: "外部分组", value: "容纳内部完整结构" },
      { ...element("inner", "group", 1, { x: 420, y: 300, width: 240, height: 180 }), label: "内部分组", value: "容纳所有子元素", parentId: "outer" },
      ...Array.from({ length: 12 }, (_, index) => ({
        ...element(`nested${index}`, kinds[(index + 2) % kinds.length]!, index + 2, { x: 420, y: 300, width: 100 + (index % 3) * 35, height: 65 + (index % 2) * 25 }),
        parentId: "inner",
      })),
    ];
    const spec = baseSpec({ type: "manual", direction: "left-to-right", gap: 18 }, elements);
    expectNoOverlap(spec);
    const boxes = computeLayout(spec);
    for (const candidate of elements.filter((item) => item.parentId)) {
      const child = boxes.get(candidate.id)!;
      const parent = boxes.get(candidate.parentId!)!;
      expect(child.x).toBeGreaterThanOrEqual(parent.x);
      expect(child.y).toBeGreaterThanOrEqual(parent.y);
      expect(child.x + child.width).toBeLessThanOrEqual(parent.x + parent.width);
      expect(child.y + child.height).toBeLessThanOrEqual(parent.y + parent.height);
    }
  });

  it("reserves the largest step content so playback never causes clipping or reflow", () => {
    const layouts = Array.from({ length: densePipelineFixture.steps.length + 1 }, (_, step) => {
      const materialized = materializeVisualization(densePipelineFixture, step);
      const effective = { ...densePipelineFixture, elements: materialized.elements, relations: materialized.relations };
      expectNoOverlap(effective);
      return computeLayout(effective);
    });
    for (const id of densePipelineFixture.elements.map((candidate) => candidate.id)) {
      const baseline = layouts[0]!.get(id)!;
      for (const layout of layouts.slice(1)) expect(layout.get(id)).toEqual(baseline);
    }
  });

  it("survives dense row, column, grid, timeline and pipeline variants", () => {
    for (const type of ["row", "column", "grid", "timeline", "pipeline"] as const) {
      for (let sample = 0; sample < 20; sample += 1) {
        const count = 8 + (sample % 13);
        const elements = Array.from({ length: count }, (_, index) => element(
          `${type}${sample}_${index}`,
          kinds[(sample + index) % kinds.length]!,
          index,
          type === "grid" || (type === "pipeline" && sample % 2 === 0)
            ? { row: index % 4, column: Math.floor(index / 4), width: 90 + ((sample * 17 + index * 31) % 280), height: 60 + ((sample * 13 + index * 19) % 130) }
            : { width: 90 + ((sample * 17 + index * 31) % 280), height: 60 + ((sample * 13 + index * 19) % 130) },
        ));
        expectNoOverlap(baseSpec({ type, direction: type === "column" ? "top-to-bottom" : "left-to-right", columns: type === "grid" ? 4 : undefined, gap: 8 + sample * 4 }, elements));
      }
    }
  });

  it("survives dense tree and force graphs with varied node sizes", () => {
    for (const type of ["tree", "force"] as const) {
      for (let sample = 0; sample < 12; sample += 1) {
        const count = 10 + sample;
        const elements = Array.from({ length: count }, (_, index) => element(`node${sample}_${index}`, index % 3 === 0 ? "annotation" : "node", index, { width: 80 + ((sample + index) % 5) * 55, height: 70 + ((sample * 3 + index) % 4) * 35 }));
        const relations = elements.slice(1).map((child, index) => ({ id: `edge${sample}_${index}`, kind: "edge" as const, from: elements[Math.floor(index / 2)]!.id, to: child.id, state: "normal" as const, directed: true, visible: true }));
        expectNoOverlap(baseSpec({ type, direction: "top-to-bottom", rootId: type === "tree" ? elements[0]!.id : undefined, gap: 24 }, elements, relations));
      }
    }
  });

  it("keeps single binary-tree children in their left or right slots", () => {
    const elements = ["root", "left", "leftRight", "right", "rightRight", "rightRightLeft"].map((id, index) => ({
      ...element(id, "node", index),
      value: [8, 3, 6, 10, 14, 13][index]!,
    }));
    const relations: VisualizationSpec["relations"] = [
      { id: "rootLeft", kind: "edge", from: "root", to: "left", label: "左：更小", state: "normal", directed: true, visible: true },
      { id: "rootRight", kind: "edge", from: "root", to: "right", label: "右：更大", state: "normal", directed: true, visible: true },
      { id: "leftOnlyRight", kind: "edge", from: "left", to: "leftRight", label: "右", state: "normal", directed: true, visible: true },
      { id: "rightOnlyRight", kind: "edge", from: "right", to: "rightRight", label: "右", state: "normal", directed: true, visible: true },
      { id: "rightRightOnlyLeft", kind: "edge", from: "rightRight", to: "rightRightLeft", label: "左", state: "normal", directed: true, visible: true },
    ];
    const boxes = computeLayout(baseSpec({ type: "tree", direction: "top-to-bottom", rootId: "root", gap: 48 }, elements, relations));
    const centerX = (id: string): number => boxes.get(id)!.x + boxes.get(id)!.width / 2;
    expect(centerX("left")).toBeLessThan(centerX("root"));
    expect(centerX("right")).toBeGreaterThan(centerX("root"));
    expect(centerX("leftRight")).toBeGreaterThan(centerX("left"));
    expect(centerX("rightRight")).toBeGreaterThan(centerX("right"));
    expect(centerX("rightRightLeft")).toBeLessThan(centerX("rightRight"));
  });
});
