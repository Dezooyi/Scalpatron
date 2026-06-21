import { useMemo, useState } from "react";
import { Receipt, ExternalLink, Download, Filter } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useWalletData,
  formatTimestamp,
  shortenAddress,
  type WalletTxMode,
  type WalletTxType,
} from "@/hooks/useWalletData";

interface Props {
  data: ReturnType<typeof useWalletData>;
}

const MODES: { key: WalletTxMode; label: string }[] = [
  { key: "ALL", label: "Alle" },
  { key: "paper", label: "Paper" },
  { key: "live", label: "Live" },
];

const TYPES: { key: WalletTxType; label: string }[] = [
  { key: "ALL", label: "Alle" },
  { key: "BUY", label: "Käufe" },
  { key: "SELL", label: "Verkäufe" },
];

export function WalletTransactions({ data }: Props) {
  const { transactions, onchainTxs } = data;
  const [mode, setMode] = useState<WalletTxMode>("ALL");
  const [type, setType] = useState<WalletTxType>("ALL");
  const [botFilter, setBotFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    return transactions.filter(t => {
      if (type !== "ALL" && t.action !== type) return false;
      if (mode === "paper" && t.paperMode !== 1) return false;
      if (mode === "live" && t.paperMode !== 0) return false;
      if (botFilter !== "all" && t.botId !== botFilter) return false;
      return true;
    });
  }, [transactions, mode, type, botFilter]);

  const uniqueBots = useMemo(() => {
    const set = new Set(transactions.map(t => t.botId));
    return Array.from(set);
  }, [transactions]);

  const exportCsv = () => {
    const headers = ["timestamp", "action", "price", "amount", "solAmount", "fee", "slippagePct", "pnlPercent", "paperMode", "botId", "signature", "solscanUrl"];
    const rows = filtered.map(t => [
      new Date(t.timestamp).toISOString(),
      t.action,
      t.price,
      t.amount ?? "",
      t.solAmount ?? "",
      t.fee ?? "",
      t.slippagePct ?? "",
      t.pnlPercent ?? "",
      t.paperMode,
      t.botId,
      t.signature ?? "",
      t.solscanUrl ?? "",
    ].join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wallet-transactions-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {/* DB Transactions */}
      <Card className="bg-card/40 backdrop-blur-md border-white/5">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Receipt className="h-4 w-4 text-primary" />
              Persistierte Transaktionen ({filtered.length})
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex border border-white/10 rounded-md overflow-hidden">
                {TYPES.map(t => (
                  <button
                    key={t.key}
                    onClick={() => setType(t.key)}
                    className={`px-2.5 py-1 text-xs font-bold transition-colors ${
                      type === t.key
                        ? "bg-primary/20 text-primary"
                        : "hover:bg-white/5 text-muted-foreground"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="flex border border-white/10 rounded-md overflow-hidden">
                {MODES.map(m => (
                  <button
                    key={m.key}
                    onClick={() => setMode(m.key)}
                    className={`px-2.5 py-1 text-xs font-bold transition-colors ${
                      mode === m.key
                        ? "bg-primary/20 text-primary"
                        : "hover:bg-white/5 text-muted-foreground"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <select
                value={botFilter}
                onChange={e => setBotFilter(e.target.value)}
                className="h-7 bg-zinc-900/60 border border-white/10 rounded-md px-2 text-xs"
              >
                <option value="all">Alle Bots</option>
                {uniqueBots.map(b => (
                  <option key={b} value={b}>{shortenAddress(b, 6, 4)}</option>
                ))}
              </select>
              <Button size="sm" variant="outline" onClick={exportCsv} disabled={filtered.length === 0}>
                <Download className="h-3 w-3 mr-1" />
                CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">
              Keine Transaktionen für die gewählten Filter
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px]">Zeit</TableHead>
                    <TableHead className="text-[10px]">Bot</TableHead>
                    <TableHead className="text-[10px]">Typ</TableHead>
                    <TableHead className="text-[10px] text-right">Preis</TableHead>
                    <TableHead className="text-[10px] text-right">Amount</TableHead>
                    <TableHead className="text-[10px] text-right">PnL</TableHead>
                    <TableHead className="text-[10px] text-right">Fee</TableHead>
                    <TableHead className="text-[10px]">Mode</TableHead>
                    <TableHead className="text-[10px]">Signature</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(t => (
                    <TableRow key={t.id}>
                      <TableCell className="text-[10px] font-mono whitespace-nowrap">
                        {formatTimestamp(t.timestamp)}
                      </TableCell>
                      <TableCell className="text-[10px] font-mono">
                        {shortenAddress(t.botId, 4, 4)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            t.action === "BUY"
                              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                              : "bg-red-500/15 text-red-400 border border-red-500/30"
                          }`}
                        >
                          {t.action}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono tabular-nums">
                        {t.price.toFixed(8)}
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono tabular-nums">
                        {t.amount?.toFixed(4) ?? "—"}
                      </TableCell>
                      <TableCell className={`text-xs text-right font-mono tabular-nums ${
                        (t.pnlPercent ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}>
                        {t.pnlPercent !== null ? `${t.pnlPercent.toFixed(2)}%` : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono tabular-nums text-muted-foreground">
                        {t.fee !== null && t.fee !== undefined ? t.fee.toFixed(6) : "—"}
                      </TableCell>
                      <TableCell>
                        {t.paperMode === 1 ? (
                          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
                            Paper
                          </span>
                        ) : (
                          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                            Live
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {t.solscanUrl ? (
                          <a
                            href={t.solscanUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:text-primary/80 inline-flex items-center gap-1 text-[10px] font-mono"
                          >
                            {shortenAddress(t.signature ?? "", 4, 4)}
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* On-Chain Transactions */}
      <Card className="bg-card/40 backdrop-blur-md border-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Filter className="h-4 w-4 text-primary" />
            On-Chain Signaturen ({onchainTxs.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {onchainTxs.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">
              Keine On-Chain-Transaktionen gefunden (Wallet inaktiv oder RPC-Limit)
            </p>
          ) : (
            <div className="space-y-1.5">
              {onchainTxs.map(tx => (
                <a
                  key={tx.signature}
                  href={tx.solscanUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-3 py-2 px-3 rounded bg-zinc-900/40 border border-white/5 hover:bg-white/5 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-mono truncate">
                      {shortenAddress(tx.signature, 8, 8)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {tx.blockTime ? formatTimestamp(tx.blockTime) : "pending"} · Slot {tx.slot ?? "—"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {tx.err ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30">
                        ERR
                      </span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        OK
                      </span>
                    )}
                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                  </div>
                </a>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}