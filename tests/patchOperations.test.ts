import { describe, expect, it } from "vitest";
import { bubbleSortFixture } from "../src/shared/fixtures.js";
import { applyPatchSet } from "../src/shared/patch.js";
import { validateVisualizationSpec } from "../src/shared/validation.js";

describe("PatchSet operation matrix", () => {
  it("applies content, data, layout, relation, code and step operations", () => {
    const changed = applyPatchSet(bubbleSortFixture, {
      summary: "覆盖全部编辑维度",
      operations: [
        { op: "setTitle", title: "排序过程" },
        { op: "setConcept", concept: "交换与不变量" },
        { op: "setDescription", description: "逐轮把最大值移动到右侧。" },
        { op: "setLayout", layout: { type: "manual", direction: "left-to-right", gap: 36 } },
        { op: "setParameters", parameters: [{ id: "size", label: "数组长度", type: "number", default: 5, min: 1, max: 20 }] },
        { op: "setVariants", variants: [{ id: "ascending", label: "升序" }] },
        { op: "setCode", code: { language: "python", title: "交换", lines: ["for i in range(len(a) - 1):", "    for j in range(len(a) - 1 - i):", "        if a[j] > a[j + 1]:", "            a[j], a[j + 1] = a[j + 1], a[j]"] } },
        { op: "addElement", element: { id: "extraNode", kind: "node", label: "哨兵", value: 0, state: "normal", visible: true, layout: { x: 960, y: 390 } } },
        { op: "updateElement", id: "extraNode", changes: { label: "边界", value: 1, state: "active", layout: { x: 960, y: 390, width: 88, height: 88 } } },
        { op: "addRelation", relation: { id: "noteToExtra", kind: "arrow", from: "note", to: "extraNode", label: "说明", state: "normal", directed: true, visible: true } },
        { op: "updateRelation", id: "noteToExtra", changes: { label: "关联", state: "visited" } },
        { op: "addStep", index: 0, step: { id: "prepare", title: "准备", description: "聚焦哨兵。", operations: [{ type: "focus", targetIds: ["extraNode"] }] } },
        { op: "updateStep", id: "prepare", step: { title: "准备边界" } },
        { op: "reorderSteps", stepIds: ["compare", "prepare", "swap", "advance"] },
      ],
    });

    expect(changed).toMatchObject({ title: "排序过程", concept: "交换与不变量" });
    expect(changed.elements.find((element) => element.id === "extraNode")).toMatchObject({ label: "边界", value: 1, state: "active" });
    expect(changed.relations.find((relation) => relation.id === "noteToExtra")).toMatchObject({ label: "关联", state: "visited" });
    expect(changed.steps.map((step) => step.id)).toEqual(["compare", "prepare", "swap", "advance"]);
    expect(changed.steps[1]?.title).toBe("准备边界");
    expect(changed.parameters[0]?.id).toBe("size");
    expect(changed.variants[0]?.id).toBe("ascending");
    expect(changed.code?.lines).toHaveLength(4);
  });

  it("removes relations, steps and elements without leaving dangling references", () => {
    const withExtra = applyPatchSet(bubbleSortFixture, {
      summary: "添加可删除内容",
      operations: [
        { op: "addElement", element: { id: "temporary", kind: "node", value: 7, state: "normal", visible: true, layout: { x: 960, y: 390 } } },
        { op: "addRelation", relation: { id: "temporaryEdge", kind: "edge", from: "note", to: "temporary", state: "normal", directed: true, visible: true } },
        { op: "addStep", step: { id: "temporaryStep", title: "临时", description: "临时目标。", operations: [{ type: "setState", targetId: "temporary", state: "active" }] } },
      ],
    });
    const removed = applyPatchSet(withExtra, {
      summary: "删除内容",
      operations: [
        { op: "removeRelation", id: "temporaryEdge" },
        { op: "removeStep", id: "temporaryStep" },
        { op: "removeElement", id: "temporary" },
      ],
    });
    expect(removed.elements.some((element) => element.id === "temporary")).toBe(false);
    expect(removed.relations.some((relation) => relation.id === "temporaryEdge")).toBe(false);
    expect(removed.steps.some((step) => step.id === "temporaryStep")).toBe(false);
    expect(() => validateVisualizationSpec(removed)).not.toThrow();
  });

  it.each(["style", "className", "color", "font", "html", "svg", "javascript"])("rejects forbidden patch field %s", (field) => {
    expect(() => applyPatchSet(bubbleSortFixture, {
      summary: "非法样式",
      operations: [{ op: "updateElement", id: "array", changes: { [field]: "red" } }],
    })).toThrow();
  });

  it("rejects incomplete and duplicate step reorder operations", () => {
    expect(() => applyPatchSet(bubbleSortFixture, {
      summary: "错误排序",
      operations: [{ op: "reorderSteps", stepIds: ["compare", "compare", "swap"] }],
    })).toThrow(/全部且不重复/);
  });
});
