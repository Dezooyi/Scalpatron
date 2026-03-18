import { Wallet, Coins, Settings2 } from "lucide-react";
import type { BotState } from "@/App";

interface BotTelemetryProps {
  bot: BotState;
  tokenBSymbol: string;
  className?: string;
}

export function BotTelemetry({ bot, tokenBSymbol, className = "" }: BotTelemetryProps) {
  return (
    <div className={`flex gap-3 ${className}`}>
      {/* Wallet Card (SOL + Token combined) */}
      <div className="rounded-lg bg-muted/30 border border-border px-4 py-2 flex items-center gap-4">
        {/* SOL Balance */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <Wallet className="h-3 w-3 text-emerald-400" />
            <span className="text-[9px] font-bold uppercase text-muted-foreground">SOL Balance</span>
          </div>
          <div className="text-sm font-black text-foreground font-mono">
            {bot.stats?.balanceSOL?.toFixed(3) || "0.000"}
          </div>
        </div>

        <div className="w-px h-7 bg-border" />

        {/* Token Balance */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <Coins className="h-3 w-3 text-cyan-400" />
            <span className="text-[9px] font-bold uppercase text-muted-foreground">{tokenBSymbol} Balance</span>
          </div>
          <div className="text-sm font-black text-primary font-mono flex items-center gap-2">
            {bot.stats?.balanceUGOR?.toFixed(1) || "0.0"}
            {(bot.stats?.openPositionsCount ?? 0) > 1 && (
              <span className="text-[10px] bg-cyan-500/10 text-cyan-400 px-1.5 py-0.5 rounded border border-cyan-500/20">
                {bot.stats?.openPositionsCount} Tranches
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Trade Mode */}
      <div className="rounded-lg bg-muted/30 border border-border px-4 py-2 space-y-1">
        <div className="flex items-center gap-1.5">
          <Settings2 className="h-3 w-3 text-purple-400" />
          <span className="text-[9px] font-bold uppercase text-muted-foreground">Trade Mode</span>
        </div>
        <div className="text-sm font-black text-foreground font-mono">
          {bot.tradingMode === "aggressive" ? (
            <span className="flex items-center gap-1">
              <span className="text-primary">{bot.aiAggressiveness ?? bot.aggressiveness ?? 10}%</span>
              <span className="text-muted-foreground">/</span>
              <span className="text-muted-foreground text-[10px]">max {bot.aggressiveness ?? 10}%</span>
            </span>
          ) : (
            <span>{bot.tradeSize ?? 1} SOL fixed</span>
          )}
        </div>
      </div>
    </div>
  );
}
