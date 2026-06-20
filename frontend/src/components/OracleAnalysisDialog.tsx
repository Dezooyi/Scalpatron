import { useMemo, useState } from "react";
import {
  BrainCircuit,
  Loader2,
  Sliders,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { AgentAdviceEntry, BotSettings, BotState } from "@/App";

export interface OracleAnalysisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bot: BotState | null;
  /** Latest known advice for this bot (used for live diff preview). */
  latestAdvice: AgentAdviceEntry["advice"] | null;
  /** Available strategy templates + saved strategies. */
  availableStrategies: { id: string; strategy_name: string; strategy_type: string }[];
  /** True while the trigger request is in flight. */
  isTriggering: boolean;
  /** Confirm handler — receives force multiplier in [0, 100]. */
  onConfirm: (multiplier: number) => void;
  /** Initial multiplier value pre-seeded from the Bot Details Preset slider (0–100). */
  initialMultiplier?: number;
}

const NUMERIC_KEYS: (keyof BotSettings)[] = [
  "floorWindow",
  "spikeThreshold",
  "sellDropThreshold",
  "cooldownTicks",
];

function labelForKey(k: keyof BotSettings): string {
  switch (k) {
    case "floorWindow": return "Floor Window";
    case "spikeThreshold": return "Spike Threshold";
    case "sellDropThreshold": return "Sell Drop";
    case "cooldownTicks": return "Cooldown";
    default: return String(k);
  }
}

function semanticLabel(pct: number): { label: string; tone: string; barColor: string } {
  if (pct <= 0)  return { label: "Beobachten",    tone: "text-emerald-300", barColor: "from-emerald-500 to-emerald-300" };
  if (pct <= 20) return { label: "Sehr leicht",   tone: "text-emerald-300", barColor: "from-emerald-500 to-emerald-300" };
  if (pct <= 45) return { label: "Leicht",        tone: "text-cyan-300",    barColor: "from-cyan-500 to-cyan-300" };
  if (pct <= 70) return { label: "Moderat",       tone: "text-cyan-200",    barColor: "from-cyan-500 to-cyan-300" };
  if (pct <= 90) return { label: "Stark",         tone: "text-amber-300",   barColor: "from-amber-500 to-amber-300" };
  return         { label: "Maximal",           tone: "text-rose-300",    barColor: "from-rose-500 to-rose-300" };
}

export function OracleAnalysisDialog({
  open,
  onOpenChange,
  bot,
  latestAdvice,
  availableStrategies,
  isTriggering,
  onConfirm,
  initialMultiplier,
}: OracleAnalysisDialogProps) {
  const [multiplier, setMultiplier] = useState(initialMultiplier ?? 60);

  // Default-reset is handled by the parent remounting the dialog with a fresh
  // `key` whenever `open` transitions from false → true.

  const currentSettings = bot?.settings;
  const currentAggr = bot?.aiAggressiveness ?? bot?.aggressiveness ?? 10;
  const targetAggr = latestAdvice?.adjustedSettings ? undefined : undefined; // not exposed in frontend advice

  const sem = semanticLabel(multiplier);
  const mix = multiplier / 100;

  const previewRows = useMemo(() => {
    if (!currentSettings || !latestAdvice?.adjustedSettings) return [];
    const out: { key: keyof BotSettings; label: string; current: number; blended: number; target: number | null }[] = [];
    for (const k of NUMERIC_KEYS) {
      const cur = currentSettings[k];
      const tgt = latestAdvice.adjustedSettings[k];
      if (typeof cur !== "number") continue;
      if (typeof tgt !== "number") continue;
      const blended = multiplier === 0 ? cur : multiplier === 100 ? tgt : cur + (tgt - cur) * mix;
      out.push({ key: k, label: labelForKey(k), current: cur, blended, target: tgt });
    }
    return out;
  }, [currentSettings, latestAdvice, multiplier, mix]);

  const handleConfirm = () => onConfirm(multiplier);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-[640px] bg-black/85 backdrop-blur-2xl border-cyan-500/20 text-zinc-100 shadow-2xl">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/60 to-transparent pointer-events-none" />
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-cyan-500/8 to-transparent pointer-events-none rounded-t-lg" />

        <DialogHeader className="relative">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-cyan-500/10 rounded-lg border border-cyan-500/30">
              <BrainCircuit className="h-5 w-5 text-cyan-300" />
            </div>
            <div>
              <DialogTitle className="text-lg font-black tracking-tight flex items-center gap-2">
                Oracle Analysis auslösen
                <Sparkles className="h-4 w-4 text-cyan-300" />
              </DialogTitle>
              <DialogDescription className="text-zinc-500 text-xs mt-0.5">
                Wähle, wie stark die AI-Empfehlung auf die aktuelle Strategie angewendet werden soll.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 py-2 relative">
          {/* Strategy context */}
          <div className="rounded-md border border-cyan-500/20 bg-cyan-500/5 p-3 space-y-2">
            <div className="flex items-center gap-2 text-3xs font-bold uppercase tracking-wider text-cyan-300">
              <TrendingUp className="h-3 w-3" /> Aktive Strategie
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="px-2 py-0.5 rounded border bg-cyan-500/15 text-cyan-200 border-cyan-500/30 font-bold uppercase tracking-wider text-3xs">
                {bot?.strategyType ?? "scalping"}
              </span>
              <span className="text-zinc-400 text-xs">
                {bot?.name ?? "—"}
              </span>
            </div>
            {availableStrategies.length > 0 && (
              <div className="text-[10px] text-zinc-500 pt-1 border-t border-cyan-500/10">
                <span className="font-bold uppercase tracking-wider mr-1">Verfügbar:</span>
                {availableStrategies
                  .map((s) => s.strategy_type)
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .slice(0, 6)
                  .join(" · ")}
              </div>
            )}
          </div>

          {/* Slider */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                <Sliders className="h-3.5 w-3.5 text-cyan-300" />
                Aggressivität der erzwungenen Änderung
              </Label>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold uppercase tracking-wider ${sem.tone}`}>
                  {sem.label}
                </span>
                <span className="text-sm font-mono font-black text-cyan-300 tabular-nums w-12 text-right">
                  {multiplier}%
                </span>
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={multiplier}
              onChange={(e) => setMultiplier(parseInt(e.target.value, 10))}
              className="w-full accent-cyan-400 cursor-pointer"
              aria-label="Aggressivität der erzwungenen Änderung"
            />
            <div className="h-[3px] w-full bg-muted/40 rounded-full overflow-hidden">
              <div
                className={`h-full bg-gradient-to-r ${sem.barColor} transition-all duration-200`}
                style={{ width: `${multiplier}%` }}
              />
            </div>
            <p className="text-[10px] text-zinc-500 leading-relaxed">
              <span className="font-bold text-zinc-400">0%</span> = nur beobachten (AI-Output wird geloggt, keine Settings übernommen).{" "}
              <span className="font-bold text-zinc-400">1–99%</span> = lineare Mischung aus aktuellen Werten und AI-Empfehlung.{" "}
              <span className="font-bold text-zinc-400">100%</span> = volle Übernahme (Standard, sofern Auto-Apply aktiv und Confidence reicht).
            </p>
          </div>

          {/* Live diff preview */}
          <div className="rounded-md border border-white/10 bg-zinc-900/40 p-3 space-y-2">
            <div className="flex items-center gap-2 text-3xs font-bold uppercase tracking-wider text-zinc-400">
              <Zap className="h-3 w-3 text-cyan-300" /> Vorschau (Top Parameter)
            </div>
            {previewRows.length > 0 ? (
              <div className="space-y-1 font-mono text-xs">
                {previewRows.map((row) => (
                  <div key={row.key} className="flex items-center gap-2">
                    <span className="w-28 shrink-0 text-zinc-500">{row.label}</span>
                    <span className="text-zinc-300 tabular-nums">
                      {row.current.toFixed(row.key === "cooldownTicks" || row.key === "floorWindow" ? 0 : 3)}
                    </span>
                    <span className="text-zinc-600">→</span>
                    <span className="text-cyan-300 tabular-nums font-bold">
                      {row.blended.toFixed(row.key === "cooldownTicks" || row.key === "floorWindow" ? 0 : 3)}
                    </span>
                    {row.target !== null && multiplier !== 100 && (
                      <span className="text-zinc-600 text-[10px] ml-auto">
                        (Ziel: {row.target.toFixed(row.key === "cooldownTicks" || row.key === "floorWindow" ? 0 : 3)})
                      </span>
                    )}
                  </div>
                ))}
                <div className="flex items-center gap-2 pt-1 border-t border-white/5">
                  <span className="w-28 shrink-0 text-zinc-500">Aggressiveness</span>
                  <span className="text-zinc-300 tabular-nums">{currentAggr}%</span>
                  <span className="text-zinc-600">→</span>
                  <span className="text-cyan-300 tabular-nums font-bold">
                    {multiplier === 0
                      ? `${currentAggr}%`
                      : Math.round(currentAggr + ((typeof targetAggr === "number" ? targetAggr : currentAggr) - currentAggr) * mix)}%
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-[10px] text-zinc-500 italic">
                Vorschau erscheint nach erster AI-Analyse. Strategie-Typ-Wechsel wird weiterhin separat bestätigt.
              </p>
            )}
          </div>

          <div className="flex items-start gap-2 text-[10px] text-zinc-500 leading-relaxed">
            <ShieldCheck className="h-3.5 w-3.5 text-cyan-400 mt-0.5 shrink-0" />
            <span>
              Die Anfrage wird mit dem gewählten Multiplikator an{" "}
              <code className="text-cyan-300/80">POST /api/agent/trigger</code> gesendet. Strategie-Typ-Wechsel erfordern
              unabhängig vom Multiplikator weiterhin eine separate UI-Bestätigung.
            </span>
          </div>
        </div>

        <DialogFooter className="relative border-t border-white/5 pt-4 mt-1 gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isTriggering}
            className="text-zinc-400 hover:text-zinc-100"
          >
            Abbrechen
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={isTriggering}
            className="bg-cyan-500/30 hover:bg-cyan-500/50 text-cyan-100 hover:text-white border border-cyan-500/50 hover:border-cyan-400 font-bold"
          >
            {isTriggering ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <BrainCircuit className="h-4 w-4 mr-2" />
            )}
            {isTriggering ? "Analyzing…" : `Trigger mit ${multiplier}%`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
