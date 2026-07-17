import { describe, expect, it } from "vitest";
import { bubbleSortFixture, FIXTURES } from "../src/shared/fixtures.js";
import { applyPatchSet } from "../src/shared/patch.js";
import { validateAgentCanvasBudget, validateVisualizationSpec, VisualizationValidationError } from "../src/shared/validation.js";

describe("VisualizationSpec validation", () => {
  it("accepts the fixed-component fixture", () => {
    expect(validateVisualizationSpec(bubbleSortFixture).title).toBe("冒泡排序");
  });

  it("validates representative array, tree, graph, container, call-stack, timeline and pipeline fixtures", () => {
    for (const fixture of Object.values(FIXTURES)) expect(validateVisualizationSpec(fixture).elements.length).toBeGreaterThan(0);
  });

  it.each(["style", "className", "color", "font", "html", "svg", "javascript"])("rejects forbidden field %s", (field) => {
    const unsafe = structuredClone(bubbleSortFixture) as unknown as { elements: Array<Record<string, unknown>> };
    unsafe.elements[0]![field] = field === "style" ? { fill: "red" } : "red";
    expect(() => validateVisualizationSpec(unsafe)).toThrow(VisualizationValidationError);
  });

  it("rejects missing relation targets and step targets", () => {
    const invalid = structuredClone(bubbleSortFixture);
    invalid.relations.push({ id: "bad-edge", kind: "edge", from: "array", to: "missing", state: "normal", directed: true, visible: true });
    invalid.steps[0]!.operations.push({ type: "setState", targetId: "also-missing", state: "active" });
    expect(() => validateVisualizationSpec(invalid)).toThrow(/不存在/);
  });

  it("rejects duplicate IDs and parent cycles", () => {
    const invalid = structuredClone(bubbleSortFixture);
    invalid.elements.push({ id: "array", kind: "node", state: "normal", visible: true });
    invalid.elements[0]!.parentId = "note";
    invalid.elements.find((element) => element.id === "note")!.parentId = "array";
    expect(() => validateVisualizationSpec(invalid)).toThrow(/重复|循环/);
  });

  it.each(["本节小结", "算法总结", "代码思路", "Python 代码说明", "当前操作", "当前观察", "最终结果", "关键结论"])("rejects redundant canvas card %s", (label) => {
    const invalid = structuredClone(bubbleSortFixture);
    invalid.elements.push({ id: "redundant-card", kind: "annotation", label, value: "重复内容", state: "normal", visible: true });
    expect(() => validateVisualizationSpec(invalid)).toThrow(/与右侧区域重复的说明卡片/);
  });

  it("keeps Agent canvases focused on dynamic, controllable information", () => {
    expect(validateAgentCanvasBudget(bubbleSortFixture).elements.length).toBeGreaterThan(0);

    const staticNote = structuredClone(bubbleSortFixture);
    const focus = staticNote.steps[0]!.operations.find((operation) => operation.type === "focus");
    if (focus?.type === "focus") focus.targetIds = focus.targetIds.filter((id) => id !== "note");
    expect(() => validateAgentCanvasBudget(staticNote)).toThrow(/静态说明不应占用画布/);

    const extraNote = structuredClone(bubbleSortFixture);
    extraNote.elements.push({ id: "second-note", kind: "annotation", label: "动态状态", value: "等待变化", state: "normal", visible: true });
    extraNote.steps[0]!.operations.push({ type: "setState", targetId: "second-note", state: "active" });
    expect(() => validateAgentCanvasBudget(extraNote)).toThrow(/最多保留 1 个/);
  });

  it("limits supporting widgets while allowing topology nodes", () => {
    const crowded = structuredClone(bubbleSortFixture);
    crowded.elements = crowded.elements.filter((element) => element.kind !== "annotation");
    crowded.steps[0]!.operations = crowded.steps[0]!.operations.filter((operation) => operation.type !== "focus");
    crowded.elements.push(...Array.from({ length: 9 }, (_, index) => ({
      id: `support-${index}`,
      kind: "rect" as const,
      value: index,
      state: "normal" as const,
      visible: true,
    })));
    expect(() => validateAgentCanvasBudget(crowded)).toThrow(/辅助组件过多/);
  });

  it("rejects an ultra-wide pipeline that would shrink text at the fitted view", () => {
    const tooWide = structuredClone(bubbleSortFixture);
    tooWide.layout = { type: "pipeline", direction: "left-to-right", gap: 28 };
    tooWide.elements = tooWide.elements.map((element, index) => ({ ...element, layout: { row: 0, column: index, width: element.layout?.width } }));
    expect(() => validateAgentCanvasBudget(tooWide)).toThrow(/布局过宽/);

    tooWide.elements = tooWide.elements.map((element, index) => ({ ...element, layout: { row: index === 0 ? 0 : index === 3 ? 2 : 1, column: index === 2 ? 1 : 0, width: element.layout?.width } }));
    expect(validateAgentCanvasBudget(tooWide).elements).toHaveLength(bubbleSortFixture.elements.length);
  });

  it("applies a PatchSet atomically", () => {
    const original = structuredClone(bubbleSortFixture);
    const changed = applyPatchSet(original, {
      summary: "添加说明节点",
      operations: [
        { op: "addElement", element: { id: "extra", kind: "annotation", label: "提示", value: "固定样式", state: "normal", visible: true } },
        { op: "addRelation", relation: { id: "extra-edge", kind: "link", from: "note", to: "extra", state: "normal", directed: false, visible: true } },
      ],
    });
    expect(changed.elements.some((element) => element.id === "extra")).toBe(true);
    expect(original.elements.some((element) => element.id === "extra")).toBe(false);
  });

  it("does not mutate the source when a PatchSet fails", () => {
    const original = structuredClone(bubbleSortFixture);
    expect(() => applyPatchSet(original, {
      summary: "非法关系",
      operations: [
        { op: "addElement", element: { id: "temporary", kind: "node", value: 1, state: "normal", visible: true } },
        { op: "addRelation", relation: { id: "bad", kind: "edge", from: "temporary", to: "missing", state: "normal", directed: true, visible: true } },
      ],
    })).toThrow();
    expect(original.relations).toHaveLength(0);
    expect(original.elements.some((element) => element.id === "temporary")).toBe(false);
  });

  it("rejects manual element boxes that extend beyond the fixed canvas", () => {
    const invalid = structuredClone(bubbleSortFixture);
    invalid.elements[0]!.layout = { x: 30, y: 250, width: 300, height: 110 };
    expect(() => validateVisualizationSpec(invalid)).toThrow(/超出画布/);
  });

  it("rolls back an out-of-bounds layout patch atomically", () => {
    const original = structuredClone(bubbleSortFixture);
    expect(() => applyPatchSet(original, {
      summary: "越界移动",
      operations: [
        { op: "setTitle", title: "不应保留" },
        { op: "updateElement", id: "array", changes: { layout: { x: 10000, y: 250, width: 560 } } },
      ],
    })).toThrow(/超出画布/);
    expect(original.title).toBe("冒泡排序");
  });
});
