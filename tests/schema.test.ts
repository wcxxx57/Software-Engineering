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
      operations: [{ op: "addRelation", relation: { id: "bad", kind: "edge", from: "array", to: "missing", state: "normal", directed: true, visible: true } }],
    })).toThrow();
    expect(original.relations).toHaveLength(0);
  });
});
