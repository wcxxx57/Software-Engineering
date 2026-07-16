import { describe, expect, it } from "vitest";
import { bubbleSortFixture } from "../src/shared/fixtures.js";
import { applyRuntimeCommand, INITIAL_RUNTIME_STATE, materializeVisualization } from "../src/shared/runtime.js";

describe("runtime state", () => {
  it("materializes steps without mutating the stored spec", () => {
    const materialized = materializeVisualization(bubbleSortFixture, 2);
    expect(materialized.elements.find((element) => element.id === "array")?.value).toEqual([2, 5, 4, 1, 3]);
    expect(bubbleSortFixture.elements.find((element) => element.id === "array")?.value).toEqual([5, 2, 4, 1, 3]);
  });

  it("keeps playback state transient and bounded", () => {
    let state = applyRuntimeCommand(INITIAL_RUNTIME_STATE, { type: "play" }, 3);
    expect(state.playing).toBe(true);
    state = applyRuntimeCommand(state, { type: "seek", step: 99 }, 3);
    expect(state).toMatchObject({ step: 3, playing: false });
    expect(applyRuntimeCommand(state, { type: "reset" }, 3)).toEqual(INITIAL_RUNTIME_STATE);
  });
});
