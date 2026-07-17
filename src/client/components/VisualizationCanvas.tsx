import { useMemo } from "react";
import { computeLayout, connectorPoint, type ElementBox } from "../layout.js";
import { COMPONENT_CLASS_MAP, DESIGN_TOKEN_HASH, DESIGN_TOKENS, SEMANTIC_STATE_CLASS_MAP, STYLE_CONTRACT_HASH } from "../designTokens.js";
import { materializeVisualization } from "../../shared/runtime.js";
import type { SemanticState, VisualizationElement, VisualizationSpec } from "../../shared/schema.js";

interface VisualizationCanvasProps {
  spec: VisualizationSpec;
  step: number;
  highlightedIds?: string[];
  focusedIds?: string[];
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

function PointerText({ element, box }: { element: VisualizationElement; box: ElementBox }) {
  const centerX = box.x + box.width / 2;
  const label = element.label ? fitTextLines(element.label, Math.max(4, (box.width - 18) / 15), 1) : [];
  const value = element.value !== undefined ? fitTextLines(textValue(element.value), Math.max(3, (box.width - 18) / 18), 1) : [];
  return <>
    {label.length > 0 && <TextLines lines={label} x={centerX} firstBaseline={box.y + 36} lineHeight={18} className="element-label" />}
    {value.length > 0 && <TextLines lines={value} x={centerX} firstBaseline={box.y + 54} lineHeight={21} className="element-value" />}
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

function ElementGlyph({ element, box, highlighted, unfocused }: { element: VisualizationElement; box: ElementBox; highlighted: boolean; unfocused: boolean }) {
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
      <path className="pointer-indicator" d={`M ${centerX} ${box.y + 18} L ${centerX} ${box.y + 2} M ${centerX - 7} ${box.y + 9} L ${centerX} ${box.y + 2} L ${centerX + 7} ${box.y + 9}`} />
      <rect className="element-shape pointer-shape" x={box.x} y={box.y + 16} width={box.width} height={Math.max(1, box.height - 16)} rx={DESIGN_TOKENS.radius.medium} />
    </>}
    {!["node", "circle", "diamond", "pointer"].includes(element.kind) && <rect className="element-shape" x={box.x} y={box.y} width={box.width} height={box.height} rx={element.kind === "group" ? DESIGN_TOKENS.radius.large : DESIGN_TOKENS.radius.medium} />}
    {element.kind === "annotation" && <rect className="annotation-accent" x={box.x + 8} y={box.y + 14} width={5} height={Math.max(8, box.height - 28)} rx={3} />}
    <g clipPath={`url(#${clipId})`}>{element.kind === "pointer" ? <PointerText element={element} box={box} /> : element.kind === "group" ? <GroupText element={element} box={box} /> : <CardText element={element} box={box} />}</g>
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

export function VisualizationCanvas({ spec, step, highlightedIds = [], focusedIds = [] }: VisualizationCanvasProps) {
  const materialized = useMemo(() => materializeVisualization(spec, step), [spec, step]);
  const effectiveSpec = useMemo(() => ({ ...spec, elements: materialized.elements, relations: materialized.relations }), [spec, materialized]);
  const boxes = useMemo(() => computeLayout(effectiveSpec), [effectiveSpec]);
  const highlighted = new Set([...highlightedIds, ...materialized.focusIds]);
  const focused = new Set([...focusedIds, ...materialized.focusIds]);
  const orderedElements = [...materialized.elements].sort((left, right) => Number(right.kind === "group") - Number(left.kind === "group"));
  const visibleRelations = materialized.relations.filter((relation) => relation.visible);
  const relationGeometries = useMemo(() => {
    const occupiedLabels: ElementBox[] = [];
    const obstacles = materialized.elements.filter((element) => element.visible && element.kind !== "group").flatMap((element) => {
      const box = boxes.get(element.id);
      return box ? [{ id: element.id, box }] : [];
    });
    return visibleRelations.flatMap((relation) => {
      const from = boxes.get(relation.from); const to = boxes.get(relation.to); if (!from || !to) return [];
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
  }, [boxes, materialized.elements, visibleRelations]);
  const viewBox = useMemo(() => contentViewBox(boxes, relationGeometries.map((geometry) => geometry.contentBox)), [boxes, relationGeometries]);

  return <div className="canvas-shell" data-theme-version={DESIGN_TOKENS.version} data-theme-token-hash={DESIGN_TOKEN_HASH} data-style-contract-hash={STYLE_CONTRACT_HASH}>
    <svg className="visualization-canvas" role="img" aria-label={spec.title} viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker>
        <filter id="soft-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx={DESIGN_TOKENS.svgShadow.dark.dx} dy={DESIGN_TOKENS.svgShadow.dark.dy} stdDeviation={DESIGN_TOKENS.svgShadow.dark.stdDeviation} floodColor={DESIGN_TOKENS.svgShadow.dark.floodColor} floodOpacity={DESIGN_TOKENS.svgShadow.dark.floodOpacity} />
          <feDropShadow dx={DESIGN_TOKENS.svgShadow.light.dx} dy={DESIGN_TOKENS.svgShadow.light.dy} stdDeviation={DESIGN_TOKENS.svgShadow.light.stdDeviation} floodColor={DESIGN_TOKENS.svgShadow.light.floodColor} floodOpacity={DESIGN_TOKENS.svgShadow.light.floodOpacity} />
        </filter>
        <pattern id="canvas-dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill={DESIGN_TOKENS.colors.border} opacity="0.16" /></pattern>
      </defs>
      <rect className="canvas-backdrop" x={viewBox.x} y={viewBox.y} width={viewBox.width} height={viewBox.height} fill="url(#canvas-dots)" />
      <g className="relations-layer">
        {relationGeometries.map(({ relation, path, labelX, labelY, labelWidth }) => {
          const unfocused = focused.size > 0 && !focused.has(relation.id) && !focused.has(relation.from) && !focused.has(relation.to);
          return <g key={relation.id} className={`viz-relation ${stateClass(relation.state, highlighted.has(relation.id))}${unfocused ? " is-unfocused" : ""}`} data-relation-id={relation.id} data-from={relation.from} data-to={relation.to}>
            <path className="relation-path" d={path} fill="none" markerEnd={relation.directed ? "url(#arrowhead)" : undefined} />
            {relation.label && <><rect className="relation-label-bg" x={labelX - labelWidth / 2} y={labelY - 17} width={labelWidth} height={23} rx={11.5} /><text x={labelX} y={labelY} textAnchor="middle">{relation.label}</text></>}
          </g>;
        })}
      </g>
      <g className="elements-layer">
        {orderedElements.filter((element) => element.visible).map((element) => {
          const box = boxes.get(element.id); return box ? <ElementGlyph key={element.id} element={element} box={box} highlighted={highlighted.has(element.id)} unfocused={focused.size > 0 && !focused.has(element.id)} /> : null;
        })}
      </g>
    </svg>
  </div>;
}
