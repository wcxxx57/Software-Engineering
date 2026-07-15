"use client";

import { useState, useTransition } from "react";
import { BookOpen, Coins, Crown, Flame, Gem, GraduationCap, LogOut, Pencil } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { logoutAction } from "@/app/(app)/dashboard/actions";
import { CheckinButton } from "@/components/dashboard/checkin-button";
import { HandbookDialog } from "@/components/dashboard/handbook-dialog";
import { ProfileEditDialog } from "@/components/dashboard/profile-edit-dialog";
import { AiChatPanel } from "@/components/panels/ai-chat-panel";
import type { User } from "@/lib/api/schemas";

function levelFromExp(exp: number) {
  return Math.floor(Math.sqrt(exp / 100));
}

export function DashboardAside({
  user,
  checkedToday,
}: {
  user: User;
  checkedToday: boolean;
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [handbookOpen, setHandbookOpen] = useState(false);
  const [, startLogout] = useTransition();
  const queryClient = useQueryClient();
  const level = levelFromExp(user.exp);
  const needsProfile = user.birth_year === null;

  const handleLogout = () => {
    startLogout(async () => {
      // server action 清 cookie 并 redirect 到 /login；
      // 客户端这里同步把 me / config 等所有 cache 清干净，
      // 避免登出后被新登录用户看到上一个账号的缓存。
      queryClient.clear();
      await logoutAction();
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="relative flex shrink-0 flex-col items-center border-b border-dashed border-border/30 px-6 pt-8 pb-6">
        <div className="absolute inset-x-0 top-0 h-[100px] bg-gradient-to-b from-palette-orange-light/50 to-transparent" />

        {needsProfile && (
          <button
            type="button"
            onClick={() => setProfileOpen(true)}
            className="relative z-10 mb-4 flex w-full items-center justify-between rounded-xl border border-dashed border-palette-orange-light bg-white/80 px-3 py-2 shadow-[0_2px_4px_color-mix(in_oklch,var(--palette-orange)_10%,transparent)]"
          >
            <div className="flex items-center gap-2">
              <Pencil className="size-3.5 text-palette-orange" strokeWidth={2.2} />
              <span className="text-xs font-semibold text-brand-dark">
                完善个人信息
              </span>
            </div>
            <span className="text-xs font-extrabold text-brand-gold">
              去完善 ›
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setProfileOpen(true)}
          className="relative z-10 mb-4 flex size-[84px] cursor-pointer items-center justify-center rounded-[28px] bg-canvas shadow-[0_8px_16px_color-mix(in_oklch,var(--color-border-muted)_20%,transparent)]"
          aria-label="编辑个人资料"
        >
          <div className="flex size-[60px] items-center justify-center overflow-hidden rounded-[18px] bg-palette-yellow-light text-palette-orange">
            <GraduationCap className="size-8" strokeWidth={1.6} />
          </div>
        </button>

        <h4 className="relative z-10 mb-1 text-[19px] font-extrabold tracking-tight text-brand-dark">
          {user.username}
        </h4>
        <p className="relative z-10 mb-6 text-sm font-semibold text-brand-medium">
          初学乍练 · 累计签到{" "}
          <strong className="font-extrabold">{user.total_checkins}</strong> 天
        </p>

        <div className="relative z-10 mb-3 grid w-full grid-cols-2 gap-2">
          <StatCard label="等级" icon={<Crown className="size-3.5" />} value={`Lv.${level}`} tone="yellow" />
          <StatCard
            label="连续登录天数"
            icon={<Flame className="size-3.5" />}
            value={`${user.streak_checkins} 天`}
            tone="orange"
          />
          <StatCard label="金币" icon={<Coins className="size-3.5" />} value={user.gold} tone="blue" />
          <StatCard label="钻石" icon={<Gem className="size-3.5" />} value={user.diamond} tone="purple" />
        </div>

        <div className="relative z-10 flex w-full gap-2">
          <button
            type="button"
            onClick={() => setHandbookOpen(true)}
            className="flex h-11 flex-1 items-center justify-center gap-1 rounded-[14px] border-[1.5px] border-palette-green-light/50 bg-gradient-to-br from-palette-green-mist to-palette-green-lighter text-sm font-extrabold text-brand-dark shadow-[0_4px_8px_color-mix(in_oklch,var(--color-border-muted)_15%,transparent)] transition-transform hover:-translate-y-0.5"
          >
            <BookOpen className="size-4" strokeWidth={2.5} /> 新手图鉴
          </button>
          <CheckinButton
            alreadyCheckedToday={checkedToday}
            className="flex-1"
          />
          <button
            type="button"
            onClick={handleLogout}
            title="登出账号"
            className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-canvas text-destructive shadow-[var(--shadow-soft)] transition-transform hover:-translate-y-0.5"
          >
            <LogOut className="size-[18px]" strokeWidth={2.5} />
          </button>
        </div>
      </div>

      <AiChatPanel />

      <ProfileEditDialog
        user={user}
        open={profileOpen}
        onOpenChange={setProfileOpen}
      />
      <HandbookDialog open={handbookOpen} onOpenChange={setHandbookOpen} />
    </div>
  );
}

type Tone = "yellow" | "orange" | "blue" | "purple";

const TONE_CLASS: Record<Tone, string> = {
  yellow:
    "bg-gradient-to-br from-palette-yellow-mist to-palette-yellow-light border-palette-yellow/40 shadow-[0_2px_8px_color-mix(in_oklch,var(--palette-yellow)_25%,transparent)]",
  orange:
    "bg-gradient-to-br from-palette-orange-mist to-palette-orange-lighter border-palette-orange-light/40 shadow-[0_2px_8px_color-mix(in_oklch,var(--palette-orange-light)_25%,transparent)]",
  blue: "bg-gradient-to-br from-palette-blue-mist to-palette-blue-lighter border-palette-blue-light/20 shadow-[0_2px_8px_color-mix(in_oklch,var(--palette-blue-light)_25%,transparent)]",
  purple:
    "bg-gradient-to-br from-palette-purple-mist to-palette-purple-lighter border-palette-purple/20 shadow-[0_2px_8px_color-mix(in_oklch,var(--palette-purple)_25%,transparent)]",
};

function StatCard({
  label,
  icon,
  value,
  tone,
}: {
  label: string;
  icon: React.ReactNode;
  value: string | number;
  tone: Tone;
}) {
  return (
    <div
      className={`flex items-center justify-between rounded-xl border px-3 py-2 ${TONE_CLASS[tone]}`}
    >
      <span className="flex items-center gap-1 text-sm font-semibold text-brand-dark">
        {icon}
        {label}
      </span>
      <span className="text-sm font-extrabold text-brand-dark">{value}</span>
    </div>
  );
}
