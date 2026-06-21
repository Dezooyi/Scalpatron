import { useMemo } from "react";
import {
  Wallet as WalletIcon,
  TrendingUp,
  TrendingDown,
  ArrowDownLeft,
  ArrowUpRight,
  Activity,
  Coins,
  ExternalLink,
  Copy,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/StatCard";
import {
  useWalletData,
  formatSol,
  formatUsd,
  formatTimestamp,
  shortenAddress,
} from "@/hooks/useWalletData";

interface Props {
  data: ReturnType<typeof useWalletData>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function WalletOverview({ data }: Props) {
  const { info, transactions, bots } = data;

  const stats = useMemo(() => {
    const latestTs = transactions[0]?.timestamp ?? 0;
    const dayAgo = latestTs - DAY_MS;
    const txs24h = transactions.filter(t => t.timestamp >= dayAgo);
    const buys24h = txs24h.filter(t => t.action === "BUY").length;
    const sells24h = txs24h.filter(t => t.action === "SELL").length;
    const pnl24h = txs24h.reduce((sum, t) => sum + (t.pnlPercent ?? 0), 0);
    const liveBots = bots.filter(b => !b.paperMode && b.walletAddress === info?.address).length;
    return { txs24h: txs24h.length, buys24h, sells24h, pnl24h, liveBots };
  }, [transactions, bots, info?.address]);

  const recentTxs = useMemo(() => transactions.slice(0, 5), [transactions]);

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch { /* ignore */ }
  };

  if (!info) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Activity className="h-5 w-5 animate-pulse mr-2" />
        <span className="text-sm">Wallet-Daten werden geladen…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={WalletIcon}
          label="SOL Balance"
          value={formatSol(info.solBalance)}
          subvalue={formatUsd(info.solBalanceUsd)}
          accent="primary"
        />
        <StatCard
          icon={stats.pnl24h >= 0 ? TrendingUp : TrendingDown}
          label="24h PnL"
          value={`${stats.pnl24h >= 0 ? "+" : ""}${stats.pnl24h.toFixed(2)}%`}
          subvalue={`${stats.buys24h} Käufe · ${stats.sells24h} Verkäufe`}
          accent={stats.pnl24h >= 0 ? "success" : "danger"}
        />
        <StatCard
          icon={Activity}
          label="Trades 24h"
          value={String(stats.txs24h)}
          subvalue={`${transactions.length} gesamt`}
          accent="muted"
        />
        <StatCard
          icon={Coins}
          label="Aktive Bots"
          value={String(stats.liveBots)}
          subvalue={`${info.tokenCount} Token-Bestände`}
          accent="muted"
        />
      </div>

      {/* Wallet Address */}
      <Card className="bg-card/40 backdrop-blur-md border-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <WalletIcon className="h-4 w-4 text-primary" />
            Primäre Wallet ({info.network})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <code className="text-xs font-mono bg-zinc-900/60 border border-white/5 px-3 py-2 rounded flex-1 truncate">
              {info.address || "—"}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleCopy(info.address)}
              className="shrink-0"
            >
              <Copy className="h-3 w-3" />
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Zuletzt aktualisiert: {formatTimestamp(info.lastUpdate)}
          </p>
        </CardContent>
      </Card>

      {/* Recent Transactions */}
      <Card className="bg-card/40 backdrop-blur-md border-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold">Letzte Transaktionen</CardTitle>
        </CardHeader>
        <CardContent>
          {recentTxs.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              Noch keine Transaktionen vorhanden
            </p>
          ) : (
            <div className="space-y-2">
              {recentTxs.map(tx => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between gap-3 py-2 px-3 rounded-md bg-zinc-900/40 border border-white/5"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                        tx.action === "BUY"
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-red-500/15 text-red-400"
                      }`}
                    >
                      {tx.action === "BUY" ? (
                        <ArrowDownLeft className="h-4 w-4" />
                      ) : (
                        <ArrowUpRight className="h-4 w-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-bold flex items-center gap-2">
                        {tx.action}
                        {tx.paperMode === 1 ? (
                          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
                            Paper
                          </span>
                        ) : (
                          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                            Live
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {formatTimestamp(tx.timestamp)} · {tx.botId.slice(0, 8)}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-mono tabular-nums">
                      {tx.amount?.toFixed(4) ?? "—"}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      @ {tx.price.toFixed(8)}
                    </div>
                  </div>
                  {tx.solscanUrl && (
                    <a
                      href={tx.solscanUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:text-primary/80 shrink-0"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Signature helper */}
      <p className="text-[10px] text-muted-foreground text-center">
        Adressen & Signaturen: {shortenAddress(info.address, 8, 8)}
      </p>
    </div>
  );
}