"use client";

import { CalendarCheck, Check } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { checkinAction } from "@/app/(app)/dashboard/actions";

export function CheckinButton({
  alreadyCheckedToday,
  className,
}: {
  alreadyCheckedToday: boolean;
  className?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(alreadyCheckedToday);

  const handleClick = () => {
    startTransition(async () => {
      const result = await checkinAction();
      if (result.ok) {
        setDone(true);
        toast.success(`签到成功 +${result.data.gold_reward} 金币`, {
          description: `连续签到 ${result.data.streak_checkins} 天`,
        });
      } else {
        toast.error(result.message);
      }
    });
  };

  return (
    <button
      type="button"
      disabled={isPending || done}
      onClick={handleClick}
      className={`flex h-11 items-center justify-center gap-1 rounded-[14px] border border-palette-yellow/40 bg-gradient-to-br from-palette-yellow-mist to-palette-yellow-light text-sm font-extrabold text-brand-dark shadow-[0_2px_8px_color-mix(in_oklch,var(--palette-yellow)_25%,transparent)] transition-transform hover:not-disabled:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 ${className ?? ""}`}
    >
      {done ? <><Check className="size-4" strokeWidth={2.5} /> 已签到</> : isPending ? "签到中…" : <><CalendarCheck className="size-4" strokeWidth={2.5} /> 签到</>}
    </button>
  );
}
