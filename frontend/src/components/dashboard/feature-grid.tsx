import { BookmarkCheck, Clapperboard, FlaskConical, SearchCode } from "lucide-react";
import Link from "next/link";
import type { ComponentType, SVGProps } from "react";

type Feature = {
  id: string;
  title: string;
  desc: string;
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  cardClass: string;
  iconClass: string;
};

const FEATURES: Feature[] = [
  {
    id: "k2v",
    title: "K2V 知识点视频生成",
    desc: "将枯燥知识点一键转化为活泼的精美解说视频",
    href: "/k2v",
    icon: Clapperboard,
    cardClass: "bg-palette-yellow-lighter",
    iconClass: "text-palette-yellow",
  },
  {
    id: "c2v",
    title: "C2V 编程题目解说",
    desc: "由编程题目和答案自动生成易懂的逻辑讲解视频",
    href: "/c2v",
    icon: SearchCode,
    cardClass: "bg-palette-orange-lighter",
    iconClass: "text-palette-orange",
  },
  {
    id: "interactive",
    title: "交互式实验室",
    desc: "AI 生成可交互的演示页面，动手探索算法、数据结构与可视化",
    href: "/interactive",
    icon: FlaskConical,
    cardClass: "bg-palette-blue-mist",
    iconClass: "text-palette-blue",
  },
  {
    id: "mistakes",
    title: "错题本/收藏夹",
    desc: "智能收集错题与收藏题目，精准定位薄弱环节",
    href: "/mistakes",
    icon: BookmarkCheck,
    cardClass: "bg-palette-purple-lighter",
    iconClass: "text-palette-purple",
  },
];

export function FeatureGrid() {
  return (
    <section className="mx-auto w-full max-w-[900px]">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {FEATURES.map((f) => (
          <FeatureCard key={f.id} feature={f} />
        ))}
      </div>
    </section>
  );
}

function FeatureCard({ feature }: { feature: Feature }) {
  const Icon = feature.icon;

  return (
    <Link
      href={feature.href}
      className={`group flex min-h-[230px] flex-col gap-2 rounded-3xl p-6 shadow-[var(--shadow-soft)] transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[var(--shadow-hover,0_12px_24px_rgba(0,0,0,0.08))] ${feature.cardClass}`}
    >
      <div className="flex size-14 items-center justify-center rounded-2xl border-2 border-white/60 bg-canvas shadow-[var(--shadow-soft)]">
        <Icon className={`size-7 ${feature.iconClass}`} strokeWidth={2.2} />
      </div>
      <div className="mt-2 flex flex-1 flex-col gap-2">
        <h3 className="text-lg font-extrabold text-brand-dark">
          {feature.title}
        </h3>
        <p className="text-sm leading-relaxed font-medium text-brand-medium">
          {feature.desc}
        </p>
      </div>
    </Link>
  );
}
