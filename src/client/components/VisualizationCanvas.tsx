import { useMemo } from "react";
import { computeLayout, type ElementBox } from "../layout.js";
import { DESIGN_TOKEN_HASH, DESIGN_TOKENS } from "../designTokens.js";
import { materializeVisualization } from "../../shared/runtime.js";
import type { SemanticState, VisualizationElement, VisualizationSpec } from "../../shared/schema.js";

interface VisualizationCanvasProps {
  spec: VisualizationSpec;
  step: number;
  highlightedIds?: string[];
}

function stateClass(state: SemanticState, highlighted: boolean): string {
  return `state-${highlighted ? "active" : state}`;
}

function textValue(value: VisualizationElement["value"]): string {
  if (Array.isArray(value)) return value.map((item) => item === null ? "∅" : String(item)).join(", ");
  return value === null || value === undefined ? "" : String(value);
}

function CardText({ element, box }: { element: VisualizationElement; box: ElementBox }) {
  return <>
    {element.label && <text className="element-label" x={box.x + box.width / 2} y={box.y + box.height / 2 - 6} textAnchor="middle">{element.label}</text>}
    {element.value !== undefined && <text className="element-value" x={box.x + box.width / 2} y={box.y + box.height / 2 + 20} textAnchor="middle">{textValue(element.value)}</text>}
  </>;
}

function SequenceElement({ element, box, vertical = false }: { element: VisualizationElement; box: ElementBox; vertical?: boolean }) {
  const values = Array.isArray(element.value) ? element.value : [element.value ?? ""];
  const cellWidth = vertical ? box.width - 24 : Math.max(42, (box.width - 24) / Math.max(1, values.length));
  const cellHeight = vertical ? Math.max(38, (box.height - 44) / Math.max(1, values.length)) : box.height - 44;
  return <g>
    <rect className="element-shape sequence-shell" x={box.x} y={box.y} width={box.width} height={box.height} rx={DESIGN_TOKENS.radius.medium} />
    {element.label && <text className="element-label" x={box.x + 12} y={box.y + 22}>{element.label}</text>}
    {values.map((value, index) => {
      const x = vertical ? box.x + 12 : box.x + 12 + index * cellWidth;
      const y = vertical ? box.y + 34 + (values.length - 1 - index) * cellHeight : box.y + 32;
      return <g key={`${element.id}-${index}`}>
        <rect className="sequence-cell" x={x} y={y} width={cellWidth} height={cellHeight} rx={DESIGN_TOKENS.radius.small} />
        <text className="element-value" x={x + cellWidth / 2} y={y + cellHeight / 2 + 5} textAnchor="middle">{value === null ? "∅" : String(value)}</text>
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
    {element.label && <text className="element-label" x={box.x + 12} y={box.y + 22}>{element.label}</text>}
    {values.map((value, index) => {
      const x = box.x + 12 + (index % columns) * cellWidth;
      const y = box.y + 32 + Math.floor(index / columns) * cellHeight;
      return <g key={`${element.id}-${index}`}><rect className="sequence-cell" x={x} y={y} width={cellWidth} height={cellHeight} /><text className="element-value" x={x + cellWidth / 2} y={y + cellHeight / 2 + 5} textAnchor="middle">{value === null ? "∅" : String(value)}</text></g>;
    })}
  </g>;
}

function ElementGlyph({ element, box, highlighted }: { element: VisualizationElement; box: ElementBox; highlighted: boolean }) {
  const className = `viz-element kind-${element.kind} ${stateClass(element.state, highlighted)}`;
  if (["array", "queue", "timeline", "pipeline"].includes(element.kind)) return <g className={className} data-element-id={element.id} data-kind={element.kind}><SequenceElement element={element} box={box} /></g>;
  if (["stack", "callStack"].includes(element.kind)) return <g className={className} data-element-id={element.id} data-kind={element.kind}><SequenceElement element={element} box={box} vertical /></g>;
  if (element.kind === "memoryGrid") return <g className={className} data-element-id={element.id} data-kind={element.kind}><GridElement element={element} box={box} /></g>;

  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  return <g className={className} data-element-id={element.id} data-kind={element.kind}>
    {(element.kind === "node" || element.kind === "circle") && <circle className="element-shape" cx={centerX} cy={centerY} r={Math.min(box.width, box.height) / 2} />}
    {element.kind === "diamond" && <polygon className="element-shape" points={`${centerX},${box.y} ${box.x + box.width},${centerY} ${centerX},${box.y + box.height} ${box.x},${centerY}`} />}
    {element.kind === "pointer" && <path className="element-shape pointer-shape" d={`M ${centerX} ${box.y} L ${box.x + box.width} ${box.y + box.height} L ${box.x} ${box.y + box.height} Z`} />}
    {!["node", "circle", "diamond", "pointer"].includes(element.kind) && <rect className="element-shape" x={box.x} y={box.y} width={box.width} height={box.height} rx={element.kind === "group" ? DESIGN_TOKENS.radius.large : DESIGN_TOKENS.radius.medium} />}
    <CardText element={element} box={box} />
  </g>;
}

export function VisualizationCanvas({ spec, step, highlightedIds = [] }: VisualizationCanvasProps) {
  const materialized = useMemo(() => materializeVisualization(spec, step), [spec, step]);
  const effectiveSpec = useMemo(() => ({ ...spec, elements: materialized.elements, relations: materialized.relations }), [spec, materialized]);
  const boxes = useMemo(() => computeLayout(effectiveSpec), [effectiveSpec]);
  const highlighted = new Set([...highlightedIds, ...materialized.focusIds]);
  const orderedElements = [...materialized.elements].sort((left, right) => Number(right.kind === "group") - Number(left.kind === "group"));

  return <div className="canvas-shell" data-theme-version={DESIGN_TOKENS.version} data-theme-token-hash={DESIGN_TOKEN_HASH}>
    <svg className="visualization-canvas" role="img" aria-label={spec.title} viewBox="0 0 1100 640" preserveAspectRatio="xMidYMid meet">
      <defs>
        <marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker>
        <filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="5" stdDeviation="6" floodOpacity="0.12" /></filter>
      </defs>
      <g className="relations-layer">
        {materialized.relations.filter((relation) => relation.visible).map((relation) => {
          const from = boxes.get(relation.from); const to = boxes.get(relation.to); if (!from || !to) return null;
          const x1 = from.x + from.width / 2; const y1 = from.y + from.height / 2; const x2 = to.x + to.width / 2; const y2 = to.y + to.height / 2;
          return <g key={relation.id} className={`viz-relation ${stateClass(relation.state, highlighted.has(relation.id))}`} data-relation-id={relation.id}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} markerEnd={relation.directed ? "url(#arrowhead)" : undefined} />
            {relation.label && <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 8} textAnchor="middle">{relation.label}</text>}
          </g>;
        })}
      </g>
      <g className="elements-layer">
        {orderedElements.filter((element) => element.visible).map((element) => {
          const box = boxes.get(element.id); return box ? <ElementGlyph key={element.id} element={element} box={box} highlighted={highlighted.has(element.id)} /> : null;
        })}
      </g>
    </svg>
  </div>;
}
