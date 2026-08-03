import { notFound } from "next/navigation";

import { Iteration4ToolPreview } from "@/components/preview/iteration4-tool-preview";

export default async function Iteration4ToolsPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; empty?: string }>;
}) {
  if (process.env.UI_PREVIEW !== "true") notFound();
  const { type, empty } = await searchParams;
  const kind = type === "c2v" || type === "interactive" ? type : "k2v";
  return <Iteration4ToolPreview kind={kind} empty={empty === "1"} />;
}
