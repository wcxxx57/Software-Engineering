export const DESIGN_TOKENS = Object.freeze({
  version: "education2d-warm-v1",
  colors: {
    background: "#fffaf0",
    surface: "#ffffff",
    surfaceMuted: "#f7f2e8",
    text: "#243047",
    textMuted: "#667085",
    border: "#d8d3c8",
    primary: "#3b82f6",
    visited: "#8b5cf6",
    success: "#16a34a",
    error: "#dc2626",
    muted: "#98a2b3",
    accent: "#f59e0b",
  },
  radius: { small: 8, medium: 14, large: 22 },
  stroke: { normal: 2, emphasis: 4 },
  motion: { fast: 180, normal: 360, slow: 720 },
  font: { body: "Inter, 'Microsoft YaHei', system-ui, sans-serif", code: "'JetBrains Mono', Consolas, monospace" },
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
