import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";
import { hierarchy, tree } from "d3-hierarchy";
import type { VisualizationElement, VisualizationSpec } from "../shared/schema.js";
import { ELEMENT_DEFAULT_SIZE, VISUALIZATION_VIEWBOX } from "../shared/geometry.js";

export interface ElementBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function displayValue(value: VisualizationElement["value"]): string {
  const scalar = (item: string | number | boolean | null): string => item === null ? "∅" : typeof item === "boolean" ? (item ? "是" : "否") : String(item);
  if (Array.isArray(value)) return value.map(scalar).join(", ");
  return value === null || value === undefined ? "" : scalar(value);
}

function textUnits(text: string): number {
  return [...text].reduce((sum, character) => sum + (/^[\x00-\xff]$/.test(character) ? 0.58 : 1), 0);
}

function wrappedLineCount(text: string, maxUnits: number): number {
  if (!text) return 0;
  let lines = 1;
  let current = 0;
  for (const character of text) {
    if (character === "\n") { lines += 1; current = 0; continue; }
    const units = /^[\x00-\xff]$/.test(character) ? 0.58 : 1;
    if (current > 0 && current + units > maxUnits) { lines += 1; current = 0; }
    current += units;
  }
  return lines;
}

function contentAwareSize(element: VisualizationElement, baseWidth: number, baseHeight: number): { width: number; height: number } {
  const label = element.label ?? "";
  const value = displayValue(element.value);
  let width = baseWidth;
  let height = baseHeight;

  if (["array", "queue", "timeline", "pipeline"].includes(element.kind)) {
    const values = Array.isArray(element.value) ? element.value : [element.value ?? ""];
    const minimumCellWidth = Math.max(42, ...values.map((item) => textUnits(displayValue(item)) * 18 + 20));
    width = Math.max(width, textUnits(label) * 15 + 24, values.length * minimumCellWidth + 24);
    height = Math.max(height, element.kind === "array" ? 92 : 78);
    return { width, height };
  }

  if (["stack", "callStack"].includes(element.kind)) {
    const values = Array.isArray(element.value) ? element.value : [element.value ?? ""];
    width = Math.max(width, textUnits(label) * 15 + 24, ...values.map((item) => textUnits(displayValue(item)) * 18 + 36));
    height = Math.max(height, 44 + Math.max(1, values.length) * 38);
    return { width, height };
  }

  if (element.kind === "memoryGrid") {
    const values = Array.isArray(element.value) ? element.value : [element.value ?? ""];
    const columns = Math.max(1, Math.ceil(Math.sqrt(values.length)));
    const rows = Math.max(1, Math.ceil(values.length / columns));
    const cellWidth = Math.max(70, ...values.map((item) => textUnits(displayValue(item)) * 18 + 20));
    width = Math.max(width, textUnits(label) * 15 + 24, columns * cellWidth + 24);
    height = Math.max(height, 44 + rows * 44);
    return { width, height };
  }

  if (element.kind === "pointer") {
    width = Math.max(width, textUnits(label) * 15 + 18, textUnits(value) * 18 + 18);
    return { width, height: Math.max(height, 60) };
  }

  if (element.kind === "group") {
    width = Math.max(width, textUnits(label) * 15 + 36, textUnits(value) * 13 + 36);
    return { width, height: Math.max(height, 90) };
  }

  const preferredMaximum = element.kind === "annotation" ? 520 : element.kind === "diamond" ? 340 : element.kind === "circle" ? 420 : 400;
  const desiredSingleLineWidth = Math.max(textUnits(label) * 15 + 32, textUnits(value) * 18 + 32);
  width = Math.max(width, Math.min(preferredMaximum, desiredSingleLineWidth));
  const labelLines = wrappedLineCount(label, Math.max(4, (width - 24) / 15));
  const valueLines = wrappedLineCount(value, Math.max(4, (width - 24) / 18));
  const requiredHeight = 18 + labelLines * 18 + (labelLines && valueLines ? 5 : 0) + valueLines * 21 + 16;
  height = Math.max(height, requiredHeight);
  if (element.kind === "circle") {
    const diameter = Math.max(width, height);
    width = diameter;
    height = diameter;
  }
  return { width, height };
}

function boxFor(element: VisualizationElement, x: number, y: number): ElementBox {
  const size = ELEMENT_DEFAULT_SIZE[element.kind];
  const contentSize = contentAwareSize(element, element.layout?.width ?? size.width, element.layout?.height ?? size.height);
  const width = contentSize.width;
  const height = contentSize.height;
  return { x: x - width / 2, y: y - height / 2, width, height };
}

function specForMaximumStepContent(spec: VisualizationSpec): VisualizationSpec {
  const valueCandidates = new Map<string, VisualizationElement["value"][]>();
  for (const step of spec.steps) {
    for (const operation of step.operations) {
      if (operation.type !== "setValue") continue;
      valueCandidates.set(operation.targetId, [...(valueCandidates.get(operation.targetId) ?? []), operation.value]);
    }
  }
  return {
    ...spec,
    elements: spec.elements.map((element) => {
      const candidates = [element.value, ...(valueCandidates.get(element.id) ?? [])];
      const longest = candidates.reduce<VisualizationElement["value"]>((selected, candidate) => textUnits(displayValue(candidate)) > textUnits(displayValue(selected)) ? candidate : selected, element.value);
      return { ...element, value: longest };
    }),
  };
}

function clampBox(box: ElementBox, width: number, height: number): ElementBox {
  const padding = VISUALIZATION_VIEWBOX.padding;
  // The SVG viewBox expands to the final content. Never shrink a content-aware
  // box back to the nominal 1100 x 640 workspace: doing that can reintroduce
  // clipped labels after sizing has already reserved enough room for them.
  const safeWidth = box.width;
  const safeHeight = box.height;
  return {
    x: Math.max(padding, Math.min(width - padding - safeWidth, box.x)),
    y: Math.max(padding, Math.min(height - padding - safeHeight, box.y)),
    width: safeWidth,
    height: safeHeight,
  };
}

function clampBoxes(boxes: Map<string, ElementBox>, width: number, height: number): Map<string, ElementBox> {
  return new Map([...boxes].map(([id, box]) => [id, clampBox(box, width, height)]));
}

function isAncestor(parentById: Map<string, string | undefined>, possibleAncestorId: string, elementId: string): boolean {
  let parentId = parentById.get(elementId);
  while (parentId) {
    if (parentId === possibleAncestorId) return true;
    parentId = parentById.get(parentId);
  }
  return false;
}

function pairCanOverlap(parentById: Map<string, string | undefined>, leftId: string, rightId: string): boolean {
  return isAncestor(parentById, leftId, rightId) || isAncestor(parentById, rightId, leftId);
}

function overlapAmount(left: ElementBox, right: ElementBox, gap: number): { x: number; y: number } {
  return {
    x: Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x) + gap,
    y: Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y) + gap,
  };
}

export function findElementOverlaps(spec: VisualizationSpec, boxes: Map<string, ElementBox>, gap = 0): string[] {
  const visible = spec.elements.filter((element) => element.visible && boxes.has(element.id));
  const parentById = new Map(spec.elements.map((element) => [element.id, element.parentId]));
  const overlaps: string[] = [];
  for (let leftIndex = 0; leftIndex < visible.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < visible.length; rightIndex += 1) {
      const left = visible[leftIndex]!;
      const right = visible[rightIndex]!;
      if (pairCanOverlap(parentById, left.id, right.id)) continue;
      const amount = overlapAmount(boxes.get(left.id)!, boxes.get(right.id)!, gap);
      if (amount.x > 0 && amount.y > 0) overlaps.push(`${left.id}<->${right.id}`);
    }
  }
  return overlaps;
}

function resolveCollisions(spec: VisualizationSpec, input: Map<string, ElementBox>): Map<string, ElementBox> {
  const boxes = new Map([...input].map(([id, box]) => [id, { ...box }]));
  const visible = spec.elements.filter((element) => element.visible && boxes.has(element.id));
  const gap = Math.max(12, Math.min(48, spec.layout.gap));
  const parentById = new Map(spec.elements.map((element) => [element.id, element.parentId]));
  const moveWithDescendants = (id: string, dx: number, dy: number): void => {
    for (const element of visible) {
      let cursor: string | undefined = element.id;
      let shouldMove = cursor === id;
      while (!shouldMove && cursor) {
        cursor = parentById.get(cursor);
        shouldMove = cursor === id;
      }
      if (!shouldMove) continue;
      const box = boxes.get(element.id)!;
      box.x += dx;
      box.y += dy;
    }
  };

  // Pair relaxation improves continuity for small edits. Keep it bounded for
  // Agent-generated stress cases; the deterministic shelf pass below is the
  // hard no-overlap fallback when a dense cluster has not converged yet.
  const relaxationLimit = Math.min(240, Math.max(80, visible.length * 4));
  for (let iteration = 0; iteration < relaxationLimit; iteration += 1) {
    let changed = false;
    for (let leftIndex = 0; leftIndex < visible.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < visible.length; rightIndex += 1) {
        const leftElement = visible[leftIndex]!;
        const rightElement = visible[rightIndex]!;
        if (pairCanOverlap(parentById, leftElement.id, rightElement.id)) continue;
        const left = boxes.get(leftElement.id)!;
        const right = boxes.get(rightElement.id)!;
        const amount = overlapAmount(left, right, gap);
        if (amount.x <= 0 || amount.y <= 0) continue;

        const sameRow = leftElement.layout?.row !== undefined && leftElement.layout.row === rightElement.layout?.row;
        const sameColumn = leftElement.layout?.column !== undefined && leftElement.layout.column === rightElement.layout?.column;
        const horizontalLayout = ["row", "timeline", "pipeline"].includes(spec.layout.type) || spec.layout.direction === "left-to-right" || spec.layout.direction === "right-to-left";
        const verticalLayout = spec.layout.type === "column" || spec.layout.direction === "top-to-bottom" || spec.layout.direction === "bottom-to-top";
        const separateHorizontally = sameRow || (!sameColumn && horizontalLayout) || (!sameColumn && !verticalLayout && amount.x <= amount.y);

        if (separateHorizontally) {
          const leftCenter = left.x + left.width / 2;
          const rightCenter = right.x + right.width / 2;
          const sign = rightCenter >= leftCenter ? 1 : -1;
          const movement = amount.x / 2 + 0.01;
          left.x -= sign * movement;
          right.x += sign * movement;
        } else {
          const leftCenter = left.y + left.height / 2;
          const rightCenter = right.y + right.height / 2;
          const sign = rightCenter >= leftCenter ? 1 : -1;
          const movement = amount.y / 2 + 0.01;
          left.y -= sign * movement;
          right.y += sign * movement;
        }
        changed = true;
      }
    }
    if (!changed) break;
  }

  const groupDepth = (id: string): number => {
    let depth = 0;
    let cursor = parentById.get(id);
    while (cursor) { depth += 1; cursor = parentById.get(cursor); }
    return depth;
  };
  const groups = visible.filter((element) => element.kind === "group").sort((left, right) => groupDepth(right.id) - groupDepth(left.id));
  for (const group of groups) {
    const children = visible.filter((element) => element.parentId === group.id);
    if (children.length === 0) continue;
    const parent = boxes.get(group.id)!;
    const sidePadding = 18;
    const topPadding = 58;
    const bottomPadding = 18;
    const childrenOverlap = children.some((left, leftIndex) => children.slice(leftIndex + 1).some((right) => {
      const amount = overlapAmount(boxes.get(left.id)!, boxes.get(right.id)!, gap);
      return amount.x > 0 && amount.y > 0;
    }));
    const childOutside = children.some((child) => {
      const box = boxes.get(child.id)!;
      return box.x < parent.x + sidePadding || box.y < parent.y + topPadding || box.x + box.width > parent.x + parent.width - sidePadding || box.y + box.height > parent.y + parent.height - bottomPadding;
    });
    if (!childrenOverlap && !childOutside) continue;

    const area = children.reduce((sum, child) => {
      const box = boxes.get(child.id)!;
      return sum + (box.width + gap) * (box.height + gap);
    }, 0);
    const innerTargetWidth = Math.max(parent.width - sidePadding * 2, Math.sqrt(area * 1.7));
    let cursorX = parent.x + sidePadding;
    let cursorY = parent.y + topPadding;
    let rowHeight = 0;
    let usedRight = cursorX;
    for (const child of children) {
      const box = boxes.get(child.id)!;
      if (cursorX > parent.x + sidePadding && cursorX + box.width > parent.x + sidePadding + innerTargetWidth) {
        cursorX = parent.x + sidePadding;
        cursorY += rowHeight + gap;
        rowHeight = 0;
      }
      moveWithDescendants(child.id, cursorX - box.x, cursorY - box.y);
      const moved = boxes.get(child.id)!;
      usedRight = Math.max(usedRight, moved.x + moved.width);
      cursorX += moved.width + gap;
      rowHeight = Math.max(rowHeight, moved.height);
    }
    parent.width = Math.max(parent.width, usedRight - parent.x + sidePadding);
    parent.height = Math.max(parent.height, cursorY + rowHeight - parent.y + bottomPadding);
  }

  const remaining = findElementOverlaps(spec, boxes, 0);
  if (remaining.length > 0) {
    const padding = VISUALIZATION_VIEWBOX.padding;
    let cursorX = padding;
    let cursorY = padding;
    let rowHeight = 0;
    const targetWidth = Math.max(VISUALIZATION_VIEWBOX.width, Math.sqrt(visible.reduce((area, element) => {
      const box = boxes.get(element.id)!;
      return area + (box.width + gap) * (box.height + gap);
    }, 0) * (VISUALIZATION_VIEWBOX.width / VISUALIZATION_VIEWBOX.height)));
    for (const element of visible.filter((candidate) => !candidate.parentId)) {
      const box = boxes.get(element.id)!;
      if (cursorX > padding && cursorX + box.width > targetWidth - padding) {
        cursorX = padding;
        cursorY += rowHeight + gap;
        rowHeight = 0;
      }
      moveWithDescendants(element.id, cursorX - box.x, cursorY - box.y);
      cursorX += box.width + gap;
      rowHeight = Math.max(rowHeight, box.height);
    }
  }

  const all = [...boxes.values()];
  const minX = Math.min(...all.map((box) => box.x));
  const minY = Math.min(...all.map((box) => box.y));
  const shiftX = minX < VISUALIZATION_VIEWBOX.padding ? VISUALIZATION_VIEWBOX.padding - minX : 0;
  const shiftY = minY < VISUALIZATION_VIEWBOX.padding ? VISUALIZATION_VIEWBOX.padding - minY : 0;
  if (shiftX || shiftY) for (const box of boxes.values()) { box.x += shiftX; box.y += shiftY; }
  return boxes;
}

export function connectorPoint(from: ElementBox, to: ElementBox): { x: number; y: number } {
  const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  if (dx === 0 && dy === 0) return fromCenter;
  const scale = 1 / Math.max(
    Math.abs(dx) / Math.max(1, from.width / 2),
    Math.abs(dy) / Math.max(1, from.height / 2),
  );
  return { x: fromCenter.x + dx * scale, y: fromCenter.y + dy * scale };
}

function manualOrGrid(spec: VisualizationSpec, width: number, height: number): Map<string, ElementBox> {
  const boxes = new Map<string, ElementBox>();
  const explicitColumns = Math.max(0, ...spec.elements.map((element) => (element.layout?.column ?? -1) + 1));
  const explicitRows = Math.max(0, ...spec.elements.map((element) => (element.layout?.row ?? -1) + 1));
  const columns = spec.layout.type === "column" ? 1 : Math.max(explicitColumns, spec.layout.columns ?? Math.ceil(Math.sqrt(spec.elements.length)));
  const rows = Math.max(1, explicitRows, Math.ceil(spec.elements.length / columns));
  const cellWidth = width / Math.max(1, columns);
  const cellHeight = height / rows;
  const sequentialLayout = ["row", "timeline", "pipeline"].includes(spec.layout.type);
  const hasExplicitGrid = spec.elements.some((element) => element.layout?.row !== undefined || element.layout?.column !== undefined);

  spec.elements.forEach((element, index) => {
    let column = element.layout?.column ?? index % columns;
    let row = element.layout?.row ?? Math.floor(index / columns);
    if (sequentialLayout && !hasExplicitGrid) { column = index; row = 0; }
    if (spec.layout.type === "column") { column = 0; row = index; }
    const automaticX = sequentialLayout && !hasExplicitGrid ? ((index + 1) * width) / (spec.elements.length + 1) : (column + 0.5) * cellWidth;
    const automaticY = spec.layout.type === "column" ? ((index + 1) * height) / (spec.elements.length + 1) : (row + 0.5) * cellHeight;
    const x = element.layout?.x ?? automaticX;
    const y = element.layout?.y ?? automaticY;
    boxes.set(element.id, boxFor(element, x, y));
  });
  return boxes;
}

function treeLayout(spec: VisualizationSpec, width: number, height: number): Map<string, ElementBox> {
  const elementById = new Map(spec.elements.map((element) => [element.id, element]));
  const children = new Map<string, string[]>();
  for (const relation of spec.relations.filter((relation) => relation.visible)) {
    children.set(relation.from, [...(children.get(relation.from) ?? []), relation.to]);
  }
  const rootId = spec.layout.rootId ?? spec.elements.find((element) => !spec.relations.some((relation) => relation.to === element.id))?.id ?? spec.elements[0]!.id;
  const seen = new Set<string>();
  const build = (id: string): { id: string; children?: Array<{ id: string; children?: unknown[] }> } => {
    seen.add(id);
    const childNodes = (children.get(id) ?? []).filter((child) => !seen.has(child)).map(build);
    return childNodes.length > 0 ? { id, children: childNodes } : { id };
  };
  const root = hierarchy(build(rootId));
  tree<{ id: string }>().size([width - 160, height - 160])(root as never);
  const boxes = new Map<string, ElementBox>();
  root.descendants().forEach((node) => {
    const element = elementById.get(node.data.id);
    if (element) boxes.set(element.id, boxFor(element, (node.x ?? 0) + 80, (node.y ?? 0) + 80));
  });
  for (const element of spec.elements) if (!boxes.has(element.id)) boxes.set(element.id, boxFor(element, element.layout?.x ?? width - 100, element.layout?.y ?? height - 80));
  return boxes;
}

function forceLayout(spec: VisualizationSpec, width: number, height: number): Map<string, ElementBox> {
  const elementById = new Map(spec.elements.map((element) => [element.id, element]));
  const nodes = spec.elements.map((element, index) => ({ id: element.id, x: element.layout?.x ?? 100 + (index * 97) % (width - 200), y: element.layout?.y ?? 100 + (index * 61) % (height - 200) }));
  const links = spec.relations.map((relation) => ({ source: relation.from, target: relation.to }));
  const simulation = forceSimulation(nodes)
    .force("charge", forceManyBody().strength(-600))
    .force("center", forceCenter(width / 2, height / 2))
    .force("link", forceLink(links).id((node) => (node as { id: string }).id).distance(150))
    .force("collide", forceCollide().radius((node) => {
      const element = elementById.get((node as { id: string }).id)!;
      const size = ELEMENT_DEFAULT_SIZE[element.kind];
      const boxWidth = element.layout?.width ?? size.width;
      const boxHeight = element.layout?.height ?? size.height;
      return Math.hypot(boxWidth, boxHeight) / 2 + spec.layout.gap / 2;
    }).strength(1).iterations(3))
    .stop();
  for (let index = 0; index < 160; index += 1) simulation.tick();
  return new Map(nodes.map((node) => {
    const element = elementById.get(node.id)!;
    return [node.id, boxFor(element, Math.max(70, Math.min(width - 70, node.x ?? width / 2)), Math.max(70, Math.min(height - 70, node.y ?? height / 2)))];
  }));
}

export function computeLayout(spec: VisualizationSpec, width = 1100, height = 640): Map<string, ElementBox> {
  const sizingSpec = specForMaximumStepContent(spec);
  const boxes = sizingSpec.layout.type === "tree"
    ? treeLayout(sizingSpec, width, height)
    : sizingSpec.layout.type === "force"
      ? forceLayout(sizingSpec, width, height)
      : manualOrGrid(sizingSpec, width, height);
  return resolveCollisions(sizingSpec, clampBoxes(boxes, width, height));
}
