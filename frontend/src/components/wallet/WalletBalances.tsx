import { useMemo, useState } from "react";
import { Coins, RefreshCw, Camera, Copy, Wallet as WalletIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useWalletData,
  getApiBase,
  formatSol,
  formatTokenAmount,
  formatUsd,
  formatTimestamp,
  shortenAddress,
  type WalletRange,
} from "@/hooks/useWalletData";

interface Props {
  data: ReturnType<typeof useWalletData>;
}

const RANGES: { key: WalletRange; label: string }[] = [
  { key: "1h", label: "1h" },
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "all", label: "All" },
];

export function WalletBalances({ data }: Props) {
  const { info, balances, balanceHistory, refresh, triggerSnapshot, loading } = data;
  const [range, setRange] = useState<WalletRange>("24h");
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [snapshots, setSnapshots] = useState(data.balanceHistory);
  const [filter, setFilter] = useState("");

  const handleRangeChange = async (r: WalletRange) => {
    setRange(r);
    setSnapshotsLoading(true);
    try {
      const res = await fetch(`${getApiBase()}/api/wallet/balance/history?range=${r}`);
      const json = res.ok ? await res.json() : { history: [] };
      setSnapshots(json.history ?? []);
    } finally {
      setSnapshotsLoading(false);
    }
  };

  const filteredBalances = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return balances;
    return balances.filter(b =>
      (b.symbol ?? "").toLowerCase().includes(f) ||
      (b.name ?? "").toLowerCase().includes(f) ||
      b.mint.toLowerCase().includes(f),
    );
  }, [balances, filter]);

  const handleCopy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
  };

  const handleSnapshot = async () => {
    if (snapshotsLoading) return;
    setSnapshotsLoading(true);
    try {
      await triggerSnapshot();
      await handleRangeChange(range);
    } finally {
      setSnapshotsLoading(false);
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {/* SOL Card */}
      <Card className="bg-gradient-to-br from-primary/10 to-card/40 backdrop-blur-md border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <WalletIcon className="h-4 w-4 text-primary" />
            SOL (Native)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-black tabular-nums text-primary">
              {info ? formatSol(info.solBalance, 4) : "—"}
            </span>
            {info?.solBalanceUsd !== undefined && (
              <span className="text-lg font-bold text-muted-foreground tabular-nums">
                {formatUsd(info.solBalanceUsd)}
              </span>
            )}
          </div>
          {info && (
            <p className="text-[10px] text-muted-foreground mt-1 font-mono">
              {shortenAddress(info.address, 8, 8)} · {info.network}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Range Selector + Actions */}
      <Card className="bg-card/40 backdrop-blur-md border-white/5">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Coins className="h-4 w-4 text-primary" />
              Balance-Historie
            </CardTitle>
            <div className="flex items-center gap-2">
              <div className="flex border border-white/10 rounded-md overflow-hidden">
                {RANGES.map(r => (
                  <button
                    key={r.key}
                    onClick={() => handleRangeChange(r.key)}
                    className={`px-2.5 py-1 text-xs font-bold transition-colors ${
                      range === r.key
                        ? "bg-primary/20 text-primary"
                        : "hover:bg-white/5 text-muted-foreground"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
                <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
              </Button>
              <Button size="sm" onClick={handleSnapshot} disabled={snapshotsLoading}>
                <Camera className="h-3 w-3 mr-1" />
                Snapshot
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {snapshots.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">
              Keine Snapshots im gewählten Zeitraum. Erstelle einen manuellen Snapshot oder warte 5 Min.
            </p>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {snapshots.slice(0, 30).map(s => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-3 py-1.5 px-3 rounded bg-zinc-900/40 border border-white/5"
                >
                  <div className="text-[10px] text-muted-foreground font-mono">
                    {formatTimestamp(s.timestamp)}
                  </div>
                  <div className="text-sm font-mono tabular-nums font-bold">
                    {s.mintAddress ? `${formatTokenAmount(s.balance, 4)} Token` : formatSol(s.balance)}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {s.source}
                  </div>
                </div>
              ))}
            </div>
          )}
          {balanceHistory.length > 0 && (
            <p className="text-[10px] text-muted-foreground mt-3 text-center">
              Zeige neueste Snapshots · automatisch alle 5 Min
            </p>
          )}
        </CardContent>
      </Card>

      {/* Token Balances */}
      <Card className="bg-card/40 backdrop-blur-md border-white/5">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Coins className="h-4 w-4 text-primary" />
              Token-Bestände ({balances.length})
            </CardTitle>
            <Input
              placeholder="Filter…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="h-8 max-w-48 text-xs"
            />
          </div>
        </CardHeader>
        <CardContent>
          {filteredBalances.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">
              {balances.length === 0
                ? "Keine Token-Bestände gefunden"
                : "Keine Token entsprechen dem Filter"}
            </p>
          ) : (
            <div className="space-y-1.5">
              {filteredBalances.map(b => (
                <div
                  key={b.mint}
                  className="flex items-center justify-between gap-3 py-2 px-3 rounded bg-zinc-900/40 border border-white/5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold">
                        {b.symbol ?? shortenAddress(b.mint, 6, 4)}
                      </span>
                      {b.name && (
                        <span className="text-[10px] text-muted-foreground truncate">
                          {b.name}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => handleCopy(b.mint)}
                      className="text-[10px] font-mono text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                    >
                      <Copy className="h-2.5 w-2.5" />
                      {shortenAddress(b.mint, 8, 8)}
                    </button>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-mono tabular-nums font-bold">
                      {formatTokenAmount(b.balance, b.decimals ?? 2)}
                    </div>
                    {b.usdValue !== undefined && (
                      <div className="text-[10px] text-muted-foreground">
                        {formatUsd(b.usdValue)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}