import { forceCenter, forceLink, forceManyBody, forceSimulation } from "d3-force";
import { hierarchy, tree } from "d3-hierarchy";
import type { VisualizationElement, VisualizationSpec } from "../shared/schema.js";

export interface ElementBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEFAULT_SIZE: Record<VisualizationElement["kind"], { width: number; height: number }> = {
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
};

function boxFor(element: VisualizationElement, x: number, y: number): ElementBox {
  const size = DEFAULT_SIZE[element.kind];
  const width = element.layout?.width ?? size.width;
  const height = element.layout?.height ?? size.height;
  return { x: x - width / 2, y: y - height / 2, width, height };
}

function manualOrGrid(spec: VisualizationSpec, width: number, height: number): Map<string, ElementBox> {
  const boxes = new Map<string, ElementBox>();
  const columns = spec.layout.type === "column" ? 1 : (spec.layout.columns ?? Math.ceil(Math.sqrt(spec.elements.length)));
  const rows = Math.max(1, Math.ceil(spec.elements.length / columns));
  const cellWidth = width / Math.max(1, columns);
  const cellHeight = height / rows;

  spec.elements.forEach((element, index) => {
    let column = element.layout?.column ?? index % columns;
    let row = element.layout?.row ?? Math.floor(index / columns);
    if (["row", "timeline", "pipeline"].includes(spec.layout.type)) { column = index; row = 0; }
    if (spec.layout.type === "column") { column = 0; row = index; }
    const automaticX = ["row", "timeline", "pipeline"].includes(spec.layout.type) ? ((index + 1) * width) / (spec.elements.length + 1) : (column + 0.5) * cellWidth;
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
  const nodes = spec.elements.map((element, index) => ({ id: element.id, x: element.layout?.x ?? 100 + (index * 97) % (width - 200), y: element.layout?.y ?? 100 + (index * 61) % (height - 200) }));
  const links = spec.relations.map((relation) => ({ source: relation.from, target: relation.to }));
  const simulation = forceSimulation(nodes)
    .force("charge", forceManyBody().strength(-600))
    .force("center", forceCenter(width / 2, height / 2))
    .force("link", forceLink(links).id((node) => (node as { id: string }).id).distance(150))
    .stop();
  for (let index = 0; index < 160; index += 1) simulation.tick();
  const elementById = new Map(spec.elements.map((element) => [element.id, element]));
  return new Map(nodes.map((node) => {
    const element = elementById.get(node.id)!;
    return [node.id, boxFor(element, Math.max(70, Math.min(width - 70, node.x ?? width / 2)), Math.max(70, Math.min(height - 70, node.y ?? height / 2)))];
  }));
}

export function computeLayout(spec: VisualizationSpec, width = 1100, height = 640): Map<string, ElementBox> {
  if (spec.layout.type === "tree") return treeLayout(spec, width, height);
  if (spec.layout.type === "force") return forceLayout(spec, width, height);
  return manualOrGrid(spec, width, height);
}
