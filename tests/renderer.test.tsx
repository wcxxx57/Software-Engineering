// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fitTextLines, VisualizationCanvas } from "../src/client/components/VisualizationCanvas.js";
import { DESIGN_TOKEN_HASH, DESIGN_TOKENS } from "../src/client/designTokens.js";
import { connectorPoint } from "../src/client/layout.js";
import { bubbleSortFixture, componentGalleryFixture } from "../src/shared/fixtures.js";

describe("fixed SVG renderer", () => {
  it("renders fixed components with a stable theme identity", () => {
    const { container, rerender } = render(<VisualizationCanvas spec={bubbleSortFixture} step={0} />);
    expect(screen.getByRole("img", { name: "冒泡排序" })).toBeInTheDocument();
    expect(container.querySelector(".canvas-shell")).toHaveAttribute("data-theme-version", DESIGN_TOKENS.version);
    expect(container.querySelector(".canvas-shell")).toHaveAttribute("data-theme-token-hash", DESIGN_TOKEN_HASH);
    expect(container.querySelector('[data-kind="array"]')).toBeInTheDocument();
    const hashBefore = container.querySelector(".canvas-shell")?.getAttribute("data-theme-token-hash");
    rerender(<VisualizationCanvas spec={{ ...bubbleSortFixture, title: "结构改变但样式不变", elements: [...bubbleSortFixture.elements, { id: "new-node", kind: "node", label: "N", state: "normal", visible: true }] }} step={1} />);
    expect(container.querySelector(".canvas-shell")?.getAttribute("data-theme-token-hash")).toBe(hashBefore);
  });

  it("renders every gallery component and applies transient focus without changing theme", () => {
    const { container } = render(<VisualizationCanvas spec={componentGalleryFixture} step={0} focusedIds={["decision"]} />);
    for (const kind of ["group", "rect", "diamond", "circle", "annotation", "memoryGrid"]) {
      expect(container.querySelector(`[data-kind="${kind}"]`)).toBeInTheDocument();
    }
    expect(container.querySelector('[data-element-id="decision"]')).not.toHaveClass("is-unfocused");
    expect(container.querySelector('[data-element-id="guide"]')).toHaveClass("is-unfocused");
    expect(container.querySelector(".canvas-shell")).toHaveAttribute("data-theme-token-hash", DESIGN_TOKEN_HASH);
  });

  it("anchors relation endpoints on element borders rather than their centers", () => {
    const from = { x: 100, y: 100, width: 100, height: 100 };
    const to = { x: 400, y: 100, width: 100, height: 100 };
    expect(connectorPoint(from, to)).toEqual({ x: 200, y: 150 });
    expect(connectorPoint(to, from)).toEqual({ x: 400, y: 150 });
  });

  it("wraps long CJK labels without hiding content", () => {
    const lines = fitTextLines("未排序区间：索引零到索引十二", 6, 2);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.join("")).toBe("未排序区间：索引零到索引十二");
    expect(lines.join("")).not.toContain("…");
  });
});
