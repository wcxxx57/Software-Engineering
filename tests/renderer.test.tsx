// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VisualizationCanvas } from "../src/client/components/VisualizationCanvas.js";
import { DESIGN_TOKEN_HASH, DESIGN_TOKENS } from "../src/client/designTokens.js";
import { bubbleSortFixture } from "../src/shared/fixtures.js";

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
});
