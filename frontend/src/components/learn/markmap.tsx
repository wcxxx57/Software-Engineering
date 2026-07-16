"use client";

import { Maximize2, Minus, Plus } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Transformer } from "markmap-lib";
import { Markmap } from "markmap-view";

const transformer = new Transformer();

export function MarkmapView({ markdown }: { markdown: string }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const markmapRef = useRef<Markmap | null>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    const { root } = transformer.transform(markdown);
    const brandGold = getComputedStyle(document.documentElement)
      .getPropertyValue("--brown-gold")
      .trim();
    const mm = Markmap.create(
      svgRef.current,
      {
        zoom: true,
        pan: true,
        autoFit: true,
        fitRatio: 0.9,
        maxInitialScale: 1.2,
        color: () => brandGold || "#be8944",
      },
      root,
    );
    markmapRef.current = mm;

    return () => {
      markmapRef.current = null;
      mm.destroy();
    };
  }, [markdown]);

  const zoomIn = () => {
    void markmapRef.current?.rescale(1.25);
  };

  const zoomOut = () => {
    void markmapRef.current?.rescale(0.8);
  };

  const fit = () => {
    void markmapRef.current?.fit(1.2);
  };

  return (
    <div className="relative h-full w-full">
      <svg
        ref={svgRef}
        className="h-full w-full cursor-grab active:cursor-grabbing [&_.markmap-foreign]:!font-medium [&_.markmap-foreign]:!text-[14px] [&_.markmap-foreign]:!leading-[1.45]"
      />

      <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-xl border border-border-strong/30 bg-white/90 p-1.5 shadow-md backdrop-blur-sm">
        <MapControlButton label="放大知识导图" onClick={zoomIn}>
          <Plus />
        </MapControlButton>
        <MapControlButton label="缩小知识导图" onClick={zoomOut}>
          <Minus />
        </MapControlButton>
        <span className="mx-0.5 h-5 w-px bg-border-strong/30" aria-hidden />
        <MapControlButton label="适应画布" onClick={fit}>
          <Maximize2 />
        </MapControlButton>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-border-strong/20 bg-white/80 px-3 py-1.5 text-xs font-medium text-brand-medium shadow-sm backdrop-blur-sm">
        滚轮缩放 · 拖动画布
      </div>
    </div>
  );
}

function MapControlButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex size-9 items-center justify-center rounded-lg text-brand-dark transition-colors hover:bg-palette-yellow-light/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold [&>svg]:size-4"
    >
      {children}
    </button>
  );
}
