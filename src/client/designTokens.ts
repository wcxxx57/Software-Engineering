import type { ElementKind, SemanticState } from "../shared/schema.js";

export const DESIGN_TOKENS = Object.freeze({
  version: "n2w-education2d-v10",
  colors: {
    background: "#fffdf4",
    surface: "#fffdf4",
    surfaceMuted: "#fff6db",
    text: "#2c1608",
    textMuted: "#8b6347",
    border: "#c4a882",
    primary: "#be8944",
    yellow: "#d4a017",
    active: "#8fc9e3",
    visited: "#d1c1e0",
    success: "#9fd8c8",
    error: "#ef3f46",
    muted: "#8b6347",
    accent: "#fdbc97",
    primarySurface: "#fff6db",
    yellowSurface: "#fff6db",
    activeSurface: "#eaf7ff",
    visitedSurface: "#f6f2fa",
    successSurface: "#eaf8f3",
    errorSurface: "#fff0f1",
    accentSurface: "#f9ebe4",
    primaryText: "#fffdf4",
    brandText: "#7a4b1f",
    statusSuccessText: "#356f60",
    statusSuccessSurface: "#d1eee5",
    codeLineNumber: "#b29172",
    progressTrack: "#eadfcf",
    messageSurface: "#fffbED",
    focusRing: "rgba(190, 137, 68, 0.2)",
    panelBorder: "rgba(196, 168, 130, 0.52)",
    panelSurface: "rgba(255, 253, 244, 0.94)",
    headerSurface: "rgba(255, 253, 244, 0.94)",
    panelShadow: "rgba(89, 57, 31, 0.13)",
    canvasShadow: "rgba(89, 57, 31, 0.09)",
    accentGlow: "rgba(252, 172, 125, 0.24)",
    spinnerTrack: "#eadfcf",
  },
  radius: { small: 8, medium: 14, large: 22 },
  stroke: { normal: 1.5, emphasis: 2.5, relation: 2, relationEmphasis: 3.5, cell: 1.25 },
  motion: { fast: 180, normal: 360, slow: 720 },
  font: { body: "Inter, 'Microsoft YaHei', system-ui, sans-serif", code: "'JetBrains Mono', Consolas, monospace" },
  shadow: {
    panel: "8px 8px 16px rgba(219, 199, 168, 0.4), -8px -8px 16px rgba(255, 255, 255, 0.9)",
    canvas: "6px 6px 12px rgba(219, 199, 168, 0.3), -6px -6px 12px rgba(255, 255, 255, 0.8)",
  },
  svgShadow: {
    dark: { dx: 5, dy: 5, stdDeviation: 5, floodColor: "#d8c4a5", floodOpacity: 0.28 },
    light: { dx: -4, dy: -4, stdDeviation: 5, floodColor: "#ffffff", floodOpacity: 0.82 },
  },
});

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export const DESIGN_TOKEN_HASH = fnv1a(stableStringify(DESIGN_TOKENS));

export const COMPONENT_CLASS_MAP: Readonly<Record<ElementKind, string>> = Object.freeze({
  array: "kind-array",
  node: "kind-node",
  pointer: "kind-pointer",
  stack: "kind-stack",
  queue: "kind-queue",
  callStack: "kind-callStack",
  memoryGrid: "kind-memoryGrid",
  timeline: "kind-timeline",
  pipeline: "kind-pipeline",
  group: "kind-group",
  annotation: "kind-annotation",
  rect: "kind-rect",
  circle: "kind-circle",
  diamond: "kind-diamond",
});

export const SEMANTIC_STATE_CLASS_MAP: Readonly<Record<SemanticState, string>> = Object.freeze({
  normal: "state-normal",
  active: "state-active",
  visited: "state-visited",
  success: "state-success",
  error: "state-error",
  muted: "state-muted",
});

export const STYLE_CONTRACT_HASH = fnv1a(stableStringify({
  tokens: DESIGN_TOKENS,
  componentClasses: COMPONENT_CLASS_MAP,
  semanticStateClasses: SEMANTIC_STATE_CLASS_MAP,
  rendererClasses: ["viz-element", "viz-relation", "element-shape", "element-label", "element-value", "sequence-cell"],
}));

export const DESIGN_CSS_VARIABLES: Readonly<Record<string, string>> = Object.freeze({
  "--theme-bg": DESIGN_TOKENS.colors.background,
  "--theme-surface": DESIGN_TOKENS.colors.surface,
  "--theme-surface-muted": DESIGN_TOKENS.colors.surfaceMuted,
  "--theme-text": DESIGN_TOKENS.colors.text,
  "--theme-text-muted": DESIGN_TOKENS.colors.textMuted,
  "--theme-border": DESIGN_TOKENS.colors.border,
  "--theme-primary": DESIGN_TOKENS.colors.primary,
  "--theme-yellow": DESIGN_TOKENS.colors.yellow,
  "--theme-active": DESIGN_TOKENS.colors.active,
  "--theme-visited": DESIGN_TOKENS.colors.visited,
  "--theme-success": DESIGN_TOKENS.colors.success,
  "--theme-error": DESIGN_TOKENS.colors.error,
  "--theme-muted": DESIGN_TOKENS.colors.muted,
  "--theme-accent": DESIGN_TOKENS.colors.accent,
  "--theme-primary-surface": DESIGN_TOKENS.colors.primarySurface,
  "--theme-yellow-surface": DESIGN_TOKENS.colors.yellowSurface,
  "--theme-active-surface": DESIGN_TOKENS.colors.activeSurface,
  "--theme-visited-surface": DESIGN_TOKENS.colors.visitedSurface,
  "--theme-success-surface": DESIGN_TOKENS.colors.successSurface,
  "--theme-error-surface": DESIGN_TOKENS.colors.errorSurface,
  "--theme-accent-surface": DESIGN_TOKENS.colors.accentSurface,
  "--theme-primary-text": DESIGN_TOKENS.colors.primaryText,
  "--theme-brand-text": DESIGN_TOKENS.colors.brandText,
  "--theme-status-success-text": DESIGN_TOKENS.colors.statusSuccessText,
  "--theme-status-success-surface": DESIGN_TOKENS.colors.statusSuccessSurface,
  "--theme-code-line-number": DESIGN_TOKENS.colors.codeLineNumber,
  "--theme-progress-track": DESIGN_TOKENS.colors.progressTrack,
  "--theme-message-surface": DESIGN_TOKENS.colors.messageSurface,
  "--theme-focus-ring": DESIGN_TOKENS.colors.focusRing,
  "--theme-panel-border": DESIGN_TOKENS.colors.panelBorder,
  "--theme-panel-surface": DESIGN_TOKENS.colors.panelSurface,
  "--theme-header-surface": DESIGN_TOKENS.colors.headerSurface,
  "--theme-accent-glow": DESIGN_TOKENS.colors.accentGlow,
  "--theme-spinner-track": DESIGN_TOKENS.colors.spinnerTrack,
  "--radius-sm": `${DESIGN_TOKENS.radius.small}px`,
  "--radius-md": `${DESIGN_TOKENS.radius.medium}px`,
  "--radius-lg": `${DESIGN_TOKENS.radius.large}px`,
  "--stroke-normal": String(DESIGN_TOKENS.stroke.normal),
  "--stroke-emphasis": String(DESIGN_TOKENS.stroke.emphasis),
  "--stroke-relation": String(DESIGN_TOKENS.stroke.relation),
  "--stroke-relation-emphasis": String(DESIGN_TOKENS.stroke.relationEmphasis),
  "--stroke-cell": String(DESIGN_TOKENS.stroke.cell),
  "--motion-fast": `${DESIGN_TOKENS.motion.fast}ms`,
  "--motion-normal": `${DESIGN_TOKENS.motion.normal}ms`,
  "--motion-slow": `${DESIGN_TOKENS.motion.slow}ms`,
  "--font-body": DESIGN_TOKENS.font.body,
  "--font-code": DESIGN_TOKENS.font.code,
  "--shadow-panel": DESIGN_TOKENS.shadow.panel,
  "--shadow-canvas": DESIGN_TOKENS.shadow.canvas,
});

export function applyDesignTokens(root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(DESIGN_CSS_VARIABLES)) root.style.setProperty(name, value);
}
