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
import { Wallet, Coins, Bot, Zap, TrendingUp, RefreshCw } from "lucide-react";
import { useEffect } from "react";

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
}

interface CreateBotDialogProps {
  /** Controlled open state */
  open?: boolean;
  /** Controlled open state change handler */
  onOpenChange?: (open: boolean) => void;
  /** If true, the DialogTrigger renders as a hidden anchor (controlled externally) */
  hiddenTrigger?: boolean;
  /** Optional custom trigger element */
  trigger?: React.ReactNode;
  tokens: Token[];
  strategyTemplates: StrategyItem[];
  savedStrategies: StrategyItem[];
  // Form state
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
  onCreateBot: () => void;
}

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
  onCreateBot,
}: CreateBotDialogProps) {
  const allStrategies = [...strategyTemplates, ...savedStrategies];
  const selectedStrategy = allStrategies.find((t) => t.id === newBotStrategyId);

  // Auto-generate name if empty
  useEffect(() => {
    if (!newBotName && open) {
      const randomId = Math.random().toString(36).substring(2, 7).toUpperCase();
      setNewBotName(`Agent-${randomId}`);
    }
  }, [open]);

  const generateNewName = () => {
    const randomId = Math.random().toString(36).substring(2, 7).toUpperCase();
    setNewBotName(`Agent-${randomId}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {hiddenTrigger ? (
          <button className="Create Bot hidden sr-only" aria-hidden tabIndex={-1} />
        ) : (
          trigger ?? <button className="Create Bot hidden sr-only" aria-hidden tabIndex={-1} />
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-[500px] bg-black/85 backdrop-blur-2xl border-white/10 text-zinc-100 shadow-2xl overflow-y-auto max-h-[90vh]">
        {/* Gradient glow at the top */}
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
        </DialogHeader>

        <div className="space-y-5 py-2 relative">
          {/* ── Bot Name ── */}
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
                className="bg-zinc-800/80 border-white/10 text-zinc-400 hover:text-primary"
                title="Random Name"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* ── Token Selection ── */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Coins className="h-3.5 w-3.5 text-primary/70" />
              <Label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Token</Label>
            </div>
            <div className="flex gap-2 mb-2">
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
                  <p className="text-[11px] text-zinc-600 flex items-center gap-1">
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
                  Solana SPL token mint address (Base58). The bot tracks the price of this token via DexScreener.
                </p>
              </div>
            )}
          </div>

          {/* ── Wallet Address ── */}
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
              Only for display & balance tracking. Not required for paper trading.
            </p>
          </div>

          {/* ── Trading Amount ── */}
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
                <p className="text-[10px] text-zinc-600">Fixed amount in SOL to be used per signal.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-zinc-400">
                  <span>Max Aggressiveness</span>
                  <span className="font-bold text-primary">{newBotAggressiveness}%</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={newBotAggressiveness}
                  onChange={(e) => setNewBotAggressiveness(parseInt(e.target.value))}
                  className="w-full accent-primary"
                />
                <p className="text-[10px] text-zinc-600">
                  The bot will use up to {newBotAggressiveness}% of the wallet balance per trade. Higher values = higher risk.
                </p>
              </div>
            )}
          </div>

          {/* ── Strategy Picker ── */}
          <div className="space-y-2">
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
          </div>
        </div>

        <DialogFooter className="relative border-t border-white/5 pt-4 mt-1">
          <p className="text-[10px] text-zinc-600 flex-1 self-center">
            The bot starts in <span className="text-zinc-400 font-bold">Paper Trading</span> mode (no real SOL).
          </p>
          <Button
            onClick={onCreateBot}
            className="bg-primary text-primary-foreground hover:bg-primary/80 font-bold"
          >
            <Bot className="h-4 w-4 mr-2" /> Create Agent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
