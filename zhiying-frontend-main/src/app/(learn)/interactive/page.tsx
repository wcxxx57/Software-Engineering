import { Box, FlaskConical } from "lucide-react";
import { redirect } from "next/navigation";
import { z } from "zod";

import { ToolPageShell } from "@/components/tools/tool-page-shell";
import { ToolPageClient } from "@/components/tools/tool-page-client";
import { serverFetch } from "@/lib/api/client";
import { getPublicConfig } from "@/lib/api/public-config";
import {
  interactiveHtmlSchema,
  type InteractiveHtml,
} from "@/lib/api/schemas";
import { getSession } from "@/lib/auth/session";

import { createInteractiveAction, deleteInteractiveAction } from "./actions";

const listSchema = z.array(interactiveHtmlSchema);

export default async function InteractivePage() {
  const user = await getSession();
  if (!user) redirect("/login");

  const [list, config] = await Promise.all([
    serverFetch<InteractiveHtml[]>("/interactive-htmls", {
      schema: listSchema,
    }),
    getPublicConfig(),
  ]);

  return (
    <ToolPageShell
      title="Interactive Lab"
      subtitle="把抽象概念变成可玩的沙盒，AI 即刻为你搭建演示页面"
      badge={{ icon: <FlaskConical className="size-4" />, label: "交互式实验室" }}
    >
      <ToolPageClient<InteractiveHtml>
        initialList={list}
        listEndpoint="/api/interactive-htmls"
        createAction={createInteractiveAction}
        deleteAction={deleteInteractiveAction}
        consoleTitle="输入你想要交互的知识点"
        consoleMode={{
          kind: "single",
          placeholder:
            "例如：可视化汉诺塔的递归调用过程，允许用户调节盘数与速度。",
        }}
        currency="gold"
        cost={config.resource.interactive_html_gold_cost}
        detailKind="interactive-html"
        cardThumbnailIcon={<Box strokeWidth={1.75} />}
        emptyHint="还没有生成过任何交互式实验。让 AI 把抽象的概念变成可玩的沙盒。"
        primaryCtaLabel="在线生成"
      />
    </ToolPageShell>
  );
}
