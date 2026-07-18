import { useEffect, useMemo, useRef, useState } from "react";
import { computeLayout, connectorPoint, type ElementBox } from "../layout.js";
import { COMPONENT_CLASS_MAP, DESIGN_TOKEN_HASH, DESIGN_TOKENS, SEMANTIC_STATE_CLASS_MAP, STYLE_CONTRACT_HASH } from "../designTokens.js";
import { materializeVisualization } from "../../shared/runtime.js";
import type { SemanticState, VisualizationElement, VisualizationRelation, VisualizationSpec } from "../../shared/schema.js";

interface VisualizationCanvasProps {
  spec: VisualizationSpec;
  step: number;
  highlightedIds?: string[];
  focusedIds?: string[];
}

const MIN_ZOOM = 0.75;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.25;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function stateClass(state: SemanticState, highlighted: boolean): string {
  return SEMANTIC_STATE_CLASS_MAP[highlighted ? "active" : state];
}

function textValue(value: VisualizationElement["value"]): string {
  const display = (item: string | number | boolean | null): string => {
    if (item === null) return "∅";
    if (typeof item === "boolean") return item ? "是" : "否";
    return String(item);
  };
  if (Array.isArray(value)) return value.map(display).join(", ");
  if (typeof value === "boolean") return value ? "是" : "否";
  return value === null || value === undefined ? "" : String(value);
}

function characterUnits(character: string): number {
  return /^[\x00-\xff]$/.test(character) ? 0.58 : 1;
}

export function fitTextLines(text: string, maxUnits: number, _maxLines: number): string[] {
  if (!text) return [];
  const lines: string[] = [];
  let current = "";
  let units = 0;
  const flush = () => {
    if (current || lines.length === 0) lines.push(current);
    current = "";
    units = 0;
  };
  for (const character of text) {
    if (character === "\n") { flush(); continue; }
    const nextUnits = characterUnits(character);
    if (current && units + nextUnits > maxUnits) flush();
    current += character;
    units += nextUnits;
  }
  if (current) flush();
  return lines;
}

function TextLines({ lines, x, firstBaseline, lineHeight, className, anchor = "middle" }: { lines: string[]; x: number; firstBaseline: number; lineHeight: number; className: string; anchor?: "start" | "middle" }) {
  return <text className={className} x={x} y={firstBaseline} textAnchor={anchor}>{lines.map((line, index) => <tspan key={`${line}-${index}`} x={x} dy={index === 0 ? 0 : lineHeight}>{line}</tspan>)}</text>;
}

function CardText({ element, box }: { element: VisualizationElement; box: ElementBox }) {
  const hasValue = element.value !== undefined;
  const labelLines = element.label ? fitTextLines(element.label, Math.max(4, (box.width - 24) / 15), hasValue ? 1 : Math.max(1, Math.floor((box.height - 20) / 19))) : [];
  const valueLines = hasValue ? fitTextLines(textValue(element.value), Math.max(4, (box.width - 24) / 18), element.label ? Math.max(1, Math.min(2, Math.floor((box.height - 38) / 21))) : Math.max(1, Math.floor((box.height - 20) / 21))) : [];
  const labelHeight = labelLines.length * 18;
  const valueHeight = valueLines.length * 21;
  const gap = labelLines.length && valueLines.length ? 3 : 0;
  const totalHeight = labelHeight + gap + valueHeight;
  const top = box.y + Math.max(8, (box.height - totalHeight) / 2);
  const centerX = box.x + box.width / 2;
  return <>
    {labelLines.length > 0 && <TextLines lines={labelLines} x={centerX} firstBaseline={top + 14} lineHeight={18} className="element-label" />}
    {valueLines.length > 0 && <TextLines lines={valueLines} x={centerX} firstBaseline={top + labelHeight + gap + 16} lineHeight={21} className="element-value" />}
  </>;
}

function pointerDisplayValue(pointer: VisualizationElement, target: VisualizationElement | undefined): VisualizationElement["value"] {
  if (!target) return pointer.value;
  if (pointer.targetIndex !== undefined && Array.isArray(target.value)) return target.value[pointer.targetIndex] ?? null;
  if (Array.isArray(target.value)) return target.label ?? target.id;
  return target.value ?? null;
}

function PointerText({ element, box, target }: { element: VisualizationElement; box: ElementBox; target?: VisualizationElement }) {
  const bound = target !== undefined;
  const centerX = box.x + box.width / 2;
  const label = element.label ? fitTextLines(element.label, Math.max(4, (box.width - 18) / 15), 1) : [];
  const displayValue = pointerDisplayValue(element, target);
  const displayText = displayValue === null ? "∅ / None" : textValue(displayValue);
  const value = displayValue !== undefined ? fitTextLines(displayText, Math.max(3, (box.width - 18) / 18), 1) : [];
  return <>
    {label.length > 0 && <TextLines lines={label} x={centerX} firstBaseline={box.y + (bound ? 22 : 36)} lineHeight={18} className="element-label" />}
    {value.length > 0 && <TextLines lines={value} x={centerX} firstBaseline={box.y + (bound ? 43 : 54)} lineHeight={21} className="element-value" />}
  </>;
}

function GroupText({ element, box }: { element: VisualizationElement; box: ElementBox }) {
  const x = box.x + 18;
  const label = element.label ? fitTextLines(element.label, Math.max(4, (box.width - 36) / 15), 1) : [];
  const value = element.value !== undefined ? fitTextLines(textValue(element.value), Math.max(4, (box.width - 36) / 15), 1) : [];
  return <>
    {label.length > 0 && <TextLines lines={label} x={x} firstBaseline={box.y + 23} lineHeight={18} className="element-label" anchor="start" />}
    {value.length > 0 && <TextLines lines={value} x={x} firstBaseline={box.y + 43} lineHeight={18} className="element-value group-value" anchor="start" />}
  </>;
}

function SequenceElement({ element, box, vertical = false }: { element: VisualizationElement; box: ElementBox; vertical?: boolean }) {
  const values = Array.isArray(element.value) ? element.value : [element.value ?? ""];
  const showIndexes = element.kind === "array" && !vertical;
  const cellWidth = vertical ? box.width - 24 : Math.max(42, (box.width - 24) / Math.max(1, values.length));
  const cellHeight = vertical ? Math.max(38, (box.height - 44) / Math.max(1, values.length)) : box.height - 44;
  return <g>
    <rect className="element-shape sequence-shell" x={box.x} y={box.y} width={box.width} height={box.height} rx={DESIGN_TOKENS.radius.medium} />
    {element.label && <TextLines lines={fitTextLines(element.label, Math.max(4, (box.width - 24) / 15), 1)} x={box.x + 12} firstBaseline={box.y + 22} lineHeight={18} className="element-label" anchor="start" />}
    {values.map((value, index) => {
      const x = vertical ? box.x + 12 : box.x + 12 + index * cellWidth;
      const y = vertical ? box.y + 34 + (values.length - 1 - index) * cellHeight : box.y + 32;
      return <g key={`${element.id}-${index}`}>
        <rect className="sequence-cell" x={x} y={y} width={cellWidth} height={cellHeight} rx={DESIGN_TOKENS.radius.small} />
        <TextLines lines={fitTextLines(textValue(value), Math.max(2, (cellWidth - 12) / 18), 1)} x={x + cellWidth / 2} firstBaseline={y + cellHeight / 2 + (showIndexes ? 1 : 6)} lineHeight={21} className="element-value" />
        {showIndexes && <text className="array-index" x={x + cellWidth / 2} y={y + cellHeight - 8} textAnchor="middle">索引 {index}</text>}
      </g>;
    })}
  </g>;
}

function GridElement({ element, box }: { element: VisualizationElement; box: ElementBox }) {
  const values = Array.isArray(element.value) ? element.value : [element.value ?? ""];
  const columns = Math.max(1, Math.ceil(Math.sqrt(values.length)));
  const rows = Math.max(1, Math.ceil(values.length / columns));
  const cellWidth = (box.width - 24) / columns;
  const cellHeight = (box.height - 44) / rows;
  return <g>
    <rect className="element-shape sequence-shell" x={box.x} y={box.y} width={box.width} height={box.height} rx={DESIGN_TOKENS.radius.medium} />
    {element.label && <TextLines lines={fitTextLines(element.label, Math.max(4, (box.width - 24) / 15), 1)} x={box.x + 12} firstBaseline={box.y + 22} lineHeight={18} className="element-label" anchor="start" />}
    {values.map((value, index) => {
      const x = box.x + 12 + (index % columns) * cellWidth;
      const y = box.y + 32 + Math.floor(index / columns) * cellHeight;
      return <g key={`${element.id}-${index}`}><rect className="sequence-cell" x={x} y={y} width={cellWidth} height={cellHeight} rx={DESIGN_TOKENS.radius.small} /><TextLines lines={fitTextLines(textValue(value), Math.max(2, (cellWidth - 12) / 18), 1)} x={x + cellWidth / 2} firstBaseline={y + cellHeight / 2 + 6} lineHeight={21} className="element-value" /></g>;
    })}
  </g>;
}

function ElementGlyph({ element, box, highlighted, unfocused, pointerTarget }: { element: VisualizationElement; box: ElementBox; highlighted: boolean; unfocused: boolean; pointerTarget?: VisualizationElement }) {
  const pointerBound = pointerTarget !== undefined;
  const className = `viz-element ${COMPONENT_CLASS_MAP[element.kind]} ${stateClass(element.state, highlighted)}${unfocused ? " is-unfocused" : ""}`;
  const dataProps = { "data-element-id": element.id, "data-kind": element.kind, "data-parent-id": element.parentId };
  if (["array", "queue", "timeline", "pipeline"].includes(element.kind)) return <g className={className} {...dataProps}><SequenceElement element={element} box={box} /></g>;
  if (["stack", "callStack"].includes(element.kind)) return <g className={className} {...dataProps}><SequenceElement element={element} box={box} vertical /></g>;
  if (element.kind === "memoryGrid") return <g className={className} {...dataProps}><GridElement element={element} box={box} /></g>;

  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const clipId = `element-clip-${element.id}`;
  return <g className={className} {...dataProps}>
    <defs><clipPath id={clipId}><rect x={box.x + 5} y={box.y + 5} width={Math.max(0, box.width - 10)} height={Math.max(0, box.height - 10)} rx={Math.max(0, DESIGN_TOKENS.radius.medium - 4)} /></clipPath></defs>
    {element.kind === "node" && <><ellipse className="element-shape" cx={centerX} cy={centerY} rx={box.width / 2} ry={box.height / 2} /><ellipse className="element-inner-ring" cx={centerX} cy={centerY} rx={Math.max(1, box.width / 2 - 7)} ry={Math.max(1, box.height / 2 - 7)} /></>}
    {element.kind === "circle" && <><circle className="element-shape" cx={centerX} cy={centerY} r={Math.min(box.width, box.height) / 2} /><circle className="element-inner-ring" cx={centerX} cy={centerY} r={Math.max(1, Math.min(box.width, box.height) / 2 - 7)} /></>}
    {element.kind === "diamond" && <polygon className="element-shape" points={`${centerX},${box.y} ${box.x + box.width},${centerY} ${centerX},${box.y + box.height} ${box.x},${centerY}`} />}
    {element.kind === "pointer" && <>
      {!pointerBound && <path className="pointer-indicator" d={`M ${centerX} ${box.y + 18} L ${centerX} ${box.y + 2} M ${centerX - 7} ${box.y + 9} L ${centerX} ${box.y + 2} L ${centerX + 7} ${box.y + 9}`} />}
      <rect className="element-shape pointer-shape" x={box.x} y={box.y + (pointerBound ? 0 : 16)} width={box.width} height={Math.max(1, box.height - (pointerBound ? 0 : 16))} rx={DESIGN_TOKENS.radius.medium} />
    </>}
    {!["node", "circle", "diamond", "pointer"].includes(element.kind) && <rect className="element-shape" x={box.x} y={box.y} width={box.width} height={box.height} rx={element.kind === "group" ? DESIGN_TOKENS.radius.large : DESIGN_TOKENS.radius.medium} />}
    {element.kind === "annotation" && <rect className="annotation-accent" x={box.x + 8} y={box.y + 14} width={5} height={Math.max(8, box.height - 28)} rx={3} />}
    <g clipPath={`url(#${clipId})`}>{element.kind === "pointer" ? <PointerText element={element} box={box} target={pointerTarget} /> : element.kind === "group" ? <GroupText element={element} box={box} /> : <CardText element={element} box={box} />}</g>
  </g>;
}

function contentViewBox(boxes: Map<string, ElementBox>, extras: ElementBox[] = []): { x: number; y: number; width: number; height: number } {
  if (boxes.size === 0) return { x: 0, y: 0, width: 1100, height: 640 };
  const all = [...boxes.values(), ...extras];
  const minX = Math.min(...all.map((box) => box.x));
  const minY = Math.min(...all.map((box) => box.y));
  const maxX = Math.max(...all.map((box) => box.x + box.width));
  const maxY = Math.max(...all.map((box) => box.y + box.height));
  const aspect = 1100 / 640;
  let width = Math.max(720, maxX - minX + 150);
  let height = Math.max(420, maxY - minY + 150);
  if (width / height < aspect) width = height * aspect;
  else height = width / aspect;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  };
}

function rectanglesOverlap(left: ElementBox, right: ElementBox, gap = 0): number {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x) + gap);
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y) + gap);
  return width * height;
}

function pointerTokens(value: VisualizationElement["value"]): Set<string> {
  return new Set(textValue(value).toLocaleLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(Boolean));
}

function resolvePointerTarget(pointer: VisualizationElement, elements: VisualizationElement[]): VisualizationElement | undefined {
  if (pointer.targetId) return elements.find((element) => element.id === pointer.targetId && element.visible);

  // Legacy specs sometimes encoded a pointer target only as text (for example "current → 8").
  // Recover it only when one visible element is the unique best match; ambiguous text stays unbound.
  const tokens = pointerTokens(pointer.value);
  if (tokens.size === 0) return undefined;
  const pointerText = textValue(pointer.value).toLocaleLowerCase();
  const ranked = elements
    .filter((element) => element.id !== pointer.id && element.kind !== "pointer" && element.visible)
    .map((element) => {
      let score = 0;
      if (tokens.has(element.id.toLocaleLowerCase())) score = Math.max(score, 4);
      if (!Array.isArray(element.value)) {
        const value = textValue(element.value).trim().toLocaleLowerCase();
        if (value && tokens.has(value)) score = Math.max(score, 3);
      }
      const label = element.label?.trim().toLocaleLowerCase();
      if (label && label.length >= 2 && pointerText.includes(label)) score = Math.max(score, 2);
      return { element, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);
  if (ranked.length === 0 || (ranked[1] && ranked[1].score === ranked[0]!.score)) return undefined;
  return ranked[0]!.element;
}

function indexedTargetBox(element: VisualizationElement, box: ElementBox, index: number | undefined): ElementBox {
  if (index === undefined || !Array.isArray(element.value) || index >= element.value.length) return box;
  const count = Math.max(1, element.value.length);
  if (["array", "queue", "timeline", "pipeline"].includes(element.kind)) {
    const cellWidth = Math.max(42, (box.width - 24) / count);
    return { x: box.x + 12 + index * cellWidth, y: box.y + 32, width: cellWidth, height: box.height - 44 };
  }
  if (["stack", "callStack"].includes(element.kind)) {
    const cellHeight = Math.max(38, (box.height - 44) / count);
    return { x: box.x + 12, y: box.y + 34 + (count - 1 - index) * cellHeight, width: box.width - 24, height: cellHeight };
  }
  if (element.kind === "memoryGrid") {
    const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
    const rows = Math.max(1, Math.ceil(count / columns));
    const cellWidth = (box.width - 24) / columns;
    const cellHeight = (box.height - 44) / rows;
    return { x: box.x + 12 + (index % columns) * cellWidth, y: box.y + 32 + Math.floor(index / columns) * cellHeight, width: cellWidth, height: cellHeight };
  }
  return box;
}

export function VisualizationCanvas({ spec, step, highlightedIds = [], focusedIds = [] }: VisualizationCanvasProps) {
  const materialized = useMemo(() => materializeVisualization(spec, step), [spec, step]);
  const effectiveSpec = useMemo(() => ({ ...spec, elements: materialized.elements, relations: materialized.relations }), [spec, materialized]);
  const boxes = useMemo(() => computeLayout(effectiveSpec), [effectiveSpec]);
  const highlighted = new Set([...highlightedIds, ...materialized.focusIds]);
  const focused = new Set([...focusedIds, ...materialized.focusIds]);
  const orderedElements = [...materialized.elements].sort((left, right) => Number(right.kind === "group") - Number(left.kind === "group"));
  const pointerBindings = useMemo(() => materialized.elements.flatMap((pointer) => {
    if (pointer.kind !== "pointer" || !pointer.visible) return [];
    const target = resolvePointerTarget(pointer, materialized.elements);
    const targetBox = target ? boxes.get(target.id) : undefined;
    if (!target || !targetBox) return [];
    const relation: VisualizationRelation = {
      id: `__pointer_target__${pointer.id}`,
      kind: "arrow",
      from: pointer.id,
      to: target.id,
      state: pointer.state,
      directed: true,
      visible: true,
    };
    return [{ relation, target, targetBox: indexedTargetBox(target, targetBox, pointer.targetIndex) }];
  }), [boxes, materialized.elements]);
  const pointerTargetBoxes = useMemo(() => new Map(pointerBindings.map((binding) => [binding.relation.id, binding.targetBox])), [pointerBindings]);
  const pointerRelationIds = useMemo(() => new Set(pointerBindings.map((binding) => binding.relation.id)), [pointerBindings]);
  const boundPointerTargets = useMemo(() => new Map(pointerBindings.map((binding) => [binding.relation.from, binding.target])), [pointerBindings]);
  const visibleRelations = useMemo(() => [
    ...materialized.relations.filter((relation) => relation.visible),
    ...pointerBindings.map((binding) => binding.relation),
  ], [materialized.relations, pointerBindings]);
  const relationGeometries = useMemo(() => {
    const occupiedLabels: ElementBox[] = [];
    const obstacles = materialized.elements.filter((element) => element.visible && element.kind !== "group").flatMap((element) => {
      const box = boxes.get(element.id);
      return box ? [{ id: element.id, box }] : [];
    });
    return visibleRelations.flatMap((relation) => {
      const from = boxes.get(relation.from); const to = pointerTargetBoxes.get(relation.id) ?? boxes.get(relation.to); if (!from || !to) return [];
      const start = connectorPoint(from, to); const end = connectorPoint(to, from);
      const x1 = start.x; const y1 = start.y; const x2 = end.x; const y2 = end.y;
      const pairKey = [relation.from, relation.to].sort().join("::");
      const siblings = visibleRelations.filter((candidate) => [candidate.from, candidate.to].sort().join("::") === pairKey);
      const siblingIndex = siblings.findIndex((candidate) => candidate.id === relation.id);
      const offset = (siblingIndex - (siblings.length - 1) / 2) * 200;
      const canonicalDirection = relation.from.localeCompare(relation.to) <= 0 ? 1 : -1;
      const canonicalDx = (x2 - x1) * canonicalDirection;
      const canonicalDy = (y2 - y1) * canonicalDirection;
      const length = Math.max(1, Math.hypot(canonicalDx, canonicalDy));
      const initialControlX = (x1 + x2) / 2 + (-canonicalDy / length) * offset;
      const initialControlY = (y1 + y2) / 2 + (canonicalDx / length) * offset;
      const routeDx = x2 - x1;
      const routeDy = y2 - y1;
      const routeLength = Math.max(1, Math.hypot(routeDx, routeDy));
      const routeNormal = { x: -routeDy / routeLength, y: routeDx / routeLength };
      const routeCandidates = [0, -72, 72, -128, 128, -196, 196, -280, 280, -380, 380].map((routeOffset) => {
        const candidateX = initialControlX + routeNormal.x * routeOffset;
        const candidateY = initialControlY + routeNormal.y * routeOffset;
        let crossings = 0;
        for (let sample = 1; sample < 40; sample += 1) {
          const t = sample / 40;
          const inverse = 1 - t;
          const pointX = inverse * inverse * x1 + 2 * inverse * t * candidateX + t * t * x2;
          const pointY = inverse * inverse * y1 + 2 * inverse * t * candidateY + t * t * y2;
          for (const obstacle of obstacles) {
            if (obstacle.id === relation.from || obstacle.id === relation.to) continue;
            const box = obstacle.box;
            if (pointX > box.x - 8 && pointX < box.x + box.width + 8 && pointY > box.y - 8 && pointY < box.y + box.height + 8) crossings += 1;
          }
        }
        return { x: candidateX, y: candidateY, score: crossings * 1_000_000 + Math.abs(routeOffset) };
      }).sort((left, right) => left.score - right.score);
      const selectedRoute = routeCandidates[0]!;
      const controlX = selectedRoute.x;
      const controlY = selectedRoute.y;
      const path = `M ${x1} ${y1} Q ${controlX} ${controlY} ${x2} ${y2}`;
      const baseX = 0.25 * x1 + 0.5 * controlX + 0.25 * x2;
      const baseY = 0.25 * y1 + 0.5 * controlY + 0.25 * y2 - 8;
      const labelWidth = relation.label ? Math.max(50, [...relation.label].reduce((sum, character) => sum + characterUnits(character), 0) * 9.6 + 20) : 0;
      let labelX = baseX;
      let labelY = baseY;
      let labelBox: ElementBox | undefined;

      if (relation.label) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const directLength = Math.max(1, Math.hypot(dx, dy));
        const tangent = { x: dx / directLength, y: dy / directLength };
        const normal = { x: -dy / directLength, y: dx / directLength };
        const candidates: Array<{ x: number; y: number; distance: number }> = [];
        for (const normalOffset of [0, -32, 32, -60, 60, -92, 92, -128, 128, -168, 168]) {
          for (const tangentOffset of [0, -44, 44, -88, 88]) {
            candidates.push({
              x: baseX + normal.x * normalOffset + tangent.x * tangentOffset,
              y: baseY + normal.y * normalOffset + tangent.y * tangentOffset,
              distance: Math.abs(normalOffset) + Math.abs(tangentOffset) * 1.3,
            });
          }
        }
        const ranked = candidates.map((candidate) => {
          const candidateBox = { x: candidate.x - labelWidth / 2, y: candidate.y - 17, width: labelWidth, height: 23 };
          const elementCollision = obstacles.reduce((score, obstacle) => score + rectanglesOverlap(candidateBox, obstacle.box, 8), 0);
          const labelCollision = occupiedLabels.reduce((score, occupied) => score + rectanglesOverlap(candidateBox, occupied, 10), 0);
          return { ...candidate, box: candidateBox, score: elementCollision * 1000 + labelCollision * 1000 + candidate.distance };
        }).sort((left, right) => left.score - right.score);
        const selected = ranked[0]!;
        labelX = selected.x;
        labelY = selected.y;
        labelBox = selected.box;
        occupiedLabels.push(selected.box);
      }

      const contentMinX = Math.min(x1, x2, controlX, labelBox?.x ?? Number.POSITIVE_INFINITY);
      const contentMinY = Math.min(y1, y2, controlY, labelBox?.y ?? Number.POSITIVE_INFINITY);
      const contentMaxX = Math.max(x1, x2, controlX, labelBox ? labelBox.x + labelBox.width : Number.NEGATIVE_INFINITY);
      const contentMaxY = Math.max(y1, y2, controlY, labelBox ? labelBox.y + labelBox.height : Number.NEGATIVE_INFINITY);
      return [{ relation, path, labelX, labelY, labelWidth, contentBox: { x: contentMinX, y: contentMinY, width: Math.max(1, contentMaxX - contentMinX), height: Math.max(1, contentMaxY - contentMinY) } }];
    });
  }, [boxes, materialized.elements, pointerTargetBoxes, visibleRelations]);
  const viewBox = useMemo(() => contentViewBox(boxes, relationGeometries.filter((geometry) => !pointerRelationIds.has(geometry.relation.id)).map((geometry) => geometry.contentBox)), [boxes, pointerRelationIds, relationGeometries]);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ pointerId: number; clientX: number; clientY: number; panX: number; panY: number } | null>(null);
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, [spec]);

  const viewport = useMemo(() => {
    const width = viewBox.width / zoom;
    const height = viewBox.height / zoom;
    const maxPanX = Math.max(0, (viewBox.width - width) / 2);
    const maxPanY = Math.max(0, (viewBox.height - height) / 2);
    const x = viewBox.x + (viewBox.width - width) / 2 + clamp(pan.x, -maxPanX, maxPanX);
    const y = viewBox.y + (viewBox.height - height) / 2 + clamp(pan.y, -maxPanY, maxPanY);
    return { x, y, width, height, maxPanX, maxPanY };
  }, [pan.x, pan.y, viewBox.height, viewBox.width, viewBox.x, viewBox.y, zoom]);

  const changeZoom = (nextZoom: number) => {
    const clampedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    const nextWidth = viewBox.width / clampedZoom;
    const nextHeight = viewBox.height / clampedZoom;
    const nextMaxPanX = Math.max(0, (viewBox.width - nextWidth) / 2);
    const nextMaxPanY = Math.max(0, (viewBox.height - nextHeight) / 2);
    setZoom(clampedZoom);
    setPan((current) => ({
      x: clamp(current.x, -nextMaxPanX, nextMaxPanX),
      y: clamp(current.y, -nextMaxPanY, nextMaxPanY),
    }));
  };
  const fitCanvas = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  const beginPan = (event: React.PointerEvent<SVGSVGElement>) => {
    if (zoom <= 1 || event.button !== 0) return;
    drag.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, panX: pan.x, panY: pan.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const movePan = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const dx = (event.clientX - drag.current.clientX) * viewport.width / Math.max(1, bounds.width);
    const dy = (event.clientY - drag.current.clientY) * viewport.height / Math.max(1, bounds.height);
    setPan({
      x: clamp(drag.current.panX - dx, -viewport.maxPanX, viewport.maxPanX),
      y: clamp(drag.current.panY - dy, -viewport.maxPanY, viewport.maxPanY),
    });
  };
  const endPan = (event: React.PointerEvent<SVGSVGElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return <div className="canvas-shell" data-theme-version={DESIGN_TOKENS.version} data-theme-token-hash={DESIGN_TOKEN_HASH} data-style-contract-hash={STYLE_CONTRACT_HASH}>
    {spec.parameters.length > 0 && <div className="canvas-parameters" aria-label="演示参数">
      {spec.parameters.map((parameter) => <span className="canvas-parameter" key={parameter.id}><span>{parameter.label}</span><strong>{textValue(parameter.default)}</strong></span>)}
    </div>}
    <div className="canvas-toolbar" role="group" aria-label="画布缩放">
      <button type="button" aria-label="缩小画布" title="缩小画布" onClick={() => changeZoom(zoom - ZOOM_STEP)} disabled={zoom <= MIN_ZOOM}>−</button>
      <button type="button" className="zoom-value" aria-label="适应画布" title="适应画布" onClick={fitCanvas}>{Math.round(zoom * 100)}%</button>
      <button type="button" aria-label="放大画布" title="放大画布" onClick={() => changeZoom(zoom + ZOOM_STEP)} disabled={zoom >= MAX_ZOOM}>＋</button>
    </div>
    <svg
      className={`visualization-canvas${zoom > 1 ? " is-zoomed" : ""}`}
      role="img"
      aria-label={spec.title}
      data-zoom={zoom}
      viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={beginPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
    >
      <defs>
        <marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker>
        <filter id="soft-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx={DESIGN_TOKENS.svgShadow.dark.dx} dy={DESIGN_TOKENS.svgShadow.dark.dy} stdDeviation={DESIGN_TOKENS.svgShadow.dark.stdDeviation} floodColor={DESIGN_TOKENS.svgShadow.dark.floodColor} floodOpacity={DESIGN_TOKENS.svgShadow.dark.floodOpacity} />
          <feDropShadow dx={DESIGN_TOKENS.svgShadow.light.dx} dy={DESIGN_TOKENS.svgShadow.light.dy} stdDeviation={DESIGN_TOKENS.svgShadow.light.stdDeviation} floodColor={DESIGN_TOKENS.svgShadow.light.floodColor} floodOpacity={DESIGN_TOKENS.svgShadow.light.floodOpacity} />
        </filter>
        <filter id="active-glow" x="-35%" y="-35%" width="170%" height="170%">
          <feDropShadow dx={DESIGN_TOKENS.svgShadow.dark.dx} dy={DESIGN_TOKENS.svgShadow.dark.dy} stdDeviation={DESIGN_TOKENS.svgShadow.dark.stdDeviation} floodColor={DESIGN_TOKENS.svgShadow.dark.floodColor} floodOpacity={DESIGN_TOKENS.svgShadow.dark.floodOpacity} />
          <feDropShadow dx={DESIGN_TOKENS.svgShadow.light.dx} dy={DESIGN_TOKENS.svgShadow.light.dy} stdDeviation={DESIGN_TOKENS.svgShadow.light.stdDeviation} floodColor={DESIGN_TOKENS.svgShadow.light.floodColor} floodOpacity={DESIGN_TOKENS.svgShadow.light.floodOpacity} />
          <feDropShadow dx={DESIGN_TOKENS.svgShadow.active.dx} dy={DESIGN_TOKENS.svgShadow.active.dy} stdDeviation={DESIGN_TOKENS.svgShadow.active.stdDeviation} floodColor={DESIGN_TOKENS.svgShadow.active.floodColor} floodOpacity={DESIGN_TOKENS.svgShadow.active.floodOpacity} />
        </filter>
        <pattern id="canvas-dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill={DESIGN_TOKENS.colors.border} opacity="0.16" /></pattern>
      </defs>
      <rect className="canvas-backdrop" x={viewport.x} y={viewport.y} width={viewport.width} height={viewport.height} fill="url(#canvas-dots)" />
      <g className="relations-layer">
        {relationGeometries.map(({ relation, path, labelX, labelY, labelWidth }) => {
          const unfocused = focused.size > 0 && !focused.has(relation.id) && !focused.has(relation.from) && !focused.has(relation.to);
          const pointerBinding = pointerRelationIds.has(relation.id);
          return <g key={relation.id} className={`viz-relation ${stateClass(relation.state, highlighted.has(relation.id))}${pointerBinding ? " is-pointer-binding" : ""}${unfocused ? " is-unfocused" : ""}`} data-relation-id={relation.id} data-from={relation.from} data-to={relation.to} data-pointer-binding={pointerBinding || undefined}>
            <path className="relation-path" d={path} fill="none" markerEnd={relation.directed ? "url(#arrowhead)" : undefined} />
            {relation.label && <><rect className="relation-label-bg" x={labelX - labelWidth / 2} y={labelY - 17} width={labelWidth} height={23} rx={11.5} /><text x={labelX} y={labelY} textAnchor="middle">{relation.label}</text></>}
          </g>;
        })}
      </g>
      <g className="elements-layer">
        {orderedElements.filter((element) => element.visible).map((element) => {
          const box = boxes.get(element.id); return box ? <ElementGlyph key={element.id} element={element} box={box} highlighted={highlighted.has(element.id)} unfocused={focused.size > 0 && !focused.has(element.id)} pointerTarget={boundPointerTargets.get(element.id)} /> : null;
        })}
      </g>
    </svg>
  </div>;
}
