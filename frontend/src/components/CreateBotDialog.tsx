import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StrategyChipPicker } from "@/components/StrategyChipPicker";
import {
  Wallet,
  Coins,
  Bot,
  Zap,
  TrendingUp,
  RefreshCw,
  BrainCircuit,
  Play,
  Sliders,
  Activity,
  ShieldCheck,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import { useEffect, useState } from "react";

export interface Token {
  mintAddress: string;
  name: string;
  symbol: string;
}

export interface StrategyItem {
  id: string;
  strategy_name: string;
  strategy_type: string;
  description?: string;
  isTemplate?: boolean;
  indicators?: Array<{ type: string; period?: number; fast_period?: number; slow_period?: number }>;
}

interface CreateBotDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hiddenTrigger?: boolean;
  trigger?: React.ReactNode;
  tokens: Token[];
  strategyTemplates: StrategyItem[];
  savedStrategies: StrategyItem[];
  newBotName: string;
  setNewBotName: (v: string) => void;
  newBotMintAddress: string;
  setNewBotMintAddress: (v: string) => void;
  newBotWalletAddress: string;
  setNewBotWalletAddress: (v: string) => void;
  newBotTradingMode: "fixed" | "aggressive";
  setNewBotTradingMode: (v: "fixed" | "aggressive") => void;
  newBotTradeSize: number;
  setNewBotTradeSize: (v: number) => void;
  newBotAggressiveness: number;
  setNewBotAggressiveness: (v: number) => void;
  newBotStrategyId: string;
  setNewBotStrategyId: (v: string) => void;
  showTokenWhitelist: boolean;
  setShowTokenWhitelist: (v: boolean) => void;
  startAfterCreate: boolean;
  setStartAfterCreate: (v: boolean) => void;
  /** ADR-014: advisor-recommended scalping settings (read-only display). */
  advisorSettings?: {
    cooldownTicks?: number;
    spikeThreshold?: number;
    sellDropThreshold?: number;
    floorWindow?: number;
  } | null;
  /** API-Basis für Wallet-Balance-Fetch (für Reserve-Floor-Anzeige). */
  apiBase: string;
  onCreateBot: () => void;
}

function semanticLabel(pct: number): { label: string; tone: string; barColor: string } {
  if (pct <= 10) return { label: "Minimal",     tone: "text-emerald-300", barColor: "from-emerald-500 to-emerald-300" };
  if (pct <= 25) return { label: "Konservativ", tone: "text-emerald-300", barColor: "from-emerald-500 to-emerald-300" };
  if (pct <= 45) return { label: "Moderat",     tone: "text-cyan-300",    barColor: "from-cyan-500 to-cyan-300" };
  if (pct <= 65) return { label: "Aggressiv",   tone: "text-amber-300",   barColor: "from-amber-500 to-amber-300" };
  if (pct <= 80) return { label: "Stark",       tone: "text-orange-300",  barColor: "from-orange-500 to-orange-300" };
  return           { label: "Maximum",       tone: "text-rose-300",    barColor: "from-rose-500 to-rose-300" };
}

const STRATEGY_AI_HINTS: Record<string, { recommended: number; reason: string }> = {
  scalping:           { recommended: 15, reason: "Scalping profitiert von niedriger Aggressivität — schnelle Exits, kleine Positionen." },
  "scalping-adaptive": { recommended: 20, reason: "Adaptive Scalping passt Parameter an Session & Volatilität an — moderate Aggressivität lässt dem Fork Raum." },
  breakout:           { recommended: 40, reason: "Breakout-Strategien brauchen etwas mehr Kapital um Momentum zu nutzen." },
  dca:                { recommended: 20, reason: "DCA funktioniert am besten mit kontrollierten, kleinen Einsätzen." },
  ema_trend:          { recommended: 35, reason: "EMA-Trend-Strategien profitieren von mittlerer Aggressivität bei klarem Signal." },
  momentum:           { recommended: 50, reason: "Momentum erfordert höhere Einsätze um signifikante Gewinne zu erzielen." },
  rsi_mean_reversion: { recommended: 25, reason: "Mean-Reversion braucht Geduld — niedrige bis mittlere Aggressivität schützt bei Fehlsignalen." },
  solana_dip_buyer:   { recommended: 30, reason: "Dip-Buying: mittlere Aggressivität, da Boden-Timing ungenau ist." },
  solana_runner:      { recommended: 45, reason: "Runner-Strategie: höhere Aggressivität um Trends vollständig zu reiten." },
  solana_sniper:      { recommended: 20, reason: "Sniper: sehr selektiv, daher niedrige Aggressivität pro Trade." },
};

const SOL_RESERVE_FLOOR = 0.05; // Mindest-Reserve für SELL-Tx-Fees
const SOL_MAX_RATIO = 0.9;       // Max 90% der Balance pro Trade

export function CreateBotDialog({
  open,
  onOpenChange,
  hiddenTrigger = false,
  trigger,
  tokens,
  strategyTemplates,
  savedStrategies,
  newBotName,
  setNewBotName,
  newBotMintAddress,
  setNewBotMintAddress,
  newBotWalletAddress,
  setNewBotWalletAddress,
  newBotTradingMode,
  setNewBotTradingMode,
  newBotTradeSize,
  setNewBotTradeSize,
  newBotAggressiveness,
  setNewBotAggressiveness,
  newBotStrategyId,
  setNewBotStrategyId,
  showTokenWhitelist,
  setShowTokenWhitelist,
  startAfterCreate,
  setStartAfterCreate,
  advisorSettings,
  apiBase,
  onCreateBot,
}: CreateBotDialogProps) {
  const [activeTab, setActiveTab] = useState<"setup" | "ai">("setup");
  const allStrategies = [...strategyTemplates, ...savedStrategies];
  const selectedStrategy = allStrategies.find((t) => t.id === newBotStrategyId);
  const strategyType = selectedStrategy?.strategy_type ?? "scalping";
  const aiHint = STRATEGY_AI_HINTS[strategyType] ?? { recommended: 20, reason: "Keine spezifische Empfehlung verfügbar." };
  const sem = semanticLabel(newBotAggressiveness);

  useEffect(() => {
    if (!newBotName && open) {
      const randomId = Math.random().toString(36).substring(2, 7).toUpperCase();
      setNewBotName(`Agent-${randomId}`);
    }
  }, [newBotName, open, setNewBotName]);

  // Reset tab when dialog opens (adjust state during render to avoid cascading renders)
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setActiveTab("setup");
  }

  const generateNewName = () => {
    const randomId = Math.random().toString(36).substring(2, 7).toUpperCase();
    setNewBotName(`Agent-${randomId}`);
  };

  // Wallet-Balance für Reserve-Floor-Anzeige (alle 15s im Hintergrund)
  const [walletInfo, setWalletInfo] = useState<{ address: string; solBalance: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const fetchWallet = async () => {
      try {
        const res = await fetch(`${apiBase}/api/wallet/info`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setWalletInfo({ address: data.address, solBalance: data.solBalance ?? 0 });
      } catch { /* ignore */ }
    };
    void fetchWallet();
    const interval = setInterval(fetchWallet, 15_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [open, apiBase]);

  // Trade-Größe gegen Reserve-Floor + 90%-Ratio prüfen (nur wenn Wallet-Balance bekannt).
  const walletBalance = walletInfo?.solBalance ?? null;
  const reserveCeiling = walletBalance != null
    ? Math.max(0, Math.min(walletBalance - SOL_RESERVE_FLOOR, walletBalance * SOL_MAX_RATIO))
    : null;
  const fixedModeOverReserve = newBotTradingMode === "fixed"
    && walletBalance != null
    && newBotTradeSize > (reserveCeiling ?? Infinity);
  const aggrOverReserve = newBotTradingMode === "aggressive"
    && walletBalance != null
    && (walletBalance * (newBotAggressiveness / 100)) > (reserveCeiling ?? Infinity);
  const balanceMismatch = walletInfo && newBotWalletAddress
    && newBotWalletAddress.trim() !== ""
    && newBotWalletAddress.trim() !== walletInfo.address;

  const applyRecommended = () => {
    setNewBotAggressiveness(aiHint.recommended);
    setNewBotTradingMode("aggressive");
  };

  const indicators = selectedStrategy?.indicators ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {hiddenTrigger ? (
          <button className="Create Bot hidden sr-only" aria-hidden tabIndex={-1} />
        ) : (
          trigger ?? <button className="Create Bot hidden sr-only" aria-hidden tabIndex={-1} />
        )}
      </DialogTrigger>

      <DialogContent className="w-[95vw] max-w-[820px] bg-black/85 backdrop-blur-2xl border-white/10 text-zinc-100 shadow-2xl overflow-y-auto max-h-[90vh]">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent pointer-events-none" />
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-primary/8 to-transparent pointer-events-none rounded-t-lg" />

        <DialogHeader className="relative">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-primary/10 rounded-lg border border-primary/20">
              <Bot className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-lg font-black tracking-tight">Create Trading Agent</DialogTitle>
              <DialogDescription className="text-zinc-500 text-xs mt-0.5">
                Configure a new autonomous bot for Solana SPL tokens.
              </DialogDescription>
            </div>
          </div>

          {/* Sub-Tabs */}
          <div className="flex gap-1 mt-3 border-b border-white/8 pb-0">
            <button
              type="button"
              onClick={() => setActiveTab("setup")}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold transition-colors border-b-2 -mb-px ${
                activeTab === "setup"
                  ? "border-primary text-primary"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Bot className="h-3.5 w-3.5" />
              Setup
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("ai")}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold transition-colors border-b-2 -mb-px ${
                activeTab === "ai"
                  ? "border-cyan-400 text-cyan-300"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <BrainCircuit className="h-3.5 w-3.5" />
              AI Optimization
              {newBotTradingMode === "aggressive" && (
                <span className="ml-1 px-1 py-0.5 rounded text-[9px] font-black bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  {newBotAggressiveness}%
                </span>
              )}
            </button>
          </div>
        </DialogHeader>

        {/* ── SETUP TAB ── */}
        {activeTab === "setup" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5 py-2 relative">

            {/* ━━━ LEFT COLUMN ━━━ */}
            <div className="flex flex-col gap-5">

              {/* Bot Name */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Bot className="h-3.5 w-3.5 text-primary/70" />
                  <Label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Bot Name</Label>
                </div>
                <div className="flex gap-2">
                  <Input
                    id="bot-name"
                    placeholder="Enter name..."
                    value={newBotName}
                    onChange={(e) => setNewBotName(e.target.value)}
                    className="bg-zinc-800/80 border-white/10 text-zinc-100 placeholder:text-zinc-600 focus:border-primary/50"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={generateNewName}
                    className="bg-zinc-800/80 border-white/10 text-zinc-400 hover:text-primary shrink-0"
                    title="Random Name"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Token Selection */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Coins className="h-3.5 w-3.5 text-primary/70" />
                  <Label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Token</Label>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowTokenWhitelist(false)}
                    className={`flex-1 py-1.5 rounded text-xs font-bold border transition-colors ${
                      !showTokenWhitelist
                        ? "bg-primary/20 border-primary/40 text-primary"
                        : "bg-zinc-800/60 border-white/10 text-zinc-400 hover:border-zinc-500"
                    }`}
                  >
                    Mint Address
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowTokenWhitelist(true)}
                    className={`flex-1 py-1.5 rounded text-xs font-bold border transition-colors ${
                      showTokenWhitelist
                        ? "bg-primary/20 border-primary/40 text-primary"
                        : "bg-zinc-800/60 border-white/10 text-zinc-400 hover:border-zinc-500"
                    }`}
                  >
                    From Whitelist
                  </button>
                </div>

                {showTokenWhitelist ? (
                  <div className="space-y-1.5">
                    <select
                      id="token-select"
                      className="w-full bg-zinc-800/80 border border-white/10 rounded-md px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-primary/50"
                      value={newBotMintAddress}
                      onChange={(e) => setNewBotMintAddress(e.target.value)}
                    >
                      <option value="">-- Select Token --</option>
                      {tokens.map((token) => (
                        <option key={token.mintAddress} value={token.mintAddress}>
                          {token.name} ({token.symbol}) — {token.mintAddress.slice(0, 8)}…
                        </option>
                      ))}
                    </select>
                    {tokens.length === 0 && (
                      <p className="text-[11px] text-zinc-600">
                        ⚠ No tokens in whitelist. Add them in the Token tab first.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Input
                      id="mint"
                      placeholder="e.g. EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
                      value={newBotMintAddress}
                      onChange={(e) => setNewBotMintAddress(e.target.value)}
                      className="bg-zinc-800/80 border-white/10 text-zinc-100 placeholder:text-zinc-600 focus:border-primary/50"
                    />
                    <p className="text-[10px] text-zinc-600">
                      Solana SPL token mint address (Base58). Tracked via DexScreener.
                    </p>
                  </div>
                )}
              </div>

              {/* Wallet Address */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Wallet className="h-3.5 w-3.5 text-primary/70" />
                  <Label className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                    Wallet <span className="text-zinc-600 font-normal normal-case">(optional)</span>
                  </Label>
                </div>
                <Input
                  id="wallet"
                  placeholder="Your Solana public key"
                  value={newBotWalletAddress}
                  onChange={(e) => setNewBotWalletAddress(e.target.value)}
                  className="bg-zinc-800/80 border-white/10 text-zinc-100 placeholder:text-zinc-600 focus:border-primary/50"
                />
                <p className="text-[10px] text-zinc-600">
                  Display &amp; balance tracking only. Not required for paper trading.
                </p>
              </div>

              {/* Trading Amount */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5 text-primary/70" />
                  <Label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Trading Amount</Label>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setNewBotTradingMode("fixed")}
                    className={`flex-1 py-1.5 rounded text-xs font-bold border transition-colors ${
                      newBotTradingMode === "fixed"
                        ? "bg-primary/20 border-primary/40 text-primary"
                        : "bg-zinc-800/60 border-white/10 text-zinc-400 hover:border-zinc-500"
                    }`}
                  >
                    Fixed SOL
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewBotTradingMode("aggressive")}
                    className={`flex-1 py-1.5 rounded text-xs font-bold border transition-colors ${
                      newBotTradingMode === "aggressive"
                        ? "bg-primary/20 border-primary/40 text-primary"
                        : "bg-zinc-800/60 border-white/10 text-zinc-400 hover:border-zinc-500"
                    }`}
                  >
                    Aggressive %
                  </button>
                </div>

                {newBotTradingMode === "fixed" ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-3">
                      <Input
                        type="number"
                        min={0.01}
                        step={0.1}
                        value={newBotTradeSize}
                        onChange={(e) => setNewBotTradeSize(parseFloat(e.target.value) || 1)}
                        className="w-28 bg-zinc-800/80 border-white/10 text-zinc-100 focus:border-primary/50"
                      />
                      <span className="text-sm text-zinc-400">SOL per trade</span>
                    </div>
                    {walletBalance != null && (
                      <p className="text-[10px] text-zinc-500">
                        Verfügbar: <span className="font-mono text-cyan-300">{walletBalance.toFixed(4)} SOL</span>
                        {reserveCeiling != null && (
                          <> · Reserve-Ceiling: <span className="font-mono text-amber-300">{reserveCeiling.toFixed(4)} SOL</span> (90% bzw. −{SOL_RESERVE_FLOOR} SOL Reserve für SELL-Tx)</>
                        )}
                      </p>
                    )}
                    {fixedModeOverReserve && (
                      <p className="text-[10px] text-rose-400 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Trade-Größe überschreitet das Reserve-Ceiling — BUY wird vom Trader abgelehnt.
                      </p>
                    )}
                    <p className="text-[10px] text-zinc-600">
                      Fixed SOL amount used per signal.{" "}
                      <button
                        type="button"
                        onClick={() => { setNewBotTradingMode("aggressive"); setActiveTab("ai"); }}
                        className="text-cyan-400 hover:text-cyan-300 underline"
                      >
                        AI-gesteuerte Aggressivität aktivieren →
                      </button>
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {walletBalance != null && (
                      <p className="text-[10px] text-zinc-500">
                        Verfügbar: <span className="font-mono text-cyan-300">{walletBalance.toFixed(4)} SOL</span>
                        {reserveCeiling != null && (
                          <> · {newBotAggressiveness}% = <span className="font-mono text-amber-300">{(walletBalance * newBotAggressiveness / 100).toFixed(4)} SOL</span></>
                        )}
                      </p>
                    )}
                    {aggrOverReserve && (
                      <p className="text-[10px] text-rose-400 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Effektive Trade-Größe überschreitet das Reserve-Ceiling — BUY wird vom Trader abgelehnt.
                      </p>
                    )}
                    <p className="text-[10px] text-zinc-500">
                      AI-gesteuerte Positionsgröße aktiv.{" "}
                      <button
                        type="button"
                        onClick={() => setActiveTab("ai")}
                        className="text-cyan-400 hover:text-cyan-300 underline"
                      >
                        AI Optimization konfigurieren →
                      </button>
                    </p>
                  </div>
                )}

                {balanceMismatch && (
                  <div className="mt-1 p-2 rounded border border-amber-500/30 bg-amber-500/5 text-[10px] text-amber-300 flex items-start gap-1.5">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>
                      Die eingegebene Wallet-Adresse weicht von der primären Live-Wallet ab
                      (<code className="font-mono">{walletInfo?.address.slice(0, 6)}…{walletInfo?.address.slice(-4)}</code>).
                      Live-Trades signieren weiterhin mit dem globalen Keypair aus <code>.env</code>.
                    </span>
                  </div>
                )}
              </div>

            </div>

            {/* ━━━ RIGHT COLUMN ━━━ */}
            <div className="flex flex-col gap-5">

              {/* Strategy Picker */}
              <div className="space-y-2 flex-1">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-3.5 w-3.5 text-primary/70" />
                  <Label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Strategy</Label>
                </div>
                <StrategyChipPicker
                  strategyTemplates={strategyTemplates}
                  savedStrategies={savedStrategies}
                  selectedId={newBotStrategyId}
                  onSelect={setNewBotStrategyId}
                />
                {selectedStrategy?.description && (
                  <p className="text-[10px] text-zinc-500 border-l-2 border-primary/30 pl-2 mt-1">
                    {selectedStrategy.description}
                  </p>
                )}
                {!selectedStrategy && (
                  <p className="text-[10px] text-zinc-600 border-l-2 border-zinc-700 pl-2">
                    Standard Scalping: Detects short price spikes (floor-median deviation) and enters/exits quickly.
                  </p>
                )}

                {/* ADR-014: read-only advisor scalping recommendations */}
                {advisorSettings && (
                  <div className="mt-2 rounded-md border border-cyan-500/20 bg-cyan-500/5 p-2.5 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-cyan-300">
                      <Sparkles className="h-3 w-3" /> Advisor-Empfehlung (Scalping)
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {advisorSettings.spikeThreshold != null && (
                        <span className="px-1.5 py-0.5 rounded bg-zinc-800/80 border border-white/10 text-[10px] text-zinc-200 font-mono">
                          Spike ≥ {advisorSettings.spikeThreshold.toFixed(1)}%
                        </span>
                      )}
                      {advisorSettings.sellDropThreshold != null && (
                        <span className="px-1.5 py-0.5 rounded bg-zinc-800/80 border border-white/10 text-[10px] text-zinc-200 font-mono">
                          Drop ≥ {advisorSettings.sellDropThreshold.toFixed(1)}%
                        </span>
                      )}
                      {advisorSettings.cooldownTicks != null && (
                        <span className="px-1.5 py-0.5 rounded bg-zinc-800/80 border border-white/10 text-[10px] text-zinc-200 font-mono">
                          Cooldown {advisorSettings.cooldownTicks}t
                        </span>
                      )}
                      {advisorSettings.floorWindow != null && (
                        <span className="px-1.5 py-0.5 rounded bg-zinc-800/80 border border-white/10 text-[10px] text-zinc-200 font-mono">
                          Floor {advisorSettings.floorWindow}t
                        </span>
                      )}
                    </div>
                    <p className="text-[9px] text-zinc-500 leading-relaxed">
                      Diese Werte werden beim Erstellen als Bot-Settings übernommen. Nachträglich änderbar in den Bot-Details.
                    </p>
                  </div>
                )}
              </div>

            </div>

          </div>
        )}

        {/* ── AI OPTIMIZATION TAB ── */}
        {activeTab === "ai" && (
          <div className="space-y-5 py-2 relative">

            {/* Strategy Context */}
            <div className="rounded-md border border-cyan-500/20 bg-cyan-500/5 p-3 space-y-2">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-cyan-300">
                <TrendingUp className="h-3 w-3" /> Strategie-Kontext
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="px-2 py-0.5 rounded border bg-cyan-500/15 text-cyan-200 border-cyan-500/30 font-bold uppercase tracking-wider text-[10px]">
                  {strategyType}
                </span>
                <span className="text-zinc-400 text-xs">
                  {selectedStrategy?.strategy_name ?? "Standard Scalping (kein Template)"}
                </span>
              </div>

              {/* Indicators */}
              {indicators.length > 0 && (
                <div className="pt-1 border-t border-cyan-500/10">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1.5">
                    <Activity className="h-3 w-3" /> Indikatoren
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {indicators.map((ind, i) => (
                      <span
                        key={i}
                        className="px-1.5 py-0.5 rounded bg-zinc-800/80 border border-white/10 text-[10px] text-zinc-300 font-mono"
                      >
                        {ind.type.toUpperCase()}
                        {ind.period ? `(${ind.period})` : ""}
                        {ind.fast_period && ind.slow_period ? `(${ind.fast_period}/${ind.slow_period})` : ""}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* AI Hint */}
              <div className="flex items-start gap-2 pt-1 border-t border-cyan-500/10">
                <Sparkles className="h-3.5 w-3.5 text-cyan-300 mt-0.5 shrink-0" />
                <p className="text-[10px] text-zinc-400 leading-relaxed">
                  <span className="font-bold text-cyan-300">Empfehlung:</span> {aiHint.reason}
                </p>
              </div>
            </div>

            {/* Trading Mode */}
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                <Zap className="h-3.5 w-3.5 text-cyan-300" />
                Trading Modus
              </Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setNewBotTradingMode("fixed")}
                  className={`flex-1 py-1.5 rounded text-xs font-bold border transition-colors ${
                    newBotTradingMode === "fixed"
                      ? "bg-zinc-700/80 border-zinc-500 text-zinc-200"
                      : "bg-zinc-800/60 border-white/10 text-zinc-500 hover:border-zinc-500"
                  }`}
                >
                  Fixed SOL (kein AI)
                </button>
                <button
                  type="button"
                  onClick={() => setNewBotTradingMode("aggressive")}
                  className={`flex-1 py-1.5 rounded text-xs font-bold border transition-colors ${
                    newBotTradingMode === "aggressive"
                      ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-300"
                      : "bg-zinc-800/60 border-white/10 text-zinc-500 hover:border-zinc-500"
                  }`}
                >
                  AI Aggressivität %
                </button>
              </div>
            </div>

            {/* Aggressiveness Slider */}
            <div className={`space-y-3 transition-opacity duration-200 ${newBotTradingMode !== "aggressive" ? "opacity-40 pointer-events-none" : ""}`}>
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                  <Sliders className="h-3.5 w-3.5 text-cyan-300" />
                  Max Aggressivität (User Ceiling)
                </Label>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold uppercase tracking-wider ${sem.tone}`}>
                    {sem.label}
                  </span>
                  <span className="text-sm font-mono font-black text-cyan-300 tabular-nums w-12 text-right">
                    {newBotAggressiveness}%
                  </span>
                </div>
              </div>

              <input
                type="range"
                min={1}
                max={100}
                step={1}
                value={newBotAggressiveness}
                onChange={(e) => setNewBotAggressiveness(parseInt(e.target.value, 10))}
                className="w-full accent-cyan-400 cursor-pointer"
                aria-label="Max Aggressivität"
              />
              <div className="h-[3px] w-full bg-muted/40 rounded-full overflow-hidden">
                <div
                  className={`h-full bg-gradient-to-r ${sem.barColor} transition-all duration-200`}
                  style={{ width: `${newBotAggressiveness}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[10px] text-zinc-600">
                <span>1% — Minimal</span>
                <button
                  type="button"
                  onClick={applyRecommended}
                  className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 font-bold transition-colors"
                >
                  <Sparkles className="h-3 w-3" />
                  Empfehlung anwenden ({aiHint.recommended}%)
                </button>
                <span>100% — Max</span>
              </div>

              <p className="text-[10px] text-zinc-500 leading-relaxed">
                <span className="font-bold text-zinc-400">Max {newBotAggressiveness}%</span> des Wallet-Guthabens pro Trade.
                Die AI (Ollama) setzt die <em>effektive</em> Aggressivität innerhalb dieser Grenze — niemals darüber.
              </p>
            </div>

            {/* Fixed SOL fallback */}
            {newBotTradingMode === "fixed" && (
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                  SOL per Trade (Fixed)
                </Label>
                <div className="flex items-center gap-3">
                  <Input
                    type="number"
                    min={0.01}
                    step={0.1}
                    value={newBotTradeSize}
                    onChange={(e) => setNewBotTradeSize(parseFloat(e.target.value) || 1)}
                    className="w-28 bg-zinc-800/80 border-white/10 text-zinc-100 focus:border-primary/50"
                  />
                  <span className="text-sm text-zinc-400">SOL per trade</span>
                </div>
              </div>
            )}

            {/* Info */}
            <div className="flex items-start gap-2 text-[10px] text-zinc-500 leading-relaxed">
              <ShieldCheck className="h-3.5 w-3.5 text-cyan-400 mt-0.5 shrink-0" />
              <span>
                Die AI-Aggressivität (5–80%) wird nach jeder Analyse von Ollama gesetzt.
                Der hier konfigurierte Wert ist die <em>maximale Obergrenze</em> — die AI
                kann nicht aggressiver handeln als erlaubt. Nach Erstellung kannst du
                über <strong>Oracle Analysis</strong> in den Bot-Details eine sofortige
                AI-Analyse triggern.
              </span>
            </div>

          </div>
        )}

        <DialogFooter className="relative border-t border-white/5 pt-4 mt-1">
          {/* Start after create toggle */}
          <label className="flex items-center gap-2.5 flex-1 cursor-pointer group select-none">
            <button
              type="button"
              role="switch"
              aria-checked={startAfterCreate}
              onClick={() => setStartAfterCreate(!startAfterCreate)}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 transition-colors duration-200 focus-visible:outline-none ${
                startAfterCreate
                  ? "bg-emerald-500 border-emerald-400"
                  : "bg-zinc-700 border-zinc-600"
              }`}
            >
              <span
                className={`block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  startAfterCreate ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
            <div className="flex items-center gap-1.5">
              <Play className={`h-3 w-3 transition-colors ${startAfterCreate ? "text-emerald-400" : "text-zinc-600"}`} />
              <span className={`text-xs font-bold transition-colors ${startAfterCreate ? "text-emerald-300" : "text-zinc-500"}`}>
                Bot direkt starten
              </span>
            </div>
            <span className="text-[10px] text-zinc-600 group-hover:text-zinc-500 transition-colors ml-1">
              {startAfterCreate ? "Startet automatisch nach Erstellung" : "Manuell starten"}
            </span>
          </label>

          <Button
            onClick={onCreateBot}
            className="bg-primary text-primary-foreground hover:bg-primary/80 font-bold"
          >
            <Bot className="h-4 w-4 mr-2" />
            {startAfterCreate ? "Create & Start" : "Create Agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
