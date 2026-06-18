/**
 * Pure Performance-Metriken für die Bot-Performance-Sektion.
 * Alle Funktionen sind deterministisch und ohne Side-Effects, sodass sie
 * sich gut testen und memoisieren lassen.
 *
 * Datenmodell (vom Backend /api/performance bzw. SSE recentTrades):
 *   PerformanceTrade = { botId, timestamp, action: 'BUY'|'SELL', price, amount?, pnlPercent? }
 *
 * Geschlossene Trades = SELL-Rows mit pnlPercent != null (Round-Trip realisiert).
 */

export type PerformanceTrade = {
  botId: string;
  timestamp: number;
  action: string;
  price: number;
  amount?: number | null;
  pnlPercent?: number | null;
  paperMode?: boolean;
};

export type TimeframeKey = "24h" | "7d" | "30d" | "all";

export const TIMEFRAME_MS: Record<TimeframeKey, number | null> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  all: null,
};

export const TIMEFRAME_LABELS: Record<TimeframeKey, string> = {
  "24h": "24h",
  "7d": "7d",
  "30d": "30d",
  all: "All",
};

export type OutcomeFilter = "all" | "wins" | "losses";
export type StatusFilter = "all" | "running" | "stopped" | "paused";
export type ModeFilter = "all" | "paper" | "live";

export interface PerformanceFilters {
  timeframe: TimeframeKey;
  botIds: string[];
  status: StatusFilter;
  mode: ModeFilter;
  strategy: string;
  outcome: OutcomeFilter;
}

export const DEFAULT_FILTERS: PerformanceFilters = {
  timeframe: "all",
  botIds: [],
  status: "all",
  mode: "all",
  strategy: "all",
  outcome: "all",
};

export type EquityPoint = {
  t: number;
  cum: number;
  drawdown: number;
};

export type StreakInfo = {
  current: number;
  currentType: "win" | "loss" | "none";
  maxWin: number;
  maxLoss: number;
};

export interface PerformanceMetrics {
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnlPercent: number;
  netPnlSol: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  payoffRatio: number;
  expectancy: number;
  bestTrade: number;
  worstTrade: number;
  largestLoss: number;
  maxDrawdown: number;
  maxDrawdownDurationMs: number;
  sharpe: number;
  sortino: number;
  avgHoldMs: number;
  tradesPerDay: number;
  streak: StreakInfo;
  paperPnlPercent: number;
  livePnlPercent: number;
  paperTrades: number;
  liveTrades: number;
  firstTradeTs: number | null;
  lastTradeTs: number | null;
}

const EMPTY_METRICS: PerformanceMetrics = {
  closedTrades: 0,
  wins: 0,
  losses: 0,
  winRate: 0,
  netPnlPercent: 0,
  netPnlSol: 0,
  grossProfit: 0,
  grossLoss: 0,
  profitFactor: 0,
  avgWin: 0,
  avgLoss: 0,
  payoffRatio: 0,
  expectancy: 0,
  bestTrade: 0,
  worstTrade: 0,
  largestLoss: 0,
  maxDrawdown: 0,
  maxDrawdownDurationMs: 0,
  sharpe: 0,
  sortino: 0,
  avgHoldMs: 0,
  tradesPerDay: 0,
  streak: { current: 0, currentType: "none", maxWin: 0, maxLoss: 0 },
  paperPnlPercent: 0,
  livePnlPercent: 0,
  paperTrades: 0,
  liveTrades: 0,
  firstTradeTs: null,
  lastTradeTs: null,
};

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function downsideDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const downside = values.filter(v => v < 0).map(v => v * v);
  if (downside.length === 0) return 0;
  return Math.sqrt(downside.reduce((a, b) => a + b, 0) / values.length);
}

function computeStreak(pnls: number[]): StreakInfo {
  let maxWin = 0;
  let maxLoss = 0;
  let runType: "win" | "loss" | "none" = "none";
  let run = 0;

  for (const p of pnls) {
    const type: "win" | "loss" = p > 0 ? "win" : p < 0 ? "loss" : "none" as never;
    if (p === 0) continue;
    if (type === runType) {
      run += 1;
    } else {
      runType = type;
      run = 1;
    }
    if (type === "win") maxWin = Math.max(maxWin, run);
    if (type === "loss") maxLoss = Math.max(maxLoss, run);
  }

  return {
    current: runType === "none" ? 0 : run,
    currentType: runType,
    maxWin,
    maxLoss,
  };
}

/**
 * Berechnet die Equity-Kurve (kumulierter PnL%) inkl. laufendem Drawdown.
 * Die Trades müssen bereits chronologisch (aufsteigend nach timestamp) sein.
 */
export function computeEquityCurve(trades: PerformanceTrade[]): EquityPoint[] {
  const closed = trades.filter(t => t.action === "SELL" && typeof t.pnlPercent === "number");
  if (closed.length === 0) return [];

  const points: EquityPoint[] = [];
  let cum = 0;
  let peak = 0;

  for (const t of closed) {
    const pnl = t.pnlPercent as number;
    cum += pnl;
    if (cum > peak) {
      peak = cum;
    }
    const dd = peak - cum;
    points.push({ t: t.timestamp, cum, drawdown: dd });
  }

  return points;
}

/**
 * Maximaler Drawdown (%-Punkte) inkl. Dauer bis zur Recovery.
 */
function computeMaxDrawdown(trades: PerformanceTrade[]): { value: number; durationMs: number } {
  const points = computeEquityCurve(trades);
  if (points.length === 0) return { value: 0, durationMs: 0 };

  let maxDd = 0;
  let peak = 0;
  let peakTs = points[0].t;
  let worstDurationMs = 0;

  for (const p of points) {
    if (p.cum > peak) {
      peak = p.cum;
      peakTs = p.t;
    }
    const dd = peak - p.cum;
    if (dd > maxDd) {
      maxDd = dd;
      worstDurationMs = p.t - peakTs;
    } else if (dd > 0) {
      worstDurationMs = Math.max(worstDurationMs, p.t - peakTs);
    }
  }

  return { value: maxDd, durationMs: worstDurationMs };
}

/**
 * Durchschnittliche Haltezeit: Paarung BUY -> darauffolgender SELL pro Bot.
 */
function computeAvgHoldMs(trades: PerformanceTrade[]): number {
  const byBot = groupByBot(trades);
  const durations: number[] = [];

  for (const botTrades of byBot.values()) {
    const sorted = [...botTrades].sort((a, b) => a.timestamp - b.timestamp);
    let pendingBuyTs: number | null = null;
    for (const t of sorted) {
      if (t.action === "BUY") {
        pendingBuyTs = t.timestamp;
      } else if (t.action === "SELL" && pendingBuyTs !== null) {
        durations.push(t.timestamp - pendingBuyTs);
        pendingBuyTs = null;
      }
    }
  }

  if (durations.length === 0) return 0;
  return durations.reduce((a, b) => a + b, 0) / durations.length;
}

export function groupByBot(trades: PerformanceTrade[]): Map<string, PerformanceTrade[]> {
  const map = new Map<string, PerformanceTrade[]>();
  for (const t of trades) {
    if (!map.has(t.botId)) map.set(t.botId, []);
    map.get(t.botId)!.push(t);
  }
  return map;
}

/**
 * Hauptberechnung aller Metriken für eine Menge von Trades.
 */
export function computeMetrics(trades: PerformanceTrade[]): PerformanceMetrics {
  const closed = trades.filter(t => t.action === "SELL" && typeof t.pnlPercent === "number");
  if (closed.length === 0) return { ...EMPTY_METRICS };

  const pnls = closed.map(t => t.pnlPercent as number);
  const wins = pnls.filter(p => p > 0);
  const losses = pnls.filter(p => p < 0);

  const netPnlPercent = pnls.reduce((a, b) => a + b, 0);
  const grossProfit = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));

  const netPnlSol = closed.reduce((acc, t) => {
    const amt = typeof t.amount === "number" ? t.amount : 0;
    return acc + amt * t.price * ((t.pnlPercent as number) / 100);
  }, 0);

  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0;

  const sd = stdev(pnls);
  const dd = downsideDeviation(pnls);
  const sharpe = sd > 0 ? pnls.reduce((a, b) => a + b, 0) / pnls.length / sd : 0;
  const sortino = dd > 0 ? pnls.reduce((a, b) => a + b, 0) / pnls.length / dd : 0;

  const timestamps = closed.map(t => t.timestamp);
  const firstTradeTs = Math.min(...timestamps);
  const lastTradeTs = Math.max(...timestamps);

  const spanDays = Math.max((lastTradeTs - firstTradeTs) / (24 * 60 * 60 * 1000), 1 / 24);
  const tradesPerDay = closed.length / spanDays;

  const { value: maxDrawdown, durationMs: maxDrawdownDurationMs } = computeMaxDrawdown(closed);

  // Paper/Live-Split pro Trade (paperMode undefined -> Paper, da DB-Default 1)
  const paperClosed = closed.filter(t => t.paperMode !== false);
  const liveClosed = closed.filter(t => t.paperMode === false);
  const paperPnlPercent = paperClosed.reduce((a, t) => a + (t.pnlPercent as number), 0);
  const livePnlPercent = liveClosed.reduce((a, t) => a + (t.pnlPercent as number), 0);

  return {
    closedTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: (wins.length / closed.length) * 100,
    netPnlPercent,
    netPnlSol,
    grossProfit,
    grossLoss,
    profitFactor,
    avgWin,
    avgLoss,
    payoffRatio,
    expectancy: netPnlPercent / closed.length,
    bestTrade: Math.max(...pnls),
    worstTrade: Math.min(...pnls),
    largestLoss: Math.min(...pnls),
    maxDrawdown,
    maxDrawdownDurationMs,
    sharpe,
    sortino,
    avgHoldMs: computeAvgHoldMs(trades),
    tradesPerDay,
    streak: computeStreak(pnls),
    paperPnlPercent,
    livePnlPercent,
    paperTrades: paperClosed.length,
    liveTrades: liveClosed.length,
    firstTradeTs,
    lastTradeTs,
  };
}

export interface PerBotMetrics extends PerformanceMetrics {
  botId: string;
}

/**
 * Berechnet die Metriken pro Bot (chronologisch sortiert).
 */
export function computePerBotMetrics(trades: PerformanceTrade[]): PerBotMetrics[] {
  const byBot = groupByBot(trades);
  const result: PerBotMetrics[] = [];

  for (const [botId, botTrades] of byBot.entries()) {
    const botClosed = botTrades.filter(t => t.action === "SELL" && typeof t.pnlPercent === "number");
    if (botClosed.length === 0) continue;
    result.push({ botId, ...computeMetrics(botTrades) });
  }

  return result;
}

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatPct(value: number, digits = 2): string {
  if (!isFinite(value)) return "∞";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatPctPlain(value: number, digits = 1): string {
  if (!isFinite(value)) return "∞";
  return `${value.toFixed(digits)}%`;
}

export function formatSol(value: number, digits = 3): string {
  if (!isFinite(value)) return "∞";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)} SOL`;
}

export function formatNumber(value: number, digits = 2): string {
  if (!isFinite(value)) return "∞";
  return value.toFixed(digits);
}

export function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return "—";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ${min % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function formatRatio(value: number, digits = 2): string {
  if (!isFinite(value)) return "∞";
  return value.toFixed(digits);
}
