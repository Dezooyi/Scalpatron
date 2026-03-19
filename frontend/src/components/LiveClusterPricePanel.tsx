import { ScannerPulse } from "./ScannerPulse";
import type { BotState } from "../App";

interface LiveClusterPricePanelProps {
  selectedBot: BotState;
  setBots: React.Dispatch<React.SetStateAction<BotState[]>>;
}

export function LiveClusterPricePanel({ selectedBot, setBots }: LiveClusterPricePanelProps) {
  const stats = selectedBot.stats;
  const wins = stats?.wins ?? 0;
  const losses = stats?.losses ?? 0;
  const totalTrades = stats?.totalTrades ?? 0;
  const balanceSOL = stats?.balanceSOL ?? 0;
  const tradeSize = selectedBot.tradeSize ?? 1;
  const aggressiveness = selectedBot.aiAggressiveness ?? selectedBot.aggressiveness ?? 10;
  const tradingMode = selectedBot.tradingMode ?? "fixed";

  // PnL sums from recent trades
  const trades = selectedBot.recentTrades ?? [];
  const winPnlSum = trades.filter(t => (t.pnl ?? 0) > 0).reduce((a, t) => a + (t.pnl ?? 0), 0);
  const lossPnlSum = trades.filter(t => (t.pnl ?? 0) < 0).reduce((a, t) => a + (t.pnl ?? 0), 0);

  // Possible trades with current balance & settings
  const effectiveSize = tradingMode === "aggressive"
    ? balanceSOL * (aggressiveness / 100)
    : tradeSize;
  const possibleTrades = effectiveSize > 0 ? Math.floor(balanceSOL / effectiveSize) : 0;

  // Win rate calculation
  const winRate = totalTrades > 0 ? wins / totalTrades : 0;
  const winRatePercentage = winRate * 100;

  // Recent trade analysis
  const recentWins = trades.filter(t => (t.pnl ?? 0) > 0).length;
  const avgWinPnl = recentWins > 0 ? winPnlSum / recentWins : 0;

  // Possible profit
  const possibleProfit = possibleTrades * winRate * avgWinPnl;

  // Total PnL percentage
  const totalPnlPercent = stats?.totalPnlPercent ?? 0;

  const getApiBase = () => localStorage.getItem('scalpatron_api_url') ?? 'http://localhost:3000';

  return (
    <div className="bg-primary/5 rounded-lg border-0 shadow-lg relative overflow-hidden trade-flash-target-${selectedBot?.id} ai-flash-target-${selectedBot?.id}">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
        
        {/* LEFT PANEL: Price Header, Manual Trading, BUY/SELL Buttons */}
        <div className="flex flex-col gap-4 border-r border-primary/10 pr-4">
          {/* Price Header Section */}
          <div className="shrink-0">
            <div className="text-xs text-foreground uppercase mb-2 font-bold uppercase tracking-wider flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              Live Cluster Price
            </div>
            <div className="text-5xl font-light text-foreground leading-tight tracking-tighter">
              ${stats?.lastPrice?.toFixed(6) || "0.000000"}
            </div>
            <div className="flex items-center gap-2 mt-3 text-micro">
              <span className="text-muted-foreground opacity-40">PREVIOUS:</span>
              <span className="text-primary/60 font-bold">
                ${selectedBot.priceHistory && selectedBot.priceHistory.length > 1
                  ? selectedBot.priceHistory[selectedBot.priceHistory.length - 2].toFixed(6)
                  : "---"}
              </span>
            </div>
          </div>

          <div className="h-px w-full bg-primary/10 my-1" />

          {/* Manual Trading Section */}
          <div className="shrink-0 space-y-4">
            <div className="text-xs text-primary/70 font-bold uppercase tracking-wider">
              Manual Trading
            </div>
            
            {/* Trading Mode Toggle */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-tight text-muted-foreground block">
                Trading Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (selectedBot?.id) {
                      fetch(`${getApiBase()}/api/bots/${selectedBot.id}/config`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          tradeSize: selectedBot.tradeSize,
                          aggressiveness: selectedBot.aggressiveness,
                          tradingMode: 'fixed',
                        }),
                      }).then(() => {
                        setBots(prev => prev.map(b => b.id === selectedBot.id ? { ...b, tradingMode: 'fixed' } : b));
                      });
                    }
                  }}
                  className={`py-1.5 rounded text-[10px] font-bold border transition-colors ${selectedBot?.tradingMode === 'fixed' ? 'bg-primary/20 border-primary/40 text-primary' : 'bg-muted border-border text-muted-foreground'}`}
                >
                  Fixed SOL
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (selectedBot?.id) {
                      fetch(`${getApiBase()}/api/bots/${selectedBot.id}/config`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          tradeSize: selectedBot.tradeSize,
                          aggressiveness: selectedBot.aggressiveness,
                          tradingMode: 'aggressive',
                        }),
                      }).then(() => {
                        setBots(prev => prev.map(b => b.id === selectedBot.id ? { ...b, tradingMode: 'aggressive' } : b));
                      });
                    }
                  }}
                  className={`py-1.5 rounded text-[10px] font-bold border transition-colors ${selectedBot?.tradingMode === 'aggressive' ? 'bg-primary/20 border-primary/40 text-primary' : 'bg-muted border-border text-muted-foreground'}`}
                >
                  Aggressive
                </button>
              </div>
            </div>
            
            {/* Amount Slider */}
            {selectedBot?.tradingMode === 'fixed' ? (
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-tight text-muted-foreground flex justify-between">
                  <span>SOL per Trade</span>
                  <span className="text-primary font-mono">{selectedBot.tradeSize?.toFixed(2)} SOL</span>
                </label>
                <input
                  type="range" min={0.01} max={10} step={0.01}
                  value={selectedBot.tradeSize ?? 1}
                  onChange={async (e) => {
                    const newSize = parseFloat(e.target.value);
                    if (selectedBot?.id) {
                      await fetch(`${getApiBase()}/api/bots/${selectedBot.id}/config`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          tradeSize: newSize,
                          aggressiveness: selectedBot.aggressiveness,
                          tradingMode: 'fixed',
                        }),
                      });
                      setBots(prev => prev.map(b => b.id === selectedBot.id ? { ...b, tradeSize: newSize } : b));
                    }
                  }}
                  className="w-full accent-primary"
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-tight text-muted-foreground flex justify-between">
                  <span>Max Aggressiveness</span>
                  <span className="text-primary font-mono">{selectedBot.aggressiveness}%</span>
                </label>
                <input
                  type="range" min={1} max={100}
                  value={selectedBot.aggressiveness ?? 10}
                  onChange={async (e) => {
                    const newAggro = parseInt(e.target.value);
                    if (selectedBot?.id) {
                      await fetch(`${getApiBase()}/api/bots/${selectedBot.id}/config`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          tradeSize: selectedBot.tradeSize,
                          aggressiveness: newAggro,
                          tradingMode: 'aggressive',
                        }),
                      });
                      setBots(prev => prev.map(b => b.id === selectedBot.id ? { ...b, aggressiveness: newAggro } : b));
                    }
                  }}
                  className="w-full accent-primary"
                />
              </div>
            )}
            
            {/* BUY/SELL Buttons */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                className="flex items-center justify-center gap-1.5 bg-green-500/20 hover:bg-green-500/30 border border-green-500/40 text-green-400 rounded-md py-2.5 px-3 text-sm font-bold uppercase tracking-wide transition-all active:scale-95 disabled:opacity-50"
                disabled={!selectedBot?.stats?.lastPrice}
                onClick={async () => {
                  if (!selectedBot?.id || !selectedBot?.stats?.lastPrice) return;
                  try {
                    await fetch(`${getApiBase()}/api/bots/${selectedBot.id}/trade`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'BUY', price: selectedBot.stats.lastPrice }),
                    });
                  } catch (err) { console.error(err); }
                }}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
                Buy
              </button>

              <button
                className="flex items-center justify-center gap-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-400 rounded-md py-2.5 px-3 text-sm font-bold uppercase tracking-wide transition-all active:scale-95 disabled:opacity-50"
                disabled={!selectedBot?.stats?.lastPrice}
                onClick={async () => {
                  if (!selectedBot?.id || !selectedBot?.stats?.lastPrice) return;
                  try {
                    await fetch(`${getApiBase()}/api/bots/${selectedBot.id}/trade`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'SELL', price: selectedBot.stats.lastPrice }),
                    });
                  } catch (err) { console.error(err); }
                }}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
                </svg>
                Sell
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: Scanner Pulse & Statistics */}
        <div className="flex flex-col h-full min-h-[450px]">
          {/* Scanner Pulse - fills available room */}
          <div className="flex-1 min-h-0 relative">
            <ScannerPulse bot={selectedBot} tickDuration={2000} className="h-full w-full" />
          </div>

          {/* Trading Statistics Section */}
          <div className="shrink-0 pt-4 border-t border-primary/10 mt-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <div>
                <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-tight">Total Trades</div>
                <div className="text-xl font-black text-foreground mt-1">{totalTrades}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-tight">Win Rate</div>
                <div className="text-xl font-black text-green-400 mt-1">{winRatePercentage.toFixed(0)}%</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-tight">Total PnL</div>
                <div className={`text-xl font-black mt-1 ${totalPnlPercent >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {totalPnlPercent >= 0 ? "+" : ""}{totalPnlPercent.toFixed(2)}%
                </div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-tight">Balance</div>
                <div className="text-sm font-black text-foreground mt-1 tabular-nums">{balanceSOL.toFixed(3)} SOL</div>
              </div>
            </div>

            {/* Wins/Losses Badges */}
            <div className="flex gap-2 mt-4">
              <div className="flex-1 bg-green-500/5 border border-green-500/10 rounded px-2.5 py-1.5 flex justify-between items-center">
                <span className="text-[10px] font-bold text-green-400/70">WINS</span>
                <span className="text-sm font-black text-green-400">{wins}</span>
              </div>
              <div className="flex-1 bg-red-500/5 border border-red-500/10 rounded px-2.5 py-1.5 flex justify-between items-center">
                <span className="text-[10px] font-bold text-red-500/70">LOSS</span>
                <span className="text-sm font-black text-red-400">{losses}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
