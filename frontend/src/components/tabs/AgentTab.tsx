import { BrainCircuit, Play, Square, Zap, Settings } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getStrategyIcon, getStrategyColor } from "@/lib/botUtils";
import type { AgentHistoryEntry, BotState } from "@/App";

type RegimePerformance = {
  regime: string;
  winRate: number;
  avgPnl: number;
  totalTrades: number;
};

type AgentStatus = {
  running: boolean;
  model?: string;
  regime?: string;
};

type AgentConfigType = {
  provider?: 'ollama' | 'opencode';
  model: string;
  cycleMinutes: number;
  temperature: number;
  maxTokens: number;
  minConfidence: number;
  autoApply: boolean;
  systemPrompt: string;
};

type SystemPromptInfo = {
  source: 'custom' | 'strategy' | 'auto';
  effectivePrompt: string;
  autoPrompt: string;
  strategyPrompt: string | null;
  customPrompt: string | null;
  strategyName: string | null;
  strategyType: string;
};

export interface AgentTabProps {
  agentStatus: AgentStatus | null;
  agentConfig: AgentConfigType | null;
  agentHistory: AgentHistoryEntry[];
  agentModels: string[];
  regimePerformance: RegimePerformance[];
  bots: BotState[];
  selectedHistoryBot: string;
  setSelectedHistoryBot: (v: string) => void;
  configStatus: string;
  assistentBotId: string;
  setAssistentBotId: (v: string) => void;
  assistentPromptInfo: SystemPromptInfo | null;
  setAssistentPromptInfo: (v: SystemPromptInfo | null) => void;
  assistentEditMode: boolean;
  setAssistentEditMode: (v: boolean) => void;
  assistentEditValue: string;
  setAssistentEditValue: (v: string) => void;
  assistentSaveStatus: "idle" | "saving" | "saved" | "error";
  setAssistentSaveStatus: (v: "idle" | "saving" | "saved" | "error") => void;
  startAgent: () => void;
  stopAgent: () => void;
  triggerAgentAnalysis: () => void;
  loadAgentModels: () => void;
  updateAgentConfig: (cfg: AgentConfigType) => void;
  getApiBase: () => string;
}

export function AgentTab({
  agentStatus,
  agentConfig,
  agentHistory,
  agentModels,
  regimePerformance,
  bots,
  selectedHistoryBot,
  setSelectedHistoryBot,
  configStatus,
  assistentBotId,
  setAssistentBotId,
  assistentPromptInfo,
  setAssistentPromptInfo,
  assistentEditMode,
  setAssistentEditMode,
  assistentEditValue,
  setAssistentEditValue,
  assistentSaveStatus,
  setAssistentSaveStatus,
  startAgent,
  stopAgent,
  triggerAgentAnalysis,
  loadAgentModels,
  updateAgentConfig,
  getApiBase,
}: AgentTabProps) {
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <BrainCircuit className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-3xl font-bold tracking-tighter">Strategy Assistant</h1>
          <p className="text-muted-foreground mt-1">
            Lokaler LLM-Agent (Ollama) analysiert den Markt zyklisch und passt Pattern Detection Settings dynamisch an.
          </p>
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${agentStatus?.running ? 'text-green-500' : 'text-red-500'}`}>
              {agentStatus?.running ? '● Laufend' : '○ Gestoppt'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Modell</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-400">
              {agentStatus?.model || agentConfig?.model || '--'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Regime</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-cyan-400">
              {agentStatus?.regime || '--'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Analysen</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {agentHistory.length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Control Buttons */}
      <div className="flex gap-3">
        <Button
          variant="default"
          className="bg-green-600 hover:bg-green-700"
          onClick={startAgent}
          disabled={agentStatus?.running}
        >
          <Play className="mr-2 h-4 w-4" /> Agent Starten
        </Button>
        <Button
          variant="destructive"
          onClick={stopAgent}
          disabled={!agentStatus?.running}
        >
          <Square className="mr-2 h-4 w-4" /> Stoppen
        </Button>
        <Button
          variant="secondary"
          className="bg-purple-600 hover:bg-purple-700 text-white"
          onClick={triggerAgentAnalysis}
        >
          <Zap className="mr-2 h-4 w-4" /> Jetzt Analysieren
        </Button>
        {configStatus && (
          <span className="text-sm text-muted-foreground self-center">{configStatus}</span>
        )}
      </div>

      {/* Configuration Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" /> Konfiguration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Provider</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={agentConfig?.provider || 'ollama'}
                onChange={(e) => agentConfig && updateAgentConfig({ ...agentConfig, provider: e.target.value as 'ollama' | 'opencode' })}
              >
                <option value="ollama">Ollama (Lokal / API)</option>
                <option value="opencode">Opencode (Lokal / CLI)</option>
              </select>
            </div>

            {/* Model Selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium">LLM Modell</label>
              <div className="flex gap-2">
                <select
                  id="agentModel"
                  className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
                  value={agentConfig?.model || ''}
                  disabled={agentConfig?.provider === 'opencode'}
                  onChange={(e) => agentConfig && updateAgentConfig({ ...agentConfig, model: e.target.value })}
                >
                  {agentConfig?.provider === 'opencode' ? (
                    <option value="">Lokal Konfiguriertes Modell (Opencode)</option>
                  ) : agentModels.length === 0 ? (
                    <option value="">Lade Modelle...</option>
                  ) : (
                    agentModels.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))
                  )}
                </select>
                <Button variant="outline" size="sm" onClick={loadAgentModels} disabled={agentConfig?.provider === 'opencode'}>
                  &#8635;
                </Button>
              </div>
            </div>

            {/* Cycle Minutes */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Zyklus (Minuten)</label>
              <input
                type="number"
                min="1"
                max="120"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={agentConfig?.cycleMinutes || 21}
                onChange={(e) => agentConfig && updateAgentConfig({ ...agentConfig, cycleMinutes: parseInt(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">Wie oft analysiert wird</p>
            </div>

            {/* Temperature */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Temperature: {agentConfig ? (agentConfig.temperature / 100).toFixed(2) : '0.30'}</label>
              <input
                type="range"
                min="0"
                max="100"
                className="w-full"
                value={agentConfig?.temperature || 30}
                onChange={(e) => agentConfig && updateAgentConfig({ ...agentConfig, temperature: parseInt(e.target.value) })}
              />
            </div>

            {/* Max Tokens */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Max Tokens</label>
              <input
                type="number"
                min="128"
                max="2048"
                step="64"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={agentConfig?.maxTokens || 512}
                onChange={(e) => agentConfig && updateAgentConfig({ ...agentConfig, maxTokens: parseInt(e.target.value) })}
              />
            </div>

            {/* Min Confidence */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Min. Confidence: {agentConfig ? (agentConfig.minConfidence / 100).toFixed(2) : '0.40'}</label>
              <input
                type="range"
                min="0"
                max="100"
                className="w-full"
                value={agentConfig?.minConfidence || 40}
                onChange={(e) => agentConfig && updateAgentConfig({ ...agentConfig, minConfidence: parseInt(e.target.value) })}
              />
            </div>

            {/* Auto Apply */}
            <div className="flex items-center gap-2 pt-6">
              <input
                type="checkbox"
                id="agentAutoApply"
                checked={agentConfig?.autoApply ?? true}
                onChange={(e) => agentConfig && updateAgentConfig({ ...agentConfig, autoApply: e.target.checked })}
                className="h-4 w-4"
              />
              <label htmlFor="agentAutoApply" className="text-sm">
                Auto-Apply <span className="text-muted-foreground">(Settings automatisch anwenden)</span>
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* System Prompt (merged: per-bot manager) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5" /> System Prompt
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Bot-spezifischer Prompt für das LLM. Priorität: Eigener Prompt → Strategie-Prompt → Auto-generiert aus Strategie-Typ. Marktdaten werden automatisch angehängt.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Bot Picker */}
          <select
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={assistentBotId}
            onChange={e => { setAssistentBotId(e.target.value); setAssistentEditMode(false); }}
          >
            <option value="">— Bot auswählen —</option>
            {bots.map(b => (
              <option key={b.id} value={b.id}>{b.name} ({b.strategyType ?? 'scalping'})</option>
            ))}
          </select>

          {!assistentBotId && (
            <p className="text-sm text-muted-foreground text-center py-4">Wähle einen Bot um seinen System Prompt zu verwalten.</p>
          )}

          {assistentBotId && !assistentPromptInfo && (
            <p className="text-sm text-muted-foreground">Lade...</p>
          )}

          {assistentBotId && assistentPromptInfo && (
            <div className="space-y-3">
              {/* Strategy info row */}
              {(assistentPromptInfo.strategyName || assistentPromptInfo.strategyType) && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/30 border text-xs flex-wrap">
                  <span className="text-muted-foreground">Strategie:</span>
                  {assistentPromptInfo.strategyType && (
                    <span className={`flex items-center gap-1 font-bold px-1.5 py-0.5 rounded border ${getStrategyColor(assistentPromptInfo.strategyType)}`}>
                      {getStrategyIcon(assistentPromptInfo.strategyType, "h-3 w-3")}
                      {assistentPromptInfo.strategyType}
                    </span>
                  )}
                  {assistentPromptInfo.strategyName && (
                    <span className="text-foreground font-medium">{assistentPromptInfo.strategyName}</span>
                  )}
                </div>
              )}

              {/* Source + Actions Row */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs text-muted-foreground">Aktive Quelle:</span>
                <span className={`text-xs-custom font-bold px-2 py-0.5 rounded border ${
                  assistentPromptInfo.source === 'custom'   ? 'bg-purple-500/20 text-purple-300 border-purple-500/30' :
                  assistentPromptInfo.source === 'strategy' ? 'bg-blue-500/20 text-blue-300 border-blue-500/30' :
                  'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'
                }`}>
                  {assistentPromptInfo.source === 'custom'   ? '✎ Eigener Prompt' :
                   assistentPromptInfo.source === 'strategy' ? '📋 Strategie-Prompt' :
                   '⚡ Auto-generiert'}
                </span>
                {assistentPromptInfo.source === 'custom' && (
                  <button
                    className="text-xs text-muted-foreground hover:text-red-400 underline ml-auto"
                    onClick={async () => {
                      await fetch(`${getApiBase()}/api/bots/${assistentBotId}/system-prompt`, {
                        method: 'PUT', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ systemPrompt: null }),
                      });
                      const d = await fetch(`${getApiBase()}/api/bots/${assistentBotId}/system-prompt`).then(r => r.json());
                      setAssistentPromptInfo(d);
                      setAssistentEditMode(false);
                    }}
                  >Delete Custom Prompt</button>
                )}
              </div>

              {/* View mode */}
              {!assistentEditMode ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Effektiver Prompt</span>
                    <Button variant="outline" size="sm"
                      onClick={() => {
                        setAssistentEditValue(assistentPromptInfo.customPrompt ?? assistentPromptInfo.strategyPrompt ?? assistentPromptInfo.autoPrompt);
                        setAssistentEditMode(true);
                      }}
                    >✎ Anpassen</Button>
                  </div>
                  <pre className="w-full rounded-md border bg-muted/30 px-3 py-3 text-xs font-mono text-muted-foreground whitespace-pre-wrap overflow-auto max-h-72">
                    {assistentPromptInfo.effectivePrompt}
                  </pre>
                  {assistentPromptInfo.source !== 'auto' && (
                    <details>
                      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">Auto-generierter Default anzeigen</summary>
                      <pre className="mt-2 w-full rounded-md border bg-muted/20 px-3 py-3 text-xs font-mono text-muted-foreground/60 whitespace-pre-wrap overflow-auto max-h-48">
                        {assistentPromptInfo.autoPrompt}
                      </pre>
                    </details>
                  )}
                </div>
              ) : (
                /* Edit mode */
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Prompt bearbeiten</span>
                    <button
                      className="text-xs text-muted-foreground hover:text-amber-400 underline"
                      onClick={() => setAssistentEditValue(assistentPromptInfo.strategyPrompt ?? assistentPromptInfo.autoPrompt)}
                    >↺ Standard laden</button>
                  </div>
                  <textarea
                    rows={16}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary resize-y"
                    value={assistentEditValue}
                    onChange={e => setAssistentEditValue(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setAssistentEditMode(false)}>Abbrechen</Button>
                    <Button
                      disabled={assistentSaveStatus === "saving"}
                      onClick={async () => {
                        setAssistentSaveStatus("saving");
                        try {
                          await fetch(`${getApiBase()}/api/bots/${assistentBotId}/system-prompt`, {
                            method: 'PUT', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ systemPrompt: assistentEditValue }),
                          });
                          const d = await fetch(`${getApiBase()}/api/bots/${assistentBotId}/system-prompt`).then(r => r.json());
                          setAssistentPromptInfo(d);
                          setAssistentEditMode(false);
                          setAssistentSaveStatus("saved");
                          setTimeout(() => setAssistentSaveStatus("idle"), 2000);
                        } catch {
                          setAssistentSaveStatus("error");
                          setTimeout(() => setAssistentSaveStatus("idle"), 2000);
                        }
                      }}
                    >
                      {assistentSaveStatus === "saving" ? "Speichern..." : assistentSaveStatus === "saved" ? "✓ Gespeichert" : "Speichern"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Regime Performance Table */}
      {regimePerformance.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Regime Performance (historical)</CardTitle>
            <CardDescription className="text-xs">Trade results by active market regime at time of AI analysis</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Regime</TableHead>
                  <TableHead className="text-xs text-right">Win-Rate</TableHead>
                  <TableHead className="text-xs text-right">Ø PnL</TableHead>
                  <TableHead className="text-xs text-right">Trades</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {regimePerformance.map((r) => {
                  const regimeColor = r.regime === "RANGING" ? "text-blue-400" : r.regime === "TRENDING" ? "text-emerald-400" : r.regime === "VOLATILE" ? "text-amber-400" : "text-zinc-400";
                  return (
                    <TableRow key={r.regime}>
                      <TableCell><span className={`text-xs font-bold ${regimeColor}`}>{r.regime}</span></TableCell>
                      <TableCell className="text-right text-xs">
                        <span className={r.winRate >= 60 ? "text-emerald-400" : r.winRate >= 45 ? "text-yellow-400" : "text-red-400"}>
                          {r.winRate}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-xs font-mono">
                        <span className={r.avgPnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                          {r.avgPnl >= 0 ? "+" : ""}{r.avgPnl.toFixed(3)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-xs text-zinc-400">{r.totalTrades}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* History Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Analyse-Historie</span>
            <select
              className="rounded-md border border-input bg-background px-3 py-1 text-sm"
              value={selectedHistoryBot}
              onChange={(e) => setSelectedHistoryBot(e.target.value)}
            >
              <option value="all">Alle Bots</option>
              {bots.map((bot) => (
                <option key={bot.id} value={bot.id}>{bot.name}</option>
              ))}
            </select>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-96 overflow-y-auto space-y-3">
            {agentHistory.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                Noch keine Analysen vorhanden
              </p>
            ) : (
              agentHistory.map((entry, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border bg-card p-4 space-y-2"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${
                        entry.regime === 'RANGING' ? 'bg-blue-500/20 text-blue-400' :
                        entry.regime === 'TRENDING' ? 'bg-green-500/20 text-green-400' :
                        entry.regime === 'DEAD' ? 'bg-gray-500/20 text-gray-400' :
                        'bg-orange-500/20 text-orange-400'
                      }`}>
                        {entry.regime}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Bot: {entry.botId?.substring(0, 8)}...
                      </span>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-xs text-muted-foreground">
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                      <span className={`text-xs font-bold ${
                        ((entry.confidence ?? 0) * 100) >= 70 ? 'text-green-500' :
                        ((entry.confidence ?? 0) * 100) >= 40 ? 'text-yellow-500' : 'text-red-500'
                      }`}>
                        {((entry.confidence ?? 0) * 100).toFixed(0)}% Conf.
                      </span>
                      {entry.aggressivenessAdvice !== undefined && entry.aggressivenessAdvice !== null && (
                        <span className="text-xs font-mono bg-purple-500/10 text-purple-300 border border-purple-500/30 px-1.5 py-0.5 rounded">
                          AI Aggr: {entry.aggressivenessAdvice}%
                        </span>
                      )}
                      {entry.outcomeTradeCount !== undefined && entry.outcomeTradeCount > 0 && (
                        <span className={`text-xs font-mono px-1.5 py-0.5 rounded border ${
                          entry.outcomeTotalPnl !== undefined && entry.outcomeTotalPnl / entry.outcomeTradeCount >= 0
                            ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                            : 'bg-red-500/10 text-red-300 border-red-500/30'
                        }`}>
                          {entry.outcomeTradeCount}T · {entry.outcomeTotalPnl !== undefined ? (entry.outcomeTotalPnl / entry.outcomeTradeCount >= 0 ? '+' : '') + (entry.outcomeTotalPnl / entry.outcomeTradeCount).toFixed(3) + '%' : '–'}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">{entry.reason}</p>
                  {entry.analysis && (
                    <p className="text-sm italic text-muted-foreground border-l-2 border-primary/50 pl-3">
                      {entry.analysis}
                    </p>
                  )}
                  {entry.adjustedSettings && (
                    <pre className="text-xs bg-black/50 p-2 rounded overflow-x-auto">
                      {JSON.stringify(entry.adjustedSettings, null, 2)}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
