import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import { dehydrate, QueryClient } from "@tanstack/react-query";
import "./globals.css";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { getPublicConfig } from "@/lib/api/public-config";
import { getSession } from "@/lib/auth/session";
import { configQueryKey, meQueryKey } from "@/lib/query/keys";
import { QueryProvider } from "@/lib/query/provider";
import type { PublicConfig } from "@/lib/api/schemas";

const previewConfig: PublicConfig = {
  study_subject: { pricing: [], completion_refund_percent: 50 },
  storage: { public_base: "http://localhost", bucket: "preview" },
  resource: { knowledge_video_diamond_cost: 5, code_video_diamond_cost: 5, interactive_html_diamond_cost: 5, study_quiz_free_limit_per_task: 3, study_quiz_extra_gold_cost: 20 },
  checkin: { reward_sequence: [1], makeup_gold_cost_per_day: 50, makeup_diamond_cost: 1 },
  experience: { checkin_reward: 5, study_task_reward: 10, study_quiz_reward: 15, study_subject_reward: 200 },
};

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "智映通学",
  description: "AI 驱动的个性化学习伙伴",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const previewMode = process.env.UI_PREVIEW === "true";
  const [config, me] = previewMode
    ? [previewConfig, null]
    : await Promise.all([getPublicConfig(), getSession()]);

  const queryClient = new QueryClient();
  queryClient.setQueryData(configQueryKey, config);
  queryClient.setQueryData(meQueryKey, me);
  const dehydratedState = dehydrate(queryClient);

  return (
    <html
      lang="zh-CN"
      className={cn(
        "h-full",
        "antialiased",
        geistSans.variable,
        geistMono.variable,
        "font-sans",
        inter.variable,
      )}
    >
      <body className="min-h-full flex flex-col">
        <QueryProvider dehydratedState={dehydratedState}>
          {children}
          <Toaster />
        </QueryProvider>
      </body>
    </html>
  );
}
