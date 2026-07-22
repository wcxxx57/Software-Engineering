"use client";

import { Coins, Gem, Pencil, Sparkles } from "lucide-react";
import { useState } from "react";

import { AssetOverviewDialog } from "@/components/dashboard/asset-overview-dialog";
import { ProfileEditDialog } from "@/components/dashboard/profile-edit-dialog";
import type { User } from "@/lib/api/schemas";

export function DashboardMobileAccount({ user }: { user: User }) {
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  return (
    <>
      <div className="mb-7 flex w-full items-center gap-2 rounded-2xl border border-border/40 bg-white/75 p-2 shadow-[var(--shadow-soft)] lg:hidden">
        <button
          type="button"
          onClick={() => setAssetsOpen(true)}
          className="grid min-w-0 flex-1 grid-cols-3 gap-1 rounded-xl px-2 py-2 text-left transition-colors hover:bg-palette-orange-mist/60"
        >
          <MobileAsset icon={<Sparkles className="size-3.5" />} label="EXP" value={user.exp} />
          <MobileAsset icon={<Coins className="size-3.5" />} label="金币" value={user.gold} />
          <MobileAsset icon={<Gem className="size-3.5" />} label="钻石" value={user.diamond} />
        </button>
        <button
          type="button"
          onClick={() => setProfileOpen(true)}
          className="flex h-12 shrink-0 items-center gap-1.5 rounded-xl bg-palette-yellow-mist px-3 text-sm font-bold text-palette-orange"
        >
          <Pencil className="size-3.5" /> 编辑资料
        </button>
      </div>

      <AssetOverviewDialog
        user={user}
        open={assetsOpen}
        onOpenChange={setAssetsOpen}
      />
      <ProfileEditDialog
        user={user}
        open={profileOpen}
        onOpenChange={setProfileOpen}
      />
    </>
  );
}

function MobileAsset({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <span className="min-w-0">
      <span className="flex items-center gap-1 text-[10px] font-bold text-brand-light">
        {icon} {label}
      </span>
      <span className="mt-0.5 block truncate text-sm font-black text-brand-dark">
        {value.toLocaleString()}
      </span>
    </span>
  );
}
