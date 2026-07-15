"use client";

import {
  BookOpen,
  CalendarCheck,
  Coins,
  Crown,
  Gem,
  Gift,
  GraduationCap,
  Lightbulb,
  ListChecks,
  ShieldCheck,
  Sparkles,
  Trophy,
  Wand2,
  Zap,
} from "lucide-react";
import type { ComponentType, ReactNode, SVGProps } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConfig } from "@/lib/query/config";

type TabKey = "gold" | "diamond" | "exp";

type IconCmp = ComponentType<SVGProps<SVGSVGElement>>;

export function HandbookDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const config = useConfig();
  const seq = config.checkin.reward_sequence;
  const stableDailyGold = seq.length > 0 ? seq[seq.length - 1] : 0;
  const weeklyMaxGold = seq.reduce((acc, value) => acc + value, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
        <div className="h-1 w-full bg-gradient-to-r from-palette-orange via-palette-yellow to-palette-blue-light" />
        <div className="max-h-[80vh] overflow-y-auto px-7 pt-6 pb-7">
          <DialogHeader className="items-start text-left">
            <div className="mb-2 flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-palette-yellow-light to-palette-orange-lighter text-palette-orange shadow-[0_4px_12px_color-mix(in_oklch,var(--palette-orange)_18%,transparent)]">
                <BookOpen className="size-6" strokeWidth={1.8} />
              </div>
              <div>
                <DialogTitle className="bg-gradient-to-br from-brand-dark via-palette-orange to-brand-gold bg-clip-text text-xl font-extrabold text-transparent">
                  新手图鉴
                </DialogTitle>
                <DialogDescription className="text-xs text-brand-medium">
                  了解平台经济与成长体系，少走弯路
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <Tabs defaultValue={"gold" satisfies TabKey} className="mt-4 gap-4">
            <TabsList variant="line" className="gap-2">
              <TabHeader value="gold" Icon={Coins} label="金币" />
              <TabHeader value="diamond" Icon={Gem} label="钻石" />
              <TabHeader value="exp" Icon={ShieldCheck} label="经验" />
            </TabsList>

            <TabsContent value="gold" className="flex flex-col gap-3">
              <Section
                tone="yellow"
                Icon={Gift}
                title="获取方式"
              >
                <Bullet>
                  <strong>日常签到</strong>：连续签到奖励按
                  {" "}
                  <code className="rounded bg-palette-yellow-mist/70 px-1.5 py-0.5 text-[12px] font-bold text-palette-orange">
                    {seq.join(" → ")}
                  </code>
                  {" "}金币递增，稳定后每天 <strong>{stableDailyGold} 金币</strong>。
                </Bullet>
                <Bullet>
                  <strong>满签彩蛋</strong>：理论上一周连续签到最多可累计{" "}
                  <strong>{weeklyMaxGold} 金币</strong>。
                </Bullet>
                <Tip>
                  <Lightbulb className="size-3.5 shrink-0 text-palette-orange" strokeWidth={2.4} />
                  漏签会从首日重新累计；想避免连续被打断，可使用钻石购买补救卡。
                </Tip>
              </Section>

              <Section tone="orange" Icon={Wand2} title="消耗方式">
                <Bullet>
                  <strong>交互式 HTML 实验室</strong>：每次生成消耗{" "}
                  <strong>{config.resource.interactive_html_gold_cost} 金币</strong>。
                </Bullet>
                <Bullet>
                  <strong>额外知识点小测</strong>：每个任务前{" "}
                  <strong>{config.resource.study_quiz_free_limit_per_task} 轮免费</strong>，
                  之后每轮 <strong>{config.resource.study_quiz_extra_gold_cost} 金币</strong>。
                </Bullet>
                <Bullet>
                  <strong>断签补救卡</strong>：每漏 1 天扣{" "}
                  <strong>{config.checkin.makeup_gold_cost_per_day} 金币</strong>
                  ，并附加 <strong>{config.checkin.makeup_diamond_cost} 钻石</strong> 的成本。
                </Bullet>
              </Section>
            </TabsContent>

            <TabsContent value="diamond" className="flex flex-col gap-3">
              <Section tone="blue" Icon={Sparkles} title="获取方式">
                <Bullet>
                  <strong>完课对赌</strong>：开通学习计划时按阶段数预扣钻石，全勤完成可获返还。
                </Bullet>
                <Bullet>
                  <strong>充值氪金</strong>：商店上线后可直接购买（暂未开放）。
                </Bullet>
              </Section>

              <Section tone="yellow" Icon={ListChecks} title="对赌定价表">
                <div className="overflow-hidden rounded-xl border border-border/30">
                  <table className="w-full border-collapse text-xs">
                    <thead className="bg-palette-yellow-mist/60">
                      <tr className="text-brand-dark">
                        <Th align="left">阶段数</Th>
                        <Th>预扣钻石</Th>
                        <Th>实际净消耗（参考 50% 返还）</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {config.study_subject.pricing.map((row) => (
                        <tr
                          key={row.total_stages}
                          className="border-t border-border/15 last:border-b-0"
                        >
                          <Td align="left" className="font-semibold">
                            {row.total_stages} 阶段
                          </Td>
                          <Td className="font-bold text-palette-blue">
                            {row.diamond_cost}
                          </Td>
                          <Td className="text-brand-medium">
                            约 {Math.round(row.diamond_cost / 2)}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>

              <Section tone="orange" Icon={Zap} title="算力消耗">
                <Bullet>
                  <strong>K2V 知识点视频</strong>：
                  <strong>{config.resource.knowledge_video_diamond_cost} 钻石/次</strong>
                  ，生成失败自动退还。
                </Bullet>
                <Bullet>
                  <strong>C2V 代码讲解视频</strong>：
                  <strong>{config.resource.code_video_diamond_cost} 钻石/次</strong>
                  ，同失败退款。
                </Bullet>
              </Section>
            </TabsContent>

            <TabsContent value="exp" className="flex flex-col gap-3">
              <Section tone="green" Icon={CalendarCheck} title="经验值获取途径">
                <Bullet>
                  <strong>日常签到</strong>：每日 <strong>+5 EXP</strong>。
                </Bullet>
                <Bullet>
                  <strong>学完一个学习任务</strong>：
                  <strong>+10 EXP</strong>。
                </Bullet>
                <Bullet>
                  <strong>完成一轮知识点小测</strong>：
                  <strong>+15 EXP</strong>。
                </Bullet>
                <Bullet>
                  <strong>完成完整学习计划</strong>：
                  <strong>+200 EXP</strong>。
                </Bullet>
                <Tip>
                  <Lightbulb className="size-3.5 shrink-0 text-palette-orange" strokeWidth={2.4} />
                  等级公式：<code className="rounded bg-palette-yellow-mist/70 px-1.5 py-0.5 text-[12px] font-bold text-palette-orange">Lv = ⌊√(EXP / 100)⌋</code>
                  ，越往后所需经验越多。
                </Tip>
              </Section>

              <Section tone="yellow" Icon={Trophy} title="阶梯等级速览">
                <div className="overflow-hidden rounded-xl border border-border/30">
                  <table className="w-full border-collapse text-xs">
                    <thead className="bg-palette-yellow-mist/60">
                      <tr className="text-brand-dark">
                        <Th align="left">等级</Th>
                        <Th align="left">称号</Th>
                        <Th>所需 EXP</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {LEVEL_TABLE.map((row) => (
                        <tr
                          key={row.level}
                          className="border-t border-border/15 last:border-b-0"
                        >
                          <Td align="left" className="font-bold">
                            <span className="inline-flex items-center gap-1.5">
                              <Crown className="size-3.5 text-palette-orange" strokeWidth={2.4} />
                              Lv.{row.level}
                            </span>
                          </Td>
                          <Td align="left" className="font-semibold">
                            {row.title}
                          </Td>
                          <Td className="font-bold text-palette-blue">
                            {row.exp.toLocaleString()}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>

              <Section tone="green" Icon={GraduationCap} title="后续福利（即将上线）">
                <Bullet>专属昵称色、头像框与气泡。</Bullet>
                <Bullet>高等级享受生成折扣、AI 伴学额度提升。</Bullet>
              </Section>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TabHeader({
  value,
  Icon,
  label,
}: {
  value: TabKey;
  Icon: IconCmp;
  label: string;
}) {
  return (
    <TabsTrigger
      value={value}
      className="rounded-full bg-palette-yellow-mist/60 px-4 text-brand-medium data-active:bg-gradient-to-br data-active:from-palette-yellow-lighter data-active:to-palette-yellow-light data-active:text-brand-dark"
    >
      <Icon className="size-4" strokeWidth={2.4} />
      {label}
    </TabsTrigger>
  );
}

const SECTION_TONES = {
  yellow:
    "bg-palette-yellow-mist/60 border-palette-yellow/30",
  orange:
    "bg-palette-orange-mist/60 border-palette-orange-light/30",
  blue:
    "bg-palette-blue-mist/70 border-palette-blue-light/30",
  green:
    "bg-palette-green-mist/70 border-palette-green/30",
} as const;

function Section({
  tone,
  Icon,
  title,
  children,
}: {
  tone: keyof typeof SECTION_TONES;
  Icon: IconCmp;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-2xl border px-4 py-3.5 ${SECTION_TONES[tone]}`}>
      <div className="mb-2 flex items-center gap-2 text-sm font-extrabold text-brand-dark">
        <Icon className="size-4 text-palette-orange" strokeWidth={2.2} />
        {title}
      </div>
      <div className="flex flex-col gap-1.5 text-[13px] leading-relaxed text-brand-medium">
        {children}
      </div>
    </div>
  );
}

function Bullet({ children }: { children: ReactNode }) {
  return (
    <p className="pl-2">
      <span className="mr-1 text-palette-orange">•</span>
      {children}
    </p>
  );
}

function Tip({ children }: { children: ReactNode }) {
  return (
    <div className="mt-1 inline-flex items-start gap-1.5 rounded-xl bg-white/60 px-3 py-2 text-[12px] font-medium text-brand-medium">
      {children}
    </div>
  );
}

function Th({
  children,
  align = "center",
}: {
  children: ReactNode;
  align?: "left" | "center";
}) {
  return (
    <th
      className={`px-3 py-2 text-[11px] font-extrabold ${align === "left" ? "text-left" : "text-center"}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "center",
  className = "",
}: {
  children: ReactNode;
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <td
      className={`px-3 py-2 ${align === "left" ? "text-left" : "text-center"} ${className}`}
    >
      {children}
    </td>
  );
}

const LEVEL_TABLE = [
  { level: 1, title: "脚本学徒", exp: 100 },
  { level: 2, title: "代码极客", exp: 400 },
  { level: 3, title: "架构骑士", exp: 900 },
  { level: 4, title: "算力领主", exp: 1600 },
  { level: 5, title: "矩阵先知", exp: 2500 },
  { level: 6, title: "硅基神明", exp: 10000 },
];
