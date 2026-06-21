import { Puzzle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { getStrategyIcon, getStrategyColor } from "@/lib/botUtils";

type IndicatorDef = {
  type: string;
  period?: number;
};

export type StrategyTemplate = {
  id: string;
  strategy_name: string;
  strategy_type: string;
  description?: string;
  isTemplate?: boolean;
  indicators?: IndicatorDef[];
  system_prompt?: string;
};

export type StrategyConfig = {
  id?: string;
  strategy_name: string;
  strategy_type: string;
  description?: string;
  system_prompt?: string;
  isTemplate?: boolean;
  [key: string]: unknown;
};

export interface StrategiesTabProps {
  strategySubTab: "templates" | "saved" | "editor";
  setStrategySubTab: (v: "templates" | "saved" | "editor") => void;
  strategyFilter: string;
  setStrategyFilter: (v: string) => void;
  strategyTemplates: StrategyTemplate[];
  savedStrategies: StrategyConfig[];
  setSavedStrategies: (v: StrategyConfig[] | ((prev: StrategyConfig[]) => StrategyConfig[])) => void;
  strategyEditorJson: string;
  setStrategyEditorJson: (v: string) => void;
  strategyEditorSystemPrompt: string;
  setStrategyEditorSystemPrompt: (v: string) => void;
  strategyEditorError: string;
  setStrategyEditorError: (v: string) => void;
  strategyEditorValid: boolean;
  setStrategyEditorValid: (v: boolean) => void;
  strategySaveStatus: "idle" | "saving" | "saved" | "error";
  setStrategySaveStatus: (v: "idle" | "saving" | "saved" | "error") => void;
  getApiBase: () => string;
}

export function StrategiesTab({
  strategySubTab,
  setStrategySubTab,
  strategyFilter,
  setStrategyFilter,
  strategyTemplates,
  savedStrategies,
  setSavedStrategies,
  strategyEditorJson,
  setStrategyEditorJson,
  strategyEditorSystemPrompt,
  setStrategyEditorSystemPrompt,
  strategyEditorError,
  setStrategyEditorError,
  strategyEditorValid,
  setStrategyEditorValid,
  strategySaveStatus,
  setStrategySaveStatus,
  getApiBase,
}: StrategiesTabProps) {
  return (
    <div className="space-y-6 animate-in fade-in duration-300 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Puzzle className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-3xl font-bold tracking-tighter">Strategien</h1>
          <p className="text-muted-foreground mt-1">Strategy Management — Templates, eigene Strategien, JSON-Editor</p>
        </div>
      </div>

      {/* Sub-Tab Bar */}
      <div className="flex gap-1 bg-zinc-900/60 border border-white/10 rounded-lg p-1 w-fit">
        {(["templates", "saved", "editor"] as const).map(tab => (
          <button key={tab} onClick={() => setStrategySubTab(tab)}
            className={`px-4 py-1.5 rounded text-xs font-semibold transition-colors ${strategySubTab === tab ? "bg-primary text-black" : "text-zinc-400 hover:text-white"}`}>
            {tab === "templates" ? "Templates" : tab === "saved" ? "Gespeichert" : "Neu erstellen"}
          </button>
        ))}
      </div>

      {strategySubTab === "templates" && (
        <div className="space-y-4">
          {/* Filter chips */}
          <div className="flex flex-wrap gap-2">
            {["all", "scalping", "scalping-adaptive", "trend", "mean_reversion", "breakout", "momentum", "dca", "grid", "ml", "paet"].map(f => (
              <button key={f} onClick={() => setStrategyFilter(f)}
                className={`px-3 py-1 rounded-full text-sm-custom font-semibold border transition-colors ${strategyFilter === f ? "bg-primary/20 border-primary text-primary" : "border-zinc-700 text-zinc-400 hover:border-zinc-500"}`}>
                {f === "all" ? "Alle" : f}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {strategyTemplates
              .filter(t => strategyFilter === "all" || t.strategy_type === strategyFilter)
              .map(t => (
                <Card key={t.id} className="border-white/10 bg-zinc-900/60">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-white">{t.strategy_name}</span>
                      <span className={`flex items-center gap-1 text-xs-custom font-bold px-2 py-0.5 rounded border ${getStrategyColor(t.strategy_type)}`}>
                        {getStrategyIcon(t.strategy_type, "h-2.5 w-2.5")}
                        {t.strategy_type}
                      </span>
                    </div>
                    {t.description && <p className="text-sm-custom text-zinc-500">{t.description}</p>}
                    <div className="flex flex-wrap gap-1">
                      {t.indicators?.map((ind) => (
                        <span key={`${ind.type}_${ind.period ?? ''}`} className="text-xs-custom bg-muted text-muted-foreground border border-border px-1.5 py-0.5 rounded font-mono">
                          {ind.type}{ind.period ? `(${ind.period})` : ""}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t border-border/30">
                      <p className="text-xs-custom text-zinc-600">Zuweisung beim Bot-Erstellen</p>
                      <button
                        className="text-sm-custom px-3 py-1 rounded bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 font-semibold transition-colors"
                        onClick={() => {
                          const full = t as Record<string, unknown>;
                          const skip = new Set(['id', 'isTemplate', 'createdAt', 'system_prompt']);
                          const rest = Object.fromEntries(Object.entries(full).filter(([k]) => !skip.has(k)));
                          setStrategyEditorJson(JSON.stringify(rest, null, 2));
                          setStrategyEditorSystemPrompt((full.system_prompt as string) ?? '');
                          setStrategyEditorError('');
                          setStrategyEditorValid(false);
                          setStrategySubTab('editor');
                        }}
                      >Als Basis verwenden →</button>
                    </div>
                  </CardContent>
                </Card>
              ))}
          </div>
        </div>
      )}

      {strategySubTab === "saved" && (
        <div className="space-y-4">
          {savedStrategies.filter(s => !s.isTemplate).length === 0 ? (
            <div className="text-center py-12 text-zinc-500 text-sm">
              Noch keine eigenen Strategien gespeichert.<br />
              <button onClick={() => setStrategySubTab("editor")} className="mt-2 text-primary hover:underline text-xs">Jetzt eine erstellen →</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {savedStrategies.filter(s => !s.isTemplate).map(s => (
                <Card key={s.id} className="border-white/10 bg-zinc-900/60">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-white">{s.strategy_name}</span>
                      <span className={`flex items-center gap-1 text-xs-custom font-bold px-2 py-0.5 rounded border ${getStrategyColor(s.strategy_type)}`}>
                        {getStrategyIcon(s.strategy_type, "h-2.5 w-2.5")}
                        {s.strategy_type}
                      </span>
                    </div>
                    <div className="flex gap-2 mt-2">
                      <button
                        className="text-sm-custom px-3 py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700"
                        onClick={() => {
                          setStrategyEditorJson(JSON.stringify(s, null, 2));
                          setStrategySubTab("editor");
                        }}
                      >Bearbeiten</button>
                      <button
                        className="text-sm-custom px-3 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30"
                        onClick={() => {
                          fetch(`${getApiBase()}/api/strategies/${s.id}`, { method: "DELETE" })
                            .then(() => setSavedStrategies(prev => prev.filter(x => x.id !== s.id)));
                        }}
                      >Löschen</button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {strategySubTab === "editor" && (
        <div className="space-y-4 max-w-2xl">
          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase text-zinc-400">Strategie JSON</Label>
            <p className="text-sm-custom text-zinc-500">Definiere eine Strategie im JSON-Format. Pflichtfelder: strategy_name, strategy_type, market, indicators, entry_conditions, exit_conditions, risk_management, execution.</p>
            <textarea
              rows={20}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs font-mono text-zinc-200 focus:outline-none focus:border-primary/50 resize-none"
              placeholder={`{\n  "strategy_name": "Meine Strategie",\n  "strategy_type": "trend",\n  "market": { "symbol": "UGOR/SOL", "timeframe": "5m", "exchange": "solana" },\n  "indicators": [{ "type": "EMA", "period": 20 }, { "type": "EMA", "period": 50 }],\n  "entry_conditions": [{ "left": "EMA_20", "operator": ">", "right": "EMA_50" }],\n  "exit_conditions": [{ "type": "take_profit", "value": 0.05 }, { "type": "stop_loss", "value": 0.02 }],\n  "risk_management": { "position_size": 0.1, "max_positions": 1, "leverage": 1 },\n  "execution": { "order_type": "market", "slippage_tolerance": 0.001 }\n}`}
              value={strategyEditorJson}
              onChange={(e) => {
                setStrategyEditorJson(e.target.value);
                setStrategyEditorError("");
                setStrategyEditorValid(false);
              }}
            />
            {strategyEditorError && <p className="text-sm-custom text-red-400">{strategyEditorError}</p>}
            {strategyEditorValid && <p className="text-sm-custom text-emerald-400">✓ JSON valid</p>}
          </div>

          {/* Optional: Custom System Prompt for this strategy */}
          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase text-zinc-400">System Prompt (optional)</Label>
            <p className="text-sm-custom text-zinc-500">
              Benutzerdefinierter Ollama-System-Prompt für diese Strategie. Leer lassen = auto-generiert aus Strategie-Typ.
            </p>
            <textarea
              rows={6}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs font-mono text-zinc-200 focus:outline-none focus:border-primary/50 resize-y"
              placeholder={`Du bist ein Trading-Agent für die ${"${strategy_type}"}-Strategie...\n\nDeine Aufgabe: ...`}
              value={strategyEditorSystemPrompt}
              onChange={e => setStrategyEditorSystemPrompt(e.target.value)}
            />
          </div>

          <div className="flex gap-2">
            <button
              className="px-4 py-2 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700 text-xs font-semibold"
              onClick={() => {
                try {
                  JSON.parse(strategyEditorJson);
                  setStrategyEditorValid(true);
                  setStrategyEditorError("");
                } catch (e: unknown) {
                  setStrategyEditorError("JSON Fehler: " + (e instanceof Error ? e.message : String(e)));
                  setStrategyEditorValid(false);
                }
              }}
            >Validieren</button>
            <button
              disabled={strategySaveStatus === "saving"}
              className="px-4 py-2 rounded bg-primary text-black hover:bg-primary/80 text-xs font-bold disabled:opacity-50"
              onClick={async () => {
                try {
                  const parsed = JSON.parse(strategyEditorJson);
                  if (strategyEditorSystemPrompt.trim()) {
                    parsed.system_prompt = strategyEditorSystemPrompt.trim();
                  }
                  setStrategySaveStatus("saving");
                  const res = await fetch(`${getApiBase()}/api/strategies`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(parsed),
                  });
                  if (!res.ok) throw new Error(await res.text());
                  setStrategySaveStatus("saved");
                  setStrategyEditorJson("");
                  setStrategyEditorSystemPrompt("");
                  fetch(`${getApiBase()}/api/strategies`)
                    .then(r => r.json()).then(d => { if (Array.isArray(d)) setSavedStrategies(d); });
                  setTimeout(() => setStrategySaveStatus("idle"), 2000);
                } catch (e: unknown) {
                  setStrategyEditorError(e instanceof Error ? e.message : String(e));
                  setStrategySaveStatus("error");
                  setTimeout(() => setStrategySaveStatus("idle"), 3000);
                }
              }}
            >
              {strategySaveStatus === "saving" ? "Speichern..." : strategySaveStatus === "saved" ? "✓ Gespeichert" : "Strategie speichern"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
