import { useCallback, useEffect, useState } from 'react';
import { TrendingUp, Power, PowerOff, Play, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface TimesFmRuntimeSettings {
  enabled: boolean;
  tradeGate: boolean;
  selfOptGate: boolean;
  minTrades: number;
  minWinRate: number;
}

interface TimesFmSettingsResponse {
  settings: TimesFmRuntimeSettings;
  installed: boolean;
  installing: boolean;
  workerRunning: boolean;
}

const getApiBase = () => localStorage.getItem('scalpatron_api_url') ?? '';

const DEFAULTS: TimesFmRuntimeSettings = {
  enabled: true,
  tradeGate: true,
  selfOptGate: true,
  minTrades: 20,
  minWinRate: 0.35,
};

/** Schreibbare TimesFM-/Self-Opt-Einstellungen (Einstellungsbereich). */
export function TimesFmSettingsCard() {
  const [settings, setSettings] = useState<TimesFmRuntimeSettings>(DEFAULTS);
  const [installed, setInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [workerRunning, setWorkerRunning] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [setupMsg, setSetupMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/timesfm/settings`);
      if (!res.ok) return;
      const data = (await res.json()) as TimesFmSettingsResponse;
      setSettings(data.settings);
      setInstalled(data.installed);
      setInstalling(data.installing);
      setWorkerRunning(data.workerRunning);
    } catch {
      // Non-critical — Karte bleibt auf Defaults/Status idle.
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const save = async () => {
    setStatus('saving');
    try {
      const res = await fetch(`${getApiBase()}/api/timesfm/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error(`PUT failed: ${res.status}`);
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
      setTimeout(() => { void load(); }, 1500);
    } catch {
      setStatus('error');
    }
  };

  const runSetup = async () => {
    setSetupMsg(null);
    try {
      const res = await fetch(`${getApiBase()}/api/timesfm/setup`, { method: 'POST' });
      const data = (await res.json()) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok && !data.ok) {
        setSetupMsg(data.error ?? `Setup-Fehler (${res.status})`);
        return;
      }
      setSetupMsg(data.message ?? 'Installation läuft im Hintergrund.');
      setInstalling(true);
      window.setTimeout(() => { void load(); }, 5000);
    } catch {
      setSetupMsg('Setup konnte nicht gestartet werden.');
    }
  };

  const set = (patch: Partial<TimesFmRuntimeSettings>) =>
    setSettings((s) => ({ ...s, ...patch }));

  const toggleRow = (
    key: keyof Pick<TimesFmRuntimeSettings, 'enabled' | 'tradeGate' | 'selfOptGate'>,
    title: string,
    hint: string,
  ) => (
    <label className="flex items-start justify-between gap-4 rounded-md border border-white/10 bg-muted/20 p-3 cursor-pointer">
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={settings[key]}
        onClick={() => set({ [key]: !settings[key] } as Partial<TimesFmRuntimeSettings>)}
        className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-wider transition-colors ${
          settings[key]
            ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300'
            : 'border-white/15 bg-muted/30 text-muted-foreground'
        }`}
      >
        {settings[key] ? <Power className="h-3 w-3" /> : <PowerOff className="h-3 w-3" />}
        {settings[key] ? 'AN' : 'AUS'}
      </button>
    </label>
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-cyan-400" /> TimesFM & Self-Optimization
        </CardTitle>
        <CardDescription>
          Standard aktiv. Steuert Forecast-Cache, Trade-Gate und den Self-Opt-Outcome-Loop
          (Nova Pulse / PAET). Gates respektieren weiterhin alle Sicherheitsgrenzen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {toggleRow('enabled', 'Forecast-Layer', 'TimesFM-Cache & Worker-Nutzung für alle Bots.')}
          {toggleRow('tradeGate', 'Trade-Gate', 'BUY-Demotion / Exit-Unterstützung am Hotpath.')}
          {toggleRow('selfOptGate', 'Self-Opt-Outcome-Loop', 'Auto-Disable, Drift-Guard & Reward-Skalierung.')}
        </div>

        <div className="flex flex-wrap items-end gap-4 rounded-md border border-white/10 bg-muted/20 p-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Self-Opt min. Trades
            <input
              type="number"
              min={5}
              max={200}
              value={settings.minTrades}
              onChange={(e) => set({ minTrades: Number(e.target.value) })}
              className="w-24 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Self-Opt min. Win-Rate
            <input
              type="number"
              min={0.05}
              max={0.9}
              step={0.05}
              value={settings.minWinRate}
              onChange={(e) => set({ minWinRate: Number(e.target.value) })}
              className="w-24 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            />
          </label>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Worker: {workerRunning ? 'läuft' : 'gestoppt'}
              {installed ? '' : ' · nicht installiert'}
            </span>
            <button
              type="button"
              onClick={() => void save()}
              disabled={status === 'saving'}
              className="rounded-md bg-cyan-500/20 border border-cyan-500/40 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/30 disabled:opacity-50"
            >
              {status === 'saving' ? 'Speichern…' : status === 'saved' ? 'Gespeichert ✓' : status === 'error' ? 'Fehler' : 'Speichern'}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-md border border-white/10 bg-muted/20 p-3">
          <div className="flex-1 text-xs text-muted-foreground">
            {setupMsg ?? (
              installed
                ? 'TimesFM ist installiert (venv).'
                : 'Voraussetzung fehlt: Python-Umgebung mit PyTorch + TimesFM 2.5.'
            )}
          </div>
          {!installed && (
            <button
              type="button"
              onClick={() => void runSetup()}
              disabled={installing}
              className="inline-flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
            >
              {installing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {installing ? 'Installation läuft…' : 'Voraussetzung installieren (npm run timesfm:setup)'}
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
