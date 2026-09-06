import { getSetting, setSetting } from './db.js';

/**
 * TimesFM Runtime-Settings (Standard AKTIV, in DB persistiert, über die
 * Einstellungsseite steuerbar). Die klassischen TIMESFM_*-Umgebungsvariablen
 * übersteuern die Defaults beim ersten Start; danach gewinnt die DB-Einstellung.
 */

export interface TimesFmRuntimeSettings {
  /** Feature an/aus (Forecast-Cache + Worker-Nutzung). Default: true. */
  enabled: boolean;
  /** Trade-Gate am Hotpath (BUY-Demotion/Exit-Unterstützung). Default: true. */
  tradeGate: boolean;
  /** Self-Opt-Outcome-Loop (Reward, Drift-Guard, Auto-Disable). Default: true. */
  selfOptGate: boolean;
  /** Mindest-Trades für das Self-Opt-Outcome-Gate. */
  minTrades: number;
  /** Mindest-WR für das Self-Opt-Outcome-Gate (0..1). */
  minWinRate: number;
}

const SETTINGS_KEY = 'timesfm_runtime';

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function envInitial(): TimesFmRuntimeSettings {
  return {
    enabled: envBool('TIMESFM_ENABLED', true),
    tradeGate: envBool('TIMESFM_TRADE_GATE_ENABLED', true),
    selfOptGate: envBool('TIMESFM_SELFOPT_GATE_ENABLED', true),
    minTrades: clamp(Number.parseInt(process.env.TIMESFM_SELFOPT_MIN_TRADES ?? '20', 10), 5, 200, 20),
    minWinRate: clamp(Number.parseFloat(process.env.TIMESFM_SELFOPT_MIN_WIN_RATE ?? '0.35'), 0.05, 0.9, 0.35),
  };
}

function normalize(input: Record<string, unknown> | undefined): TimesFmRuntimeSettings {
  const base = envInitial();
  if (!input || typeof input !== 'object') return base;
  const o = input as Record<string, unknown>;
  const asBool = (v: unknown, fallback: boolean): boolean =>
    typeof v === 'boolean' ? v : fallback;
  return {
    enabled: asBool(o.enabled, base.enabled),
    tradeGate: asBool(o.tradeGate, base.tradeGate),
    selfOptGate: asBool(o.selfOptGate, base.selfOptGate),
    minTrades: clamp(typeof o.minTrades === 'number' ? o.minTrades : base.minTrades, 5, 200, base.minTrades),
    minWinRate: clamp(typeof o.minWinRate === 'number' ? o.minWinRate : base.minWinRate, 0.05, 0.9, base.minWinRate),
  };
}

function load(): TimesFmRuntimeSettings {
  const raw = getSetting(SETTINGS_KEY, '');
  if (!raw) return envInitial();
  try {
    return normalize(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return envInitial();
  }
}

let current: TimesFmRuntimeSettings = load();

function persist(): void {
  try {
    setSetting(SETTINGS_KEY, JSON.stringify(current));
  } catch (e) {
    console.warn(`[TimesFM] Runtime-Settings persist failed: ${(e as Error).message}`);
  }
}

/** Aktueller Stand (immutabel lesen). */
export function getTimesFmSettings(): Readonly<TimesFmRuntimeSettings> {
  return current;
}

/** Teil-Update (z.B. von der Einstellungsseite) — validiert, klemmt, persistiert. */
export function updateTimesFmSettings(patch: Partial<TimesFmRuntimeSettings>): TimesFmRuntimeSettings {
  current = normalize({ ...current, ...patch });
  persist();
  return current;
}

/** Nur für Tests: auf einen definierten Zustand setzen. */
export function _setTimesFmSettingsForTest(settings: TimesFmRuntimeSettings): void {
  current = settings;
}
