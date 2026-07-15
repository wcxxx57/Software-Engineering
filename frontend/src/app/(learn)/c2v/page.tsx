import { SearchCode } from "lucide-react";
import { redirect } from "next/navigation";
import { z } from "zod";

import { ToolPageShell } from "@/components/tools/tool-page-shell";
import { ToolPageClient } from "@/components/tools/tool-page-client";
import { serverFetch } from "@/lib/api/client";
import { getPublicConfig } from "@/lib/api/public-config";
import { codeVideoSchema, type CodeVideo } from "@/lib/api/schemas";
import { getSession } from "@/lib/auth/session";

import { createC2VAction, deleteC2VAction } from "./actions";

const listSchema = z.array(codeVideoSchema);

export default async function C2VPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  const [list, config] = await Promise.all([
    serverFetch<CodeVideo[]>("/code-videos", { schema: listSchema }),
    getPublicConfig(),
  ]);

  return (
    <ToolPageShell
      title="Code 2 Video"
      subtitle="你的专属算法题解视听库"
      badge={{ icon: <SearchCode className="size-4" />, label: "代码题解视频" }}
    >
      <ToolPageClient<CodeVideo>
        initialList={list}
        listEndpoint="/api/code-videos"
        createAction={createC2VAction}
        deleteAction={deleteC2VAction}
        consoleTitle="输入题目和你的解法"
        consoleMode={{
          kind: "code-pair",
          problemPlaceholder: "请粘贴题目背景、输入输出与约束条件…",
          codePlaceholder: "请粘贴可运行的核心代码…",
        }}
        currency="diamond"
        cost={config.resource.code_video_diamond_cost}
        detailKind="code-video"
        emptyHint="还没有生成过任何 C2V 视频。给 AI 一道题和你的解法，它会做成讲解短片。"
        primaryCtaLabel="在线生成"
      />
    </ToolPageShell>
  );
}
