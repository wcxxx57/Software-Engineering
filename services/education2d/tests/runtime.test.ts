import { describe, expect, it } from "vitest";
import { bubbleSortFixture } from "../src/shared/fixtures.js";
import { applyRuntimeCommand, INITIAL_RUNTIME_STATE, materializeVisualization, normalizeRuntimeState } from "../src/shared/runtime.js";

describe("runtime state", () => {
  it("normalizes the runtime snapshot exposed to inspect_visualization", () => {
    expect(normalizeRuntimeState(bubbleSortFixture, {
      step: 99,
      playing: true,
      highlightedIds: ["array", "missing", "array"],
      focusedIds: ["left", "missing"],
    })).toEqual({
      step: bubbleSortFixture.steps.length,
      playing: true,
      highlightedIds: ["array"],
      focusedIds: ["left"],
    });
  });

  it("materializes steps without mutating the stored spec", () => {
    const materialized = materializeVisualization(bubbleSortFixture, 2);
    expect(materialized.elements.find((element) => element.id === "array")?.value).toEqual([2, 5, 4, 1, 3]);
    expect(bubbleSortFixture.elements.find((element) => element.id === "array")?.value).toEqual([5, 2, 4, 1, 3]);
  });

  it("moves a pointer through stable element IDs instead of display text", () => {
    const spec = structuredClone(bubbleSortFixture);
    const pointer = spec.elements.find((element) => element.id === "left")!;
    pointer.targetId = "array";
    pointer.targetIndex = 0;
    spec.steps[0]!.operations.push({ type: "setPointerTarget", targetId: "left", pointsToId: "array", targetIndex: 2 });

    const materialized = materializeVisualization(spec, 1);
    expect(materialized.elements.find((element) => element.id === "left")).toMatchObject({ targetId: "array", targetIndex: 2 });
    expect(pointer).toMatchObject({ targetId: "array", targetIndex: 0 });
  });

  it("keeps playback state transient and bounded", () => {
    let state = applyRuntimeCommand(INITIAL_RUNTIME_STATE, { type: "play" }, 3);
    expect(state.playing).toBe(true);
    state = applyRuntimeCommand(state, { type: "seek", step: 99 }, 3);
    expect(state).toMatchObject({ step: 3, playing: false });
    expect(applyRuntimeCommand(state, { type: "reset" }, 3)).toEqual(INITIAL_RUNTIME_STATE);
  });

  it("supports every transient timeline command including focus", () => {
    let state = { ...INITIAL_RUNTIME_STATE };
    state = applyRuntimeCommand(state, { type: "next" }, 3);
    expect(state.step).toBe(1);
    state = applyRuntimeCommand(state, { type: "previous" }, 3);
    expect(state.step).toBe(0);
    state = applyRuntimeCommand(state, { type: "highlight", targetIds: ["array"] }, 3);
    expect(state.highlightedIds).toEqual(["array"]);
    state = applyRuntimeCommand(state, { type: "focus", targetIds: ["array", "left"] }, 3);
    expect(state.focusedIds).toEqual(["array", "left"]);
    state = applyRuntimeCommand(state, { type: "clearHighlight" }, 3);
    expect(state.highlightedIds).toEqual([]);
    expect(state.focusedIds).toEqual(["array", "left"]);
    state = applyRuntimeCommand(state, { type: "pause" }, 3);
    expect(state.playing).toBe(false);
  });
});
