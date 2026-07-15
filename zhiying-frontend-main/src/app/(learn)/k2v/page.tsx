import { Clapperboard } from "lucide-react";
import { redirect } from "next/navigation";
import { z } from "zod";

import { ToolPageShell } from "@/components/tools/tool-page-shell";
import { ToolPageClient } from "@/components/tools/tool-page-client";
import { serverFetch } from "@/lib/api/client";
import { getPublicConfig } from "@/lib/api/public-config";
import { knowledgeVideoSchema, type KnowledgeVideo } from "@/lib/api/schemas";
import { getSession } from "@/lib/auth/session";

import { createK2VAction, deleteK2VAction } from "./actions";

const listSchema = z.array(knowledgeVideoSchema);

export default async function K2VPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  const [list, config] = await Promise.all([
    serverFetch<KnowledgeVideo[]>("/knowledge-videos", { schema: listSchema }),
    getPublicConfig(),
  ]);

  return (
    <ToolPageShell
      title="Knowledge 2 Video"
      subtitle="你的专属 AIGC 视频知识库"
      badge={{ icon: <Clapperboard className="size-4" />, label: "知识点视频" }}
    >
      <ToolPageClient<KnowledgeVideo>
        initialList={list}
        listEndpoint="/api/knowledge-videos"
        createAction={createK2VAction}
        deleteAction={deleteK2VAction}
        consoleTitle="输入你需要讲解的知识点"
        consoleMode={{
          kind: "single",
          placeholder:
            "例如：请用生动的比喻讲解什么是 Python 的闭包函数，并结合简单的代码案例。最好在讲解的时候附带动画效果辅助理解…",
        }}
        currency="diamond"
        cost={config.resource.knowledge_video_diamond_cost}
        detailKind="knowledge-video"
        emptyHint="还没有创建过任何 K2V 视频。给 AI 一个知识点，让它给你拍一支讲解短片。"
        primaryCtaLabel="在线生成"
      />
    </ToolPageShell>
  );
}
