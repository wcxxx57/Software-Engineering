"use client";

import {
  Coins,
  Gem,
  History,
  Loader2,
  Sparkles,
  WalletCards,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AssetKind, AssetTransaction, User } from "@/lib/api/schemas";
import { useAssetOverview } from "@/lib/query/assets";

interface AssetOverviewDialogProps {
  user: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialAsset?: AssetKind;
}

const ASSET_META = {
  EXP: { label: "经验", unit: "EXP", icon: Sparkles, tone: "text-palette-green", bg: "bg-palette-green-mist" },
  GOLD: { label: "金币", unit: "金币", icon: Coins, tone: "text-palette-orange", bg: "bg-palette-yellow-mist" },
  DIAMOND: { label: "钻石", unit: "钻石", icon: Gem, tone: "text-palette-purple", bg: "bg-palette-purple-mist" },
} satisfies Record<AssetKind, { label: string; unit: string; icon: typeof Coins; tone: string; bg: string }>;

export function AssetOverviewDialog({
  user,
  open,
  onOpenChange,
  initialAsset = "EXP",
}: AssetOverviewDialogProps) {
  const query = useAssetOverview(open);
  const overview = query.data ?? {
    exp: user.exp,
    gold: user.gold,
    diamond: user.diamond,
    transactions: [],
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] max-w-2xl overflow-hidden p-0">
        <div className="h-1 bg-gradient-to-r from-palette-green via-palette-yellow to-palette-purple" />
        <div className="px-6 pt-5 pb-6 sm:px-8">
          <DialogHeader className="mb-5">
            <div className="mb-2 flex size-11 items-center justify-center rounded-2xl bg-palette-orange-mist text-palette-orange">
              <WalletCards className="size-5" strokeWidth={2.2} />
            </div>
            <DialogTitle className="text-2xl font-extrabold text-brand-dark">
              我的资产与收支
            </DialogTitle>
            <DialogDescription>
              查看当前余额，以及 EXP、金币和钻石的最近 200 条变动记录。
            </DialogDescription>
          </DialogHeader>

          <div className="mb-5 grid grid-cols-3 gap-2 sm:gap-3">
            <BalanceCard kind="EXP" value={overview.exp} />
            <BalanceCard kind="GOLD" value={overview.gold} />
            <BalanceCard kind="DIAMOND" value={overview.diamond} />
          </div>

          <Tabs key={initialAsset} defaultValue={initialAsset}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="EXP">EXP 记录</TabsTrigger>
              <TabsTrigger value="GOLD">金币收支</TabsTrigger>
              <TabsTrigger value="DIAMOND">钻石收支</TabsTrigger>
            </TabsList>

            {(["EXP", "GOLD", "DIAMOND"] as const).map((kind) => (
              <TabsContent key={kind} value={kind} className="mt-4">
                {query.isLoading ? (
                  <div className="flex h-52 items-center justify-center gap-2 text-sm text-brand-medium">
                    <Loader2 className="size-4 animate-spin" /> 正在加载收支记录
                  </div>
                ) : query.isError ? (
                  <div className="flex h-52 items-center justify-center text-sm text-destructive">
                    收支记录加载失败，请稍后重试
                  </div>
                ) : (
                  <TransactionList
                    kind={kind}
                    transactions={overview.transactions.filter((item) => item.asset === kind)}
                  />
                )}
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BalanceCard({ kind, value }: { kind: AssetKind; value: number }) {
  const meta = ASSET_META[kind];
  const Icon = meta.icon;
  return (
    <div className={`rounded-2xl border border-border/30 p-3 sm:p-4 ${meta.bg}`}>
      <div className={`mb-2 flex items-center gap-1.5 text-xs font-bold ${meta.tone}`}>
        <Icon className="size-3.5" /> {meta.label}
      </div>
      <div className="truncate text-lg font-black text-brand-dark sm:text-2xl">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function TransactionList({
  kind,
  transactions,
}: {
  kind: AssetKind;
  transactions: AssetTransaction[];
}) {
  const meta = ASSET_META[kind];
  if (transactions.length === 0) {
    return (
      <div className="flex h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-border/50 bg-muted/20 text-center">
        <History className="mb-3 size-7 text-brand-light" />
        <p className="text-sm font-bold text-brand-dark">暂时没有{meta.label}变动</p>
        <p className="mt-1 max-w-xs text-xs leading-5 text-brand-light">
          流水从本版本上线后开始记录；历史余额仍会在上方正常显示。
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[330px] pr-3">
      <div className="flex flex-col gap-2">
        {transactions.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between gap-4 rounded-2xl border border-border/35 bg-white/70 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-brand-dark">{item.title}</p>
              <p className="mt-1 text-xs text-brand-light">
                {new Intl.DateTimeFormat("zh-CN", {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date(item.created_at))}
                <span className="mx-1.5">·</span>
                变动后 {item.balance_after.toLocaleString()} {meta.unit}
              </p>
            </div>
            <span
              className={`shrink-0 text-base font-black ${
                item.amount > 0 ? "text-palette-green" : "text-destructive"
              }`}
            >
              {item.amount > 0 ? "+" : ""}
              {item.amount.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
