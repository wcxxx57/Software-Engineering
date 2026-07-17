import { describe, expect, it } from "vitest";
import { bubbleSortFixture, FIXTURES } from "../src/shared/fixtures.js";
import { applyPatchSet } from "../src/shared/patch.js";
import { validateVisualizationSpec, VisualizationValidationError } from "../src/shared/validation.js";

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
