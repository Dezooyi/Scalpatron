// Kill-Switch / Circuit-Breaker Engine
// Überwacht Equity-Drawdown, Tagesverlust, Folgeverluste, Session-Take-Profit und
// Trade-Anzahl. Bei Überschreitung einer konfigurierten Grenze wird der Bot
// scharfgestellt (tripped) und blockiert weitere Einstiege, bis ein Reset erfolgt.
//
// Jede Regel ist einzeln an-/abschaltbar ({ enabled, value }). Der Master-Switch
// `enabled` aktiviert die Überwachung insgesamt; nur Regeln mit enabled=true werden
// ausgewertet — so greift die vom Nutzer gewählte Kombination.

export interface KillSwitchRule {
  enabled: boolean;
  value: number;
}

export type KillSwitchRuleKey =
  | 'maxDrawdown'
  | 'maxDailyLoss'
  | 'maxConsecutiveLosses'
  | 'sessionTakeProfit'
  | 'maxTotalTrades';

export interface KillSwitchConfig {
  enabled: boolean;                 // Master-Switch
  maxDrawdown?: KillSwitchRule;             // 0.15 = 15% — Stop bei Peak-to-Trough Drawdown
  maxDailyLoss?: KillSwitchRule;            // 0.05 = 5% — Stop bei Tagesverlust (Session)
  maxConsecutiveLosses?: KillSwitchRule;    // 5 — Stop nach N Verlust-Trades in Folge
  sessionTakeProfit?: KillSwitchRule;       // 0.10 = 10% — Stop bei Session-Gewinn (Mitnahme)
  maxTotalTrades?: KillSwitchRule;          // 100 — Stop nach N geschlossenen Trades
}

export type KillSwitchStatus = 'armed' | 'tripped';

export interface KillSwitchRuntime {
  config: KillSwitchConfig;
  status: KillSwitchStatus;
  reason?: string;
  trippedAt?: number;
  peakEquity: number;
  currentEquity: number;
  drawdownPct: number;            // 0..1 ab Peak
  sessionStartEquity: number;
  sessionPnlPct: number;          // Ratio ab Session-Start (-?..+?)
  consecutiveLosses: number;
  totalTrades: number;
}

export const KILL_SWITCH_RULE_KEYS: KillSwitchRuleKey[] = [
  'maxDrawdown',
  'maxDailyLoss',
  'maxConsecutiveLosses',
  'sessionTakeProfit',
  'maxTotalTrades',
];

// Strategie-abhängige Standardwerte (globale Trading-Regel je Risiko-Profil).
// Scalping = engere Stopps, Breakout/Momentum = weiter (volatiler), DCA = am nachsichtigsten.
const STRATEGY_DEFAULTS: Record<string, Record<KillSwitchRuleKey, number>> = {
  scalping:        { maxDrawdown: 0.08, maxDailyLoss: 0.04, maxConsecutiveLosses: 6, sessionTakeProfit: 0.06, maxTotalTrades: 200 },
  trend:           { maxDrawdown: 0.15, maxDailyLoss: 0.06, maxConsecutiveLosses: 5, sessionTakeProfit: 0.12, maxTotalTrades: 150 },
  mean_reversion:  { maxDrawdown: 0.10, maxDailyLoss: 0.04, maxConsecutiveLosses: 7, sessionTakeProfit: 0.08, maxTotalTrades: 200 },
  breakout:        { maxDrawdown: 0.18, maxDailyLoss: 0.08, maxConsecutiveLosses: 4, sessionTakeProfit: 0.15, maxTotalTrades: 120 },
  momentum:        { maxDrawdown: 0.20, maxDailyLoss: 0.08, maxConsecutiveLosses: 4, sessionTakeProfit: 0.18, maxTotalTrades: 120 },
  dca:             { maxDrawdown: 0.25, maxDailyLoss: 0.10, maxConsecutiveLosses: 8, sessionTakeProfit: 0.20, maxTotalTrades: 100 },
  grid:            { maxDrawdown: 0.12, maxDailyLoss: 0.05, maxConsecutiveLosses: 6, sessionTakeProfit: 0.10, maxTotalTrades: 300 },
  ml:              { maxDrawdown: 0.12, maxDailyLoss: 0.05, maxConsecutiveLosses: 5, sessionTakeProfit: 0.10, maxTotalTrades: 150 },
};

export function defaultKillSwitchConfig(strategyType?: string): KillSwitchConfig {
  const base = STRATEGY_DEFAULTS[strategyType ?? 'scalping'] ?? STRATEGY_DEFAULTS.scalping;
  const rules: KillSwitchConfig = { enabled: false };
  for (const key of KILL_SWITCH_RULE_KEYS) {
    rules[key] = { enabled: true, value: base[key] };
  }
  return rules;
}

/** Normalisiert ältere flache Konfiguration (maxDrawdownPct etc.) in die Regel-Form. */
function normalizeConfig(input: unknown): KillSwitchConfig {
  const src = (input ?? {}) as Record<string, unknown>;
  const flatMap: Record<string, KillSwitchRuleKey> = {
    maxDrawdownPct: 'maxDrawdown',
    maxDailyLossPct: 'maxDailyLoss',
    maxConsecutiveLosses: 'maxConsecutiveLosses',
    sessionTakeProfitPct: 'sessionTakeProfit',
    maxTotalTrades: 'maxTotalTrades',
  };
  const cfg: KillSwitchConfig = {
    enabled: src.enabled === true,
    maxDrawdown: rule(src.maxDrawdown),
    maxDailyLoss: rule(src.maxDailyLoss),
    maxConsecutiveLosses: rule(src.maxConsecutiveLosses),
    sessionTakeProfit: rule(src.sessionTakeProfit),
    maxTotalTrades: rule(src.maxTotalTrades),
  };
  // Legacy-Werte übernehmen, falls Regel nicht als Objekt vorliegt
  for (const [flatKey, ruleKey] of Object.entries(flatMap)) {
    const legacy = src[flatKey];
    if (typeof legacy === 'number' && (!cfg[ruleKey] || cfg[ruleKey]!.value == null)) {
      cfg[ruleKey] = { enabled: true, value: legacy };
    }
  }
  return cfg;
}

function rule(r: unknown): KillSwitchRule | undefined {
  if (r && typeof r === 'object' && 'value' in (r as Record<string, unknown>)) {
    const obj = r as { enabled?: boolean; value: number };
    return { enabled: obj.enabled !== false, value: obj.value };
  }
  return undefined;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function utcDayStart(ts: number): number {
  return Math.floor(ts / MS_PER_DAY) * MS_PER_DAY;
}

export class KillSwitchEngine {
  private config: KillSwitchConfig;
  private tripped = false;
  private reason: string | undefined;
  private trippedAt: number | undefined;
  private peakEquity = 0;
  private currentEquity = 0;
  private sessionStartEquity = 0;
  private sessionDay = 0;
  private consecutiveLosses = 0;
  private totalTrades = 0;
  private initialized = false;

  constructor(config?: unknown) {
    this.config = config ? normalizeConfig(config) : defaultKillSwitchConfig();
  }

  setConfig(config: unknown): void {
    this.config = normalizeConfig(config ?? {});
    // Master deaktivieren beendet einen aktiven Alarm und gibt den Bot wieder frei.
    if (!this.config.enabled) {
      this.clearTripped();
    }
  }

  getConfig(): KillSwitchConfig {
    return JSON.parse(JSON.stringify(this.config)) as KillSwitchConfig;
  }

  isEnabled(): boolean {
    return this.config.enabled === true;
  }

  /** Anzahl der aktivierten Einzelregeln (für UI). */
  activeRulesCount(): number {
    return KILL_SWITCH_RULE_KEYS.filter(k => this.config[k]?.enabled === true).length;
  }

  /** Mark-to-Market Equity pro Tick aktualisieren (Peak + Session-/Tagesbezug). */
  updateEquity(equity: number, now: number): void {
    this.currentEquity = equity;
    if (!this.initialized || equity > this.peakEquity) {
      this.peakEquity = equity;
    }
    const day = utcDayStart(now);
    if (!this.initialized || day !== this.sessionDay) {
      this.sessionDay = day;
      this.sessionStartEquity = equity;
    }
    this.initialized = true;
  }

  /** Geschlossenen SELL-Trade erfassen (PnL in %). */
  recordTradeClosed(pnlPercent: number): void {
    this.totalTrades++;
    if (pnlPercent <= 0) {
      this.consecutiveLosses++;
    } else {
      this.consecutiveLosses = 0;
    }
  }

  /** Zähler nach Server-Restart aus DB wiederherstellen. */
  restoreCounters(totalTrades: number, consecutiveLosses: number): void {
    this.totalTrades = totalTrades;
    this.consecutiveLosses = consecutiveLosses;
  }

  private hits(rule: KillSwitchRule | undefined): { active: boolean; value: number } {
    return { active: rule?.enabled === true && rule.value > 0, value: rule?.value ?? 0 };
  }

  /** Prüft alle aktivierten Grenzen. Hat Seiteneffekt: schärft den Switch beim ersten Treffer. */
  check(): { stop: boolean; reason?: string } {
    if (!this.config.enabled) return { stop: false };
    if (this.tripped) return { stop: true, reason: this.reason };

    const reasons: string[] = [];

    if (this.peakEquity > 0) {
      const dd = (this.peakEquity - this.currentEquity) / this.peakEquity;
      const r = this.hits(this.config.maxDrawdown);
      if (r.active && dd >= r.value) {
        reasons.push(`Max Drawdown ${(dd * 100).toFixed(1)}% ≥ ${(r.value * 100).toFixed(0)}%`);
      }
    }

    if (this.sessionStartEquity > 0) {
      const sessionPnl = (this.currentEquity - this.sessionStartEquity) / this.sessionStartEquity;
      const loss = this.hits(this.config.maxDailyLoss);
      if (loss.active && sessionPnl <= -loss.value) {
        reasons.push(`Tagesverlust ${(sessionPnl * 100).toFixed(1)}% ≤ -${(loss.value * 100).toFixed(0)}%`);
      }
      const tp = this.hits(this.config.sessionTakeProfit);
      if (tp.active && sessionPnl >= tp.value) {
        reasons.push(`Session Take-Profit ${(sessionPnl * 100).toFixed(1)}% ≥ +${(tp.value * 100).toFixed(0)}%`);
      }
    }

    const cl = this.hits(this.config.maxConsecutiveLosses);
    if (cl.active && this.consecutiveLosses >= cl.value) {
      reasons.push(`${this.consecutiveLosses} Folgeverluste ≥ ${cl.value}`);
    }

    const mt = this.hits(this.config.maxTotalTrades);
    if (mt.active && this.totalTrades >= mt.value) {
      reasons.push(`${this.totalTrades} Trades ≥ ${mt.value}`);
    }

    if (reasons.length > 0) {
      this.tripped = true;
      this.reason = reasons.join(' | ');
      this.trippedAt = Date.now();
      return { stop: true, reason: this.reason };
    }
    return { stop: false };
  }

  isTripped(): boolean {
    return this.config.enabled === true && this.tripped;
  }

  private clearTripped(): void {
    this.tripped = false;
    this.reason = undefined;
    this.trippedAt = undefined;
  }

  /** Alarm zurücksetzen und erneut scharfschalten (Session/Peak/Streak neu verankern).
   *  totalTrades bleibt als Lebenszeit-Zähler erhalten — bei Erreichen der absoluten
   *  Trade-Grenze hilft nur ein Bot-Reset oder Anheben des Limits. */
  reset(): void {
    this.clearTripped();
    this.consecutiveLosses = 0;
    if (this.initialized) {
      this.sessionStartEquity = this.currentEquity;
      this.peakEquity = Math.max(this.peakEquity, this.currentEquity);
      this.sessionDay = utcDayStart(Date.now());
    }
  }

  getRuntime(): KillSwitchRuntime {
    const drawdownPct = this.peakEquity > 0
      ? Math.max(0, (this.peakEquity - this.currentEquity) / this.peakEquity)
      : 0;
    const sessionPnlPct = this.sessionStartEquity > 0
      ? (this.currentEquity - this.sessionStartEquity) / this.sessionStartEquity
      : 0;
    return {
      config: this.getConfig(),
      status: this.tripped ? 'tripped' : 'armed',
      reason: this.reason,
      trippedAt: this.trippedAt,
      peakEquity: this.peakEquity,
      currentEquity: this.currentEquity,
      drawdownPct,
      sessionStartEquity: this.sessionStartEquity,
      sessionPnlPct,
      consecutiveLosses: this.consecutiveLosses,
      totalTrades: this.totalTrades,
    };
  }
}
