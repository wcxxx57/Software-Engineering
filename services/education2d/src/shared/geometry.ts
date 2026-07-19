import type { ElementKind } from "./schema.js";

export const VISUALIZATION_VIEWBOX = Object.freeze({
  width: 1100,
  height: 640,
  padding: 16,
});

export const ELEMENT_DEFAULT_SIZE: Readonly<Record<ElementKind, Readonly<{ width: number; height: number }>>> = Object.freeze({
  array: { width: 560, height: 110 },
  node: { width: 88, height: 88 },
  pointer: { width: 90, height: 60 },
  stack: { width: 240, height: 300 },
  queue: { width: 500, height: 110 },
  callStack: { width: 300, height: 340 },
  memoryGrid: { width: 440, height: 260 },
  timeline: { width: 620, height: 150 },
  pipeline: { width: 620, height: 150 },
  group: { width: 360, height: 260 },
  annotation: { width: 360, height: 120 },
  rect: { width: 160, height: 90 },
  circle: { width: 100, height: 100 },
  diamond: { width: 130, height: 110 },
});
