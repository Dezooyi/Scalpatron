import type { PricePoint } from './priceFeed.js';
import type { PatternSettings } from './patternDetector.js';
import type { BotInstance } from './botInstance.js';
import type { BotState } from './botInstance.js';
import type { IndicatorConfig } from './strategyTypes.js';
import type { TradeLogEntry } from './trader.js';
import { exec, spawn } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { logger } from './appLogger.js';
import { buildVirtualCandles, calculatePreProcessedIndicators, buildAsciiSparkline } from './utils/mathUtils.js';
import { geckoTerminalFeed } from './geckoTerminalFeed.js';
import { macroFeed } from './macroFeed.js';
import {
  saveAgentHistory,
  getAgentHistory as getAgentHistoryFromDb,
  getRegimePerformance,
  getRecentAdvicesWithOutcomes,
  saveAgentConfig,
  loadAgentConfig,
  getLiveFeedEntries,
  getTimeWindowPerformance,
  detectTimeWindowDrift,
  getLessonsForBot,
  type TimeWindowPerformance,
  type TimeWindowDrift,
  type LessonEntry,
  db,
} from './db.js';
import { generateLessons } from './lessonsGenerator.js';
import { PriceFeed } from './priceFeed.js';

// --- Types ---

interface OllamaModelRaw {
  name: string;
  size: number;
  details?: {
    parameter_size?: string;
    family?: string;
  };
}

interface OllamaModel {
  name: string;
  size: number;
  parameter_size?: string;
  family?: string;
}

interface TradeSummary {
  action: 'BUY' | 'SELL';
  price: number;
  spikePercent: number;
  pnlPercent?: number;
}

interface RegimePerformance {
  regime: string;
  winRate: number | null;
  avgPnl: number | null;
  totalTrades: number;
}

interface RecentAdvice {
  timestamp: number;
  regime: string;
  confidence: number;
  reason: string;
  adjustedSettings?: string;
  aggressivenessAdvice?: number | null;
  outcomeTradeCount?: number;
  outcomeTotalPnl?: number;
  outcomeWins?: number;
}

export interface OllamaAdvice {
  adjustedSettings: Partial<PatternSettings>;
  previousSettings: Partial<PatternSettings>;
  reason: string;
  confidence: number;       // 0-1
  regime: 'RANGING' | 'TRENDING' | 'DEAD' | 'VOLATILE';
  analysis: string;
  timestamp: number;
  aggressiveness?: number;        // AI-recommended position_size % (1–80)
  strategyAdjustments?: {         // generic strategy parameter hints
    indicators?: IndicatorConfig[];
    scalping_settings?: Partial<PatternSettings>;
    risk_management?: { position_size?: number };
    entry_condition_hints?: string;
  };
  strategySwitch?: {              // ADR-011 Phase B: optional strategy-type switch
    fromStrategyType: string;
    toStrategyType: string;
    reason: string;
  };
}

export interface AgentConfig {
  provider: 'ollama' | 'opencode' | 'custom_api';
  model: string;
  cycleMinutes: number;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  enabled: boolean;
  autoApply: boolean;
  minConfidence: number;
  apiKey?: string;
  apiUrl?: string;
}

interface MarketStats {
  priceMin: number;
  priceMax: number;
  priceMean: number;
  priceStdDev: number;
  spreadPercent: number;
  spikeCount: number;
  avgSpikeHeight: number;
  maxSpikeHeight: number;
  trendDirection: 'UP' | 'DOWN' | 'FLAT';
  trendStrength: number;
  volatilityRatio: number;
}

// --- Config ---

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';

// Strategy-type-specific optimization guidance blocks
const STRATEGY_TYPE_GUIDANCE: Record<string, string> = {
  scalping: `STRATEGY TYPE: scalping (Range Spike Scalper)
Optimizable parameters (in "settings" field):
- floorWindow: 100–2000 Ticks (window for floor calculation)
- spikeThreshold: 0.05–5.0% (minimum spike above floor)
- sellDropThreshold: 0.03–2.0% (drop from peak → SELL)
- cooldownTicks: 2–20 (cooldown after trade)
Recommendations by regime:
- RANGING: normal thresholds, adjust aggressiveness based on win rate
- TRENDING: increase spikeThreshold (>1.5%), reduce aggressiveness
- DEAD: lower spikeThreshold (<0.15%) or set aggressiveness to minimum
- VOLATILE: increase sellDropThreshold, reduce aggressiveness`,

  trend: `STRATEGY TYPE: trend (EMA Trend Following)
Optimizable parameters (in "strategyAdjustments.indicators" array):
- EMA_fast period: 5–20 (shorter EMA, reacts faster)
- EMA_slow period: 20–100 (longer EMA, trend filter)
- RSI filter level: 40–60 (RSI must be above/below this value)
Recommendations by regime:
- TRENDING: preferred regime, EMA crossovers are reliable
- RANGING: reduce EMA spread, set filter level to ~50
- VOLATILE: widen EMA spread to reduce false signals
- DEAD: minimum aggressiveness, no new positions`,

  mean_reversion: `STRATEGY TYPE: mean_reversion (RSI Mean Reversion)
Optimizable parameters (in "strategyAdjustments.indicators" field):
- RSI period: 7–21 (shorter periods = more sensitive)
- RSI oversold threshold: 20–40 (buy signal when RSI is below)
- RSI overbought threshold: 60–80 (sell signal when RSI is above)
- BB std_dev: 1.5–2.5 (width of Bollinger Bands)
Recommendations by regime:
- RANGING: preferred regime, mean reversion works well
- TRENDING: tighten oversold/overbought thresholds (30/70 → 25/75)
- VOLATILE: widen thresholds (20/80), strongly reduce aggressiveness
- DEAD: few signals expected, minimum aggressiveness`,

  breakout: `STRATEGY TYPE: breakout (Bollinger/ATR Breakout)
Optimizable parameters (in "strategyAdjustments.indicators" field):
- ATR period: 10–20 (Average True Range for volatility)
- ATR multiplier: 1.0–3.0 (breakout threshold = ATR × multiplier)
- confirmation_bars: 1–5 (candles above breakout level for confirmation)
Recommendations by regime:
- VOLATILE: preferred regime, increase ATR multiplier (2–3x)
- RANGING: many false breakouts → high ATR multiplier (>2.5)
- TRENDING: breakouts can be true trend continuations
- DEAD: breakouts unlikely, minimum aggressiveness
NOTE: DexScreener provides no actual volume (always 0). Volume-based conditions are unreliable.`,

  momentum: `STRATEGY TYPE: momentum (MACD / ROC Momentum)
Optimizable parameters (in "strategyAdjustments.indicators" field):
- MACD fast period: 8–16 (default: 12)
- MACD slow period: 20–30 (default: 26)
- MACD signal period: 7–12 (default: 9)
- ROC period: 5–20 (Rate of Change period)
- histogram_threshold: 0–0.001 (minimum histogram for signal)
Recommendations by regime:
- TRENDING: preferred regime, momentum signals are reliable
- RANGING: increase histogram_threshold to filter noise
- VOLATILE: increase MACD periods for smoother signals
- DEAD: no momentum signals expected`,

  dca: `STRATEGY TYPE: dca (Dollar Cost Averaging)
Optimizable parameters (in "strategyAdjustments" field):
- dip_depth: 0.5–5.0%
- EMA filter period: 10–50
- max_positions: 1–5
EXAMPLE RESPONSE FOR DCA:
{
  "strategyAdjustments": {
    "indicators": [ { "type": "EMA", "period": 110 } ],
    "risk_management": { "position_size": 0.03, "max_positions": 4 },
    "entry_condition_hints": "RSI threshold to 35 for better entries"
  }
}
Recommendations by regime:
- DEAD/RANGING: preferred regime for DCA accumulation
- VOLATILE: higher dip_depth threshold, reduce max_positions
- TRENDING (down): ideal for DCA during falling prices
- TRENDING (up): DCA can become too expensive, pause`,

  grid: `STRATEGY TYPE: grid (Grid Trading)
Optimizable parameters (in "strategyAdjustments" field):
- grid_levels: 5–50 (number of grid levels)
- grid_range_percent: 2–30% (total width of grid around current price)
Recommendations by regime:
- RANGING: preferred regime, tight grid with many levels
- VOLATILE: wider grid, fewer levels
- TRENDING: shift grid range up/down
- DEAD: very tight grid, minimum positions`,
};

// Common sections shared by all strategy types
export const COMMON_SYSTEM_PROMPT_HEADER = `You are a professional trading analysis agent for a Solana SPL Token bot.

TASK:
Analyze the market data and recommend optimized parameters for the NEXT cycle.
Consider historical regime performance, time-window performance, drift alerts,
lessons learned, and the outcomes of previous recommendations.

REFLECTION STEP (mandatory before JSON output):
1. Look at YOUR PREVIOUS RECOMMENDATION in the "RECENT ANALYSES + OUTCOMES" block.
2. Look at its OUTCOME (PnL, WR, n).
3. Look at "TIME-WINDOW PERFORMANCE" and "LESSONS LEARNED" — these are recurring patterns.
4. State one sentence inside "analysis": "I am correcting X because Y" or "I am keeping X because Y".
5. Then output the JSON.

Answer ONLY with valid JSON in this format (no Markdown blocks):
{
  "regime": "RANGING|TRENDING|DEAD|VOLATILE",
  "confidence": 0.0-1.0,
  "reason": "short explanation (max 120 chars)",
  "analysis": "detailed analysis 2-3 sentences, MUST start with reflection sentence",
  "aggressiveness": 10,
  "settings": {
    "spikeThreshold": number,
    "sellDropThreshold": number,
    "floorWindow": number,
    "cooldownTicks": number
  },
  "strategyAdjustments": {
    "indicators": [ { "type": "NAME", "period": number } ],
    "risk_management": { "position_size": number, "max_positions": number },
    "entry_condition_hints": "optional free-text hint"
  },
  "strategySwitch": {
    "fromStrategyType": "scalping",
    "toStrategyType": "momentum",
    "reason": "scalping WR 28% in VOLATILE over 30 trades"
  }
}

"strategySwitch" is OPTIONAL. Only include it if the bot's current strategy type
is consistently underperforming and a different type is clearly better supported by
the data. Do not switch lightly; switching resets warmup and indicator state.

REGIME CLASSIFICATION:
- RANGING: Price moves in a tight range, no clear direction
- TRENDING: Clear upward or downward movement over multiple time periods
- VOLATILE: Strong fast fluctuations in both directions
- DEAD: Very low movement, minimal volume/interest

AGGRESSIVENESS RULES (position_size % of balance per trade, AI recommended):
- RANGING + Win-Rate > 65%: increase aggressiveness (max 60)
- RANGING + Win-Rate 50-65%: maintain aggressiveness
- RANGING + Win-Rate < 50%: decrease aggressiveness
- VOLATILE or TRENDING: strongly decrease aggressiveness (max 20)
- DEAD: aggressiveness to minimum (5-10)
- Bounds: min 5, max 80 — User upper limit is enforced separately
- Change aggressiveness ONLY if sufficient data exists (min 5 trades)

DATA LIMITATION:
DexScreener provides no actual volume (Volume = 0 in all candles).
VWAP-based conditions and volume-dependent signals are therefore unreliable.
GeckoTerminal provides real USD volume when available (falls back to 0 if not).

INDICATOR FORMAT: "VALUE (LABEL) ARROW [prev→prev→last]"
Arrow: ↑=rising >1.5%, ↓=falling >1.5%, →=stable
BB %B: 0.0=at lower band, 1.0=at upper band, >1.0=breakout above upper
STOCH: K/D >80=overbought, <20=oversold; K>D=bullish crossover signal
SPARKLINE: ▁▂▃▄▅▆▇█ = low→high price, left=older, right=newer`;

export function buildSystemPrompt(strategyType: string, customGuidance?: string): string {
  const typeGuidance = STRATEGY_TYPE_GUIDANCE[strategyType] ?? STRATEGY_TYPE_GUIDANCE['scalping'];
  let finalGuidance = typeGuidance;
  
  if (customGuidance && customGuidance.trim() !== '') {
    finalGuidance = `${typeGuidance}\n\nCONTEXT / ADDITIONAL RULES FOR THIS BOT:\n${customGuidance}`;
  }
  
  return `${COMMON_SYSTEM_PROMPT_HEADER}\n\n${finalGuidance}`;
}

const DEFAULT_SYSTEM_PROMPT = buildSystemPrompt('scalping');

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  provider: (process.env.OLLAMA_PROVIDER as any) ?? 'ollama',
  model: process.env.OLLAMA_MODEL ?? 'alibaba-cn/qwen3.5-plus',
  cycleMinutes: 21,
  temperature: 0.3,
  maxTokens: 1536,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  enabled: true,
  autoApply: true,
  minConfidence: 0.4,
  apiKey: process.env.OLLAMA_API_KEY ?? '',
  apiUrl: process.env.OLLAMA_API_URL ?? 'http://localhost:11434',
};

// --- Market Stats ---

function calcMarketStats(prices: PricePoint[], settings: PatternSettings): MarketStats {
  const vals = prices.map(p => p.price);
  const n = vals.length;

  const priceMin = Math.min(...vals);
  const priceMax = Math.max(...vals);
  const priceMean = vals.reduce((s, v) => s + v, 0) / n;
  const variance = vals.reduce((s, v) => s + (v - priceMean) ** 2, 0) / n;
  const priceStdDev = Math.sqrt(variance);
  const spreadPercent = ((priceMax - priceMin) / priceMin) * 100;
  const volatilityRatio = (priceStdDev / priceMean) * 100;

  let spikeCount = 0;
  const spikeHeights: number[] = [];
  const windowSize = Math.min(settings.floorWindow, Math.floor(n / 2));

  for (let i = windowSize; i < n; i++) {
    const window = vals.slice(i - windowSize, i);
    const sorted = [...window].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const floor = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    const spike = ((vals[i] - floor) / floor) * 100;
    if (spike >= settings.spikeThreshold) {
      spikeCount++;
      spikeHeights.push(spike);
    }
  }

  const avgSpikeHeight = spikeHeights.length > 0
    ? spikeHeights.reduce((s, v) => s + v, 0) / spikeHeights.length : 0;
  const maxSpikeHeight = spikeHeights.length > 0 ? Math.max(...spikeHeights) : 0;

  const xMean = (n - 1) / 2;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (vals[i] - priceMean);
    den += (i - xMean) ** 2;
  }
  const slope = den !== 0 ? num / den : 0;
  const slopePercent = (slope / priceMean) * 100;
  const trendStrength = Math.min(Math.abs(slopePercent) * 10, 1);
  const trendDirection: 'UP' | 'DOWN' | 'FLAT' =
    slopePercent > 0.01 ? 'UP' : slopePercent < -0.01 ? 'DOWN' : 'FLAT';

  return {
    priceMin, priceMax, priceMean, priceStdDev, spreadPercent,
    spikeCount, avgSpikeHeight, maxSpikeHeight,
    trendDirection, trendStrength, volatilityRatio,
  };
}

// --- Main Agent Class ---

import type { BotManager } from './botManager.js';

export class OllamaAgent {
  config: AgentConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  analyzing = false;

  private analysisQueue: string[] = [];
  private drainingQueue = false;

  private botManager: BotManager | null = null;
  private onAdvice: ((botId: string, advice: OllamaAdvice) => void) | null = null;
  private broadcast: ((eventName: string, data: any) => void) | null = null;

  private adviceHistory: OllamaAdvice[] = [];
  private maxHistoryLength = 100;

  // Timer tracking for next analysis countdown
  private lastAnalysisTime: number | null = null;
  private nextAnalysisTime: number | null = null;

  constructor(config?: Partial<AgentConfig>) {
    const saved = loadAgentConfig() as Partial<AgentConfig> | null;
    this.config = { 
      ...DEFAULT_AGENT_CONFIG, 
      ...(saved ?? {}),
      // .env overrules everything if set
      ...(process.env.OLLAMA_PROVIDER ? { provider: process.env.OLLAMA_PROVIDER as any } : {}),
      ...(process.env.OLLAMA_MODEL ? { model: process.env.OLLAMA_MODEL } : {}),
      ...(process.env.OLLAMA_API_KEY ? { apiKey: process.env.OLLAMA_API_KEY } : {}),
      ...(process.env.OLLAMA_API_URL ? { apiUrl: process.env.OLLAMA_API_URL } : {}),
      ...(config ?? {}) 
    };
    if (saved) {
      console.log(`[OllamaAgent] Config geladen (provider=${this.config.provider}, model=${this.config.model})`);
    }
  }

  connect(
    botManager: BotManager,
    onAdvice: (botId: string, advice: OllamaAdvice) => void,
    broadcast?: (eventName: string, data: any) => void,
  ): void {
    this.botManager = botManager;
    this.onAdvice = onAdvice;
    this.broadcast = broadcast ?? null;
  }

  start(): void {
    if (this.running) return;
    this.config.enabled = true;
    this.running = true;
    console.log(`[OllamaAgent] Gestartet - Modell: ${this.config.model}, Zyklus: ${this.config.cycleMinutes} Min`);
    logger.system(`Ollama AI Agent gestartet (Modell: ${this.config.model}).`);

    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      if (!this.running) return;
      this.runCycle();
      // Set next analysis time after first run
      this.lastAnalysisTime = Date.now();
      this.nextAnalysisTime = Date.now() + this.config.cycleMinutes * 60_000;
      this.timer = setInterval(() => {
        this.runCycle();
        // Update times after each cycle
        this.lastAnalysisTime = Date.now();
        this.nextAnalysisTime = Date.now() + this.config.cycleMinutes * 60_000;
      }, this.config.cycleMinutes * 60_000);
    }, 5000);
  }

  stop(): void {
    this.running = false;
    this.config.enabled = false;
    if (this.startupTimer) { clearTimeout(this.startupTimer); this.startupTimer = null; }
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.lastAnalysisTime = null;
    this.nextAnalysisTime = null;
    console.log('[OllamaAgent] Gestoppt');
    logger.system('Ollama AI Agent gestoppt.');
  }

  updateConfig(updates: Partial<AgentConfig>): void {
    const cycleMinutesChanged =
      updates.cycleMinutes !== undefined && updates.cycleMinutes !== this.config.cycleMinutes;

    Object.assign(this.config, updates);
    saveAgentConfig(this.config);
    console.log('[OllamaAgent] Config aktualisiert:', JSON.stringify(updates));

    // Wenn cycleMinutes geändert wurde und der Agent läuft, Timer sofort aktualisieren
    if (cycleMinutesChanged && this.running) {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      // Recalculate next analysis time based on new cycle
      const now = Date.now();
      if (this.lastAnalysisTime) {
        // Use last analysis time as reference
        this.nextAnalysisTime = this.lastAnalysisTime + this.config.cycleMinutes * 60_000;
      } else {
        // No previous analysis yet - schedule from now
        this.nextAnalysisTime = now + this.config.cycleMinutes * 60_000;
      }
      this.timer = setInterval(() => {
        this.runCycle();
        this.lastAnalysisTime = Date.now();
        this.nextAnalysisTime = Date.now() + this.config.cycleMinutes * 60_000;
      }, this.config.cycleMinutes * 60_000);
      console.log(`[OllamaAgent] Timer aktualisiert: Zyklus jetzt ${this.config.cycleMinutes} Min, nächste Analyse um ${new Date(this.nextAnalysisTime).toLocaleTimeString()}`);
    }
  }

  async listModels(): Promise<OllamaModel[]> {
    try {
      const res = await fetch(`${OLLAMA_URL}/api/tags`);
      if (!res.ok) return [];
      const data = await res.json() as { models: OllamaModelRaw[] };
      return data.models.map((m: OllamaModelRaw) => ({
        name: m.name,
        size: m.size,
        parameter_size: m.details?.parameter_size,
        family: m.details?.family,
      }));
    } catch { return []; }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${OLLAMA_URL}/api/tags`);
      return res.ok;
    } catch { return false; }
  }

  private enqueueBot(botId: string): void {
    if (!this.analysisQueue.includes(botId)) {
      this.analysisQueue.push(botId);
    }
  }

  private async runCycle(): Promise<void> {
    if (!this.botManager) { console.warn('[OllamaAgent] Kein BotManager'); return; }

    console.log('[OllamaAgent] Prüfe Bots für Analyse-Zyklus...');
    const allBots = this.botManager.getAllBots();
    if (allBots.length === 0) return;

    for (const bot of allBots) {
      const state = bot.getState();
      if (state.status !== 'stopped') this.enqueueBot(bot.id);
    }

    if (this.analysisQueue.length > 0) {
      this.drainQueue();
    }
  }

  private async drainQueue(): Promise<void> {
    if (this.drainingQueue) return;
    this.drainingQueue = true;

    try {
      while (this.analysisQueue.length > 0) {
        const botId = this.analysisQueue.shift();
        if (!botId) continue;
        
        const bot = this.botManager?.getBot(botId);
        if (!bot) continue;

        this.analyzing = true;
        try {
          await this.analyzeBot(bot);
        } catch (err) {
          console.error(`[OllamaAgent] Fehler bei Bot ${bot.name}:`, (err as Error).message);
        } finally {
          this.analyzing = false;
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } finally {
      this.drainingQueue = false;
    }
  }

  private async analyzeBot(bot: BotInstance): Promise<void> {
    const state = bot.getState();
    const botTokenMint = state.mintAddress;
    const settings = bot.getSettings();
    const cutoff = Date.now() - this.config.cycleMinutes * 60_000;

    const feed = PriceFeed.getInstance();
    let allHistory = feed.getHistory(state.mintAddress);
    
    // IF we have very little in-memory data, try fetching from SQLite
    if (allHistory.length < 100) {
      try {
        const dbEntries = getLiveFeedEntries(state.mintAddress, 1000);
        if (dbEntries.length > 0) {
          const dbPoints = dbEntries.map(e => ({ timestamp: e.timestamp, price: e.price }));
          // Merge and deduplicate
          const combined = [...allHistory, ...dbPoints]
            .sort((a, b) => a.timestamp - b.timestamp)
            .filter((p, i, self) => i === 0 || p.timestamp !== self[i - 1].timestamp);
          allHistory = combined;
        }
      } catch (err) {
        console.warn(`[OllamaAgent] DB-Preise für ${state.name} nicht ladbar:`, (err as Error).message);
      }
    }

    const recentPrices = allHistory.filter((p: PricePoint) => p.timestamp >= cutoff);

    // ADR-011 Phase D: generate new lessons first (broadcast via SSE), then fetch
    // the full current set (existing + new) for prompt and bonus-confidence check.
    let lessons: LessonEntry[] = [];
    try {
      const newLessons = generateLessons(state.id);
      if (newLessons.length > 0) {
        console.log(`[OllamaAgent] Generated ${newLessons.length} new lessons for Bot ${state.name}`);
        for (const lesson of newLessons) {
          this.broadcast?.('agent_lesson', { type: 'agent_lesson', botId: state.id, lesson });
        }
      }
      const maxLessons = parseInt(process.env.AI_LESSONS_MAX_PER_BOT ?? '5', 10);
      const lookbackDays = parseInt(process.env.AI_LESSONS_LOOKBACK_DAYS ?? '7', 10);
      lessons = getLessonsForBot(state.id, maxLessons, lookbackDays);
    } catch (err) {
      console.warn(`[OllamaAgent] Lessons-Generator Fehler: ${(err as Error).message}`);
    }

    if (recentPrices.length < 10) {
      const msg = `Skipped: Not enough data (${recentPrices.length}/10)`;
      console.log(`[OllamaAgent] Bot ${state.name}: ${msg}`);
      logger.info(state.id, 'AI_AGENT', msg);
      
      saveAgentHistory(
        state.id,
        'SKIPPED',
        0,
        msg,
        '',
        null,
        false,
        undefined,
        state.strategyId ?? undefined
      );
      return;
    }

    const recentStats = calcMarketStats(recentPrices, settings);
    const longTermStats = allHistory.length > recentPrices.length
      ? calcMarketStats(allHistory, settings)
      : null;

    let recentTrades: TradeSummary[] = [];
    try {
      const rows = db.prepare(
        'SELECT * FROM trades WHERE botId = ? AND timestamp >= ?'
      ).all(state.id, cutoff) as TradeLogEntry[];
      recentTrades = rows.map(r => ({
        action: r.action,
        price: typeof r.price === 'number' ? r.price : 0,
        spikePercent: typeof r.spikePercent === 'number' ? r.spikePercent : 0,
        pnlPercent: typeof r.pnlPercent === 'number' ? r.pnlPercent : undefined,
      }));
    } catch (err) {
      console.warn(`[OllamaAgent] Trades nicht ladbar: ${(err as Error).message}`);
    }

    const regimePerf = getRegimePerformance(state.id);
    const recentAdvices = getRecentAdvicesWithOutcomes(state.id, 5);

    // ADR-011 Phase A: time-window + drift for prompt
    const minSamples = parseInt(process.env.AI_TIMEWINDOW_MIN_SAMPLES ?? '5', 10);
    const driftThreshold = parseInt(process.env.AI_DRIFT_THRESHOLD_PCT ?? '20', 10);
    const hourPerf: TimeWindowPerformance[] = getTimeWindowPerformance(state.id, 'hour_of_day', minSamples);
    const dayPerf: TimeWindowPerformance[] = getTimeWindowPerformance(state.id, 'weekday', minSamples);
    const hourDrift: TimeWindowDrift[] = detectTimeWindowDrift(state.id, 'hour_of_day', driftThreshold, minSamples);
    const dayDrift: TimeWindowDrift[] = detectTimeWindowDrift(state.id, 'weekday', driftThreshold, minSamples);

    // Open position state for the prompt
    let openPositionBlock: string | undefined;
    try {
      const traderStats = bot.getTrader().getStats();
      const pos = traderStats.currentPosition;
      if (pos) {
        const ageMin = Math.round((Date.now() - pos.entryTime) / 60000);
        const currentPrice = recentPrices.length > 0 ? recentPrices[recentPrices.length - 1].price : 0;
        const unrealizedPnl = pos.entryPrice > 0 && currentPrice > 0
          ? ((currentPrice - pos.entryPrice) / pos.entryPrice * 100).toFixed(2)
          : null;
        openPositionBlock = `OPEN POSITION:
- Entry: $${pos.entryPrice.toFixed(6)} at ${new Date(pos.entryTime).toISOString().slice(11, 16)} (${ageMin} min ago)
- Unrealized PnL: ${unrealizedPnl !== null ? `${Number(unrealizedPnl) >= 0 ? '+' : ''}${unrealizedPnl}%` : 'n/a'}`;
      } else {
        openPositionBlock = 'OPEN POSITION: None';
      }
    } catch {
      // Non-critical — skip if trader not accessible
    }

    // Trigger GeckoTerminal background refresh for this token (non-blocking, cached)
    if (botTokenMint) geckoTerminalFeed.getLatest(botTokenMint);

    const prompt = await this.buildPrompt(
      recentStats,
      longTermStats,
      recentTrades,
      settings,
      recentPrices,
      allHistory,
      regimePerf,
      recentAdvices,
      state,
      botTokenMint,
      openPositionBlock,
      { hourPerf, dayPerf, hourDrift, dayDrift, lessons },
    );

    const activeStrategyType = (state as any).strategyType ?? 'scalping';
    console.log(`[OllamaAgent] Analyzing Bot ${state.name} with ${this.config.model} (Strategy: ${activeStrategyType})...`);
    
    const systemPrompt = bot.getEffectiveSystemPrompt((type: string, custom?: string) => buildSystemPrompt(type, custom));
    
    logger.info(state.id, 'AI_AGENT', `Analysis cycle started (${recentPrices.length} points, ${allHistory.length} total)...`);

    let response: string;
    try {
      response = await this.queryAI(prompt, systemPrompt);
    } catch (err) {
      logger.error(state.id, 'AI_AGENT', `KI-Anfrage Fehler: ${(err as Error).message}`);
      throw err;
    }

    const advice = this.parseResponse(response, settings, lessons);

    if (!advice) {
      logger.warn(state.id, 'AI_AGENT', "Analysis failed: No valid JSON received.");
      saveAgentHistory(
        state.id,
        'ERROR',
        0,
        "Analysis failed: No valid JSON received.",
        '',
        null,
        false,
        undefined,
        (state as any).strategyId ?? undefined
      );
      return;
    }

    const applied = this.config.autoApply && advice.confidence >= this.config.minConfidence;

    saveAgentHistory(
      state.id,
      advice.regime,
      advice.confidence,
      advice.reason,
      advice.analysis,
      advice.adjustedSettings,
      applied,
      advice.aggressiveness,
      (state as any).strategyId ?? undefined,
    );

    this.adviceHistory.unshift(advice);
    if (this.adviceHistory.length > this.maxHistoryLength) this.adviceHistory.pop();

    this.onAdvice?.(state.id, advice);

    if (applied) {
      if (Object.keys(advice.adjustedSettings).length > 0) {
        bot.updateSettings(advice.adjustedSettings);
      }
      if (advice.aggressiveness !== undefined) {
        bot.setAgentAggressiveness(advice.aggressiveness);
      }
      if (advice.strategyAdjustments) {
        bot.applyStrategyAdjustments(advice.strategyAdjustments);
      }
      // ADR-011 Phase B: strategy switch with safety gate
      if (advice.strategySwitch) {
        const sw = advice.strategySwitch;
        const allowAuto = (process.env.AI_ALLOW_STRATEGY_SWITCH ?? '0') === '1';
        const minConf = parseFloat(process.env.AI_MIN_SWITCH_CONFIDENCE ?? '0.7');
        if (!allowAuto) {
          console.log(`[OllamaAgent] Strategy-Switch vorgeschlagen (${sw.fromStrategyType} → ${sw.toStrategyType}), aber AI_ALLOW_STRATEGY_SWITCH=0. UI-Confirmation erforderlich.`);
          logger.info(state.id, 'AI_AGENT', `Strategy switch proposed but disabled (${sw.fromStrategyType} → ${sw.toStrategyType}). UI confirmation required.`);
        } else if (advice.confidence < minConf) {
          console.log(`[OllamaAgent] Strategy-Switch blockiert: confidence ${(advice.confidence * 100).toFixed(0)}% < MIN_SWITCH_CONFIDENCE ${(minConf * 100).toFixed(0)}%`);
          logger.info(state.id, 'AI_AGENT', `Strategy switch blocked: confidence below threshold.`);
        } else {
          const result = await bot.applyStrategySwitch(sw.toStrategyType, sw.reason);
          if (result) {
            this.broadcast?.('state', this.botManager?.getAllStates());
          }
        }
      }
      console.log(`[OllamaAgent] Bot ${state.name} aktualisiert. Regime=${advice.regime}, Conf=${(advice.confidence * 100).toFixed(0)}%, Aggr=${advice.aggressiveness ?? '-'}%`);
      logger.action(state.id, 'AI_AGENT', `AI Updated! Regime: ${advice.regime}, Grund: ${advice.reason}`);
    } else {
      console.log(`[OllamaAgent] Bot ${state.name} Analyse gespeichert (nicht angewendet: Conf=${(advice.confidence * 100).toFixed(0)}%)`);
      logger.info(state.id, 'AI_AGENT', `Analyse fertig (nicht angewendet). Confidence: ${(advice.confidence * 100).toFixed(0)}%`);
    }
  }

  private async buildPrompt(
    stats: MarketStats,
    longTermStats: MarketStats | null,
    trades: TradeSummary[],
    settings: PatternSettings,
    recentPrices: PricePoint[],
    allPrices: PricePoint[],
    regimePerf: RegimePerformance[],
    recentAdvices: RecentAdvice[],
    state: BotState,
    tokenMint?: string,
    openPositionBlock?: string,
    extra?: {
      hourPerf: TimeWindowPerformance[];
      dayPerf: TimeWindowPerformance[];
      hourDrift: TimeWindowDrift[];
      dayDrift: TimeWindowDrift[];
      lessons: LessonEntry[];
    },
  ): Promise<string> {
    // ASCII sparkline replaces verbose raw price samples (~310 token savings)
    const priceValues = recentPrices.map(p => p.price);
    const sparkline = buildAsciiSparkline(priceValues, 30);

    const sells = trades.filter(t => t.action === 'SELL');
    const wins = sells.filter(t => (t.pnlPercent ?? 0) > 0).length;
    const winRate = sells.length > 0 ? Math.round((wins / sells.length) * 100) : null;
    const avgPnl = sells.length > 0
      ? (sells.reduce((s, t) => s + (t.pnlPercent ?? 0), 0) / sells.length).toFixed(3)
      : null;

    // Trade pattern stats: profit factor + consecutive wins/losses
    let tradePatternBlock = '';
    if (sells.length >= 2) {
      const sellPnls = sells.map(t => t.pnlPercent ?? 0);
      const winPnls = sellPnls.filter(p => p > 0);
      const lossPnls = sellPnls.filter(p => p < 0);
      const sumWin = winPnls.reduce((a, b) => a + b, 0);
      const sumLoss = Math.abs(lossPnls.reduce((a, b) => a + b, 0));
      const avgWin = winPnls.length > 0 ? sumWin / winPnls.length : 0;
      const avgLoss = lossPnls.length > 0 ? sumLoss / lossPnls.length : 0;
      const profitFactor = sumLoss > 0 ? (sumWin / sumLoss).toFixed(2) : '∞';
      let maxConsecWins = 0, maxConsecLosses = 0, curW = 0, curL = 0;
      for (const p of sellPnls) {
        if (p > 0) { curW++; curL = 0; maxConsecWins = Math.max(maxConsecWins, curW); }
        else { curL++; curW = 0; maxConsecLosses = Math.max(maxConsecLosses, curL); }
      }
      tradePatternBlock = `\nTRADE PATTERN STATS:
- Profit Factor: ${profitFactor}  (avgWin:+${avgWin.toFixed(3)}% / avgLoss:-${avgLoss.toFixed(3)}%)
- Max Consecutive Wins: ${maxConsecWins} | Max Consecutive Losses: ${maxConsecLosses}`;
    }

    // Compact trade list (one line per trade)
    let tradesBlock: string;
    if (trades.length === 0) {
      tradesBlock = 'No trades in this period';
    } else {
      tradesBlock = trades.map(t => {
        const pnlStr = t.pnlPercent !== undefined ? `  pnl:${t.pnlPercent > 0 ? '+' : ''}${t.pnlPercent.toFixed(3)}%` : '';
        return `${t.action}  $${(t.price ?? 0).toFixed(6)}  spike:${(t.spikePercent ?? 0).toFixed(2)}%${pnlStr}`;
      }).join('\n');
    }

    let regimePerfBlock = 'No historical data available yet.';
    if (regimePerf.length > 0) {
      regimePerfBlock = regimePerf.map(r =>
        `- ${r.regime}: ${r.winRate}% win rate, avg PnL ${(r.avgPnl ?? 0).toFixed(3)}%, ${r.totalTrades} trades`
      ).join('\n');
    }

    let recentAdvicesBlock = 'No previous analyses available.';
    if (recentAdvices.length > 0) {
      recentAdvicesBlock = recentAdvices.map(a => {
        const dt = new Date(a.timestamp).toISOString().slice(0, 16).replace('T', ' ');
        const outcome = (a.outcomeTradeCount ?? 0) > 0 && (a.outcomeTotalPnl ?? 0) !== 0
          ? `${a.outcomeTradeCount ?? 0} trades, avg PnL ${((a.outcomeTotalPnl ?? 0) / (a.outcomeTradeCount ?? 1)).toFixed(3)}%`
          : 'no trade outcome';
        return `- ${dt} | ${a.regime} conf:${(a.confidence * 100).toFixed(0)}% aggr:${a.aggressivenessAdvice ?? '-'}% → ${outcome}`;
      }).join('\n');
    }

    // ADR-011 Phase C: time-window + drift + lessons blocks
    const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const topHours = (extra?.hourPerf ?? []).slice(0, 5);
    const topDays = (extra?.dayPerf ?? []).slice(0, 5);
    const driftAlerts = [...(extra?.hourDrift ?? []), ...(extra?.dayDrift ?? [])].slice(0, 3);

    let timeWindowBlock = 'No time-window data (need ≥ min-sample trades per bucket).';
    if (topHours.length > 0 || topDays.length > 0) {
      const lines: string[] = [];
      if (topHours.length > 0) {
        lines.push('Hours (UTC):');
        for (const h of topHours) {
          lines.push(`- ${String(h.bucket).padStart(2, '0')}:00: WR ${h.winRate}% (n=${h.tradeCount}, avg PnL ${h.avgPnl.toFixed(2)}%)`);
        }
      }
      if (topDays.length > 0) {
        lines.push('Weekdays (UTC):');
        for (const d of topDays) {
          const name = WEEKDAY_NAMES[d.bucket] ?? `d${d.bucket}`;
          lines.push(`- ${name}: WR ${d.winRate}% (n=${d.tradeCount}, avg PnL ${d.avgPnl.toFixed(2)}%)`);
        }
      }
      timeWindowBlock = lines.join('\n');
    }

    let driftBlock = 'No drift alerts.';
    if (driftAlerts.length > 0) {
      driftBlock = driftAlerts.map(d => {
        const tag = d.sampleSize >= 20 ? 'CRITICAL' : 'WARN';
        const dir = d.delta > 0 ? 'outperforming' : 'underperforming';
        return `- [${tag}] bucket ${d.bucket}: ${d.windowWR}% vs bot overall ${d.overallWR}% (Δ ${d.delta > 0 ? '+' : ''}${d.delta}%, n=${d.sampleSize}) — ${dir}`;
      }).join('\n');
    }

    let lessonsBlock = 'No specific lessons yet.';
    if ((extra?.lessons ?? []).length > 0) {
      lessonsBlock = (extra?.lessons ?? []).map((l, idx) =>
        `${idx + 1}. [${l.category}] ${l.lesson}`
      ).join('\n');
    }

    const strategyInfo = state.strategyType
      ? `Active Strategy: ${state.strategyType} (ID: ${state.strategyId ?? 'legacy'})`
      : 'Active Strategy: scalping (PatternDetector, Legacy Mode)';

    // Pre-calculated Technical Indicators
    const m5Candles = buildVirtualCandles(allPrices, 5 * 60000);
    const m15Candles = buildVirtualCandles(allPrices, 15 * 60000);

    // Compact candle table helper
    const formatCandleRows = (candles: typeof m5Candles, count: number): string => {
      const slice = candles.slice(-count);
      if (slice.length === 0) return '(no data)';
      return slice.map(c => {
        const t = new Date(c.timestamp).toISOString().split('T')[1].slice(0, 5);
        const dir = c.close >= c.open ? '↑' : '↓';
        return `${t}|${c.open.toFixed(6)}|${c.high.toFixed(6)}|${c.low.toFixed(6)}|${c.close.toFixed(6)}${dir}`;
      }).join('\n');
    };

    const indicators5m = calculatePreProcessedIndicators(m5Candles);
    const indicators15m = calculatePreProcessedIndicators(m15Candles);

    const macro = macroFeed.getLatestMacro();
    let macroBlock = 'MACRO DATA: Not available';
    if (macro) {
       macroBlock = `MACRO DATA:
- BTC: $${macro.btcPrice.toFixed(0)} (${macro.btcTrend1h > 0 ? '+' : ''}${macro.btcTrend1h.toFixed(2)}% 24h)
- SOL: $${macro.solPrice.toFixed(2)}`;
    }

    // Fetch DexScreener On-Chain Sentiment — extended with multi-window price changes + buy/sell ratio
    let tokenContextBlock = 'ON-CHAIN SENTIMENT: Not available';
    if (tokenMint) {
      try {
        const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
        const dexJson = await res.json();
        if (dexJson.pairs && dexJson.pairs.length > 0) {
          const pair = dexJson.pairs[0];
          const vol1h = pair.volume?.h1 ?? 0;
          const vol24h = pair.volume?.h24 ?? 0;
          const liqUsd = pair.liquidity?.usd ?? 0;
          const buys1h = pair.txns?.h1?.buys ?? 0;
          const sells1h = pair.txns?.h1?.sells ?? 0;
          const buys24h = pair.txns?.h24?.buys ?? 0;
          const sells24h = pair.txns?.h24?.sells ?? 0;
          const pc5m = pair.priceChange?.m5 ?? null;
          const pc1h = pair.priceChange?.h1 ?? null;
          const pc6h = pair.priceChange?.h6 ?? null;
          const pc24h = pair.priceChange?.h24 ?? null;
          const ratio1h = sells1h > 0 ? (buys1h / sells1h).toFixed(2) : '∞';
          const pcFmt = (v: number | null) => v !== null ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%` : 'n/a';
          tokenContextBlock = `ON-CHAIN SENTIMENT (DexScreener):
- Liquidity: $${liqUsd.toLocaleString(undefined, {maximumFractionDigits: 0})} | Vol 1h: $${vol1h.toLocaleString(undefined, {maximumFractionDigits: 0})} | Vol 24h: $${vol24h.toLocaleString(undefined, {maximumFractionDigits: 0})}
- Price Change: 5m:${pcFmt(pc5m)} 1h:${pcFmt(pc1h)} 6h:${pcFmt(pc6h)} 24h:${pcFmt(pc24h)}
- Txns 1h: ${buys1h} buys / ${sells1h} sells (ratio: ${ratio1h}) | 24h: ${buys24h} buys / ${sells24h} sells`;
        }
      } catch (err: any) {
        logger.warn(state.id, 'AI_AGENT', `[OllamaAgent] Failed to fetch DexScreener REST data: ${err.message}`);
      }
    }

    let currentSettingsBlock = '';
    if (state.strategyType === 'scalping' || !state.strategyType) {
      currentSettingsBlock = `CURRENT SETTINGS:
- floorWindow: ${settings.floorWindow}
- spikeThreshold: ${settings.spikeThreshold}%
- sellDropThreshold: ${settings.sellDropThreshold}%
- cooldownTicks: ${settings.cooldownTicks}`;
    } else if (state.strategyConfig) {
      const config = state.strategyConfig;
      currentSettingsBlock = `CURRENT STRATEGY PARAMETERS (${state.strategyType}):
- Risk: position_size=${((config.risk_management?.position_size ?? 0) * 100).toFixed(1)}%
- Max Positions: ${config.risk_management?.max_positions ?? 1}
- Indicators: ${JSON.stringify(config.indicators ?? [])}`;
      if (state.strategyType === 'dca' && config.scalping_settings) {
        currentSettingsBlock += `\n- DCA Dip Thresholds: ${JSON.stringify(config.scalping_settings)}`;
      }
    }

    // GeckoTerminal real volume block (non-blocking cached, graceful fallback)
    const geckoBlock = tokenMint ? geckoTerminalFeed.formatPromptBlock(tokenMint) : '';

    const dataBlock = `${currentSettingsBlock}

CURRENT AGGRESSIVENESS:
- Current (AI): ${state.aiAggressiveness ?? 10}%
- Maximum (User): ${state.aggressiveness ?? 10}%

${strategyInfo}
${openPositionBlock ? `\n${openPositionBlock}` : ''}
${macroBlock}
${tokenContextBlock}
${geckoBlock ? `\n${geckoBlock}` : ''}

PRICE ACTION (last ${recentPrices.length} ticks, ${this.config.cycleMinutes} min):
${sparkline}

PRE-CALCULATED INDICATORS:
[5-Minute Data]
- RSI (14): ${indicators5m.rsi}
- MACD: ${indicators5m.macd}
- BB (20,2): ${indicators5m.bb}
- ATR (14): ${indicators5m.atr}
- STOCH (14,3): ${indicators5m.stoch}

[15-Minute Data]
- RSI (14): ${indicators15m.rsi}
- MACD: ${indicators15m.macd}
- BB (20,2): ${indicators15m.bb}
- STOCH (14,3): ${indicators15m.stoch}

MARKET STATS (last ${this.config.cycleMinutes} min):
- Price: Min=$${stats.priceMin.toFixed(8)}, Max=$${stats.priceMax.toFixed(8)}, Mean=$${stats.priceMean.toFixed(8)}
- Spread: ${stats.spreadPercent.toFixed(4)}%  Volatility: ${stats.volatilityRatio.toFixed(4)}%
- Spikes Detected: ${stats.spikeCount} (Avg: ${stats.avgSpikeHeight.toFixed(3)}%, Max: ${stats.maxSpikeHeight.toFixed(3)}%)
- Trend: ${stats.trendDirection} (Strength: ${(stats.trendStrength * 100).toFixed(0)}%)
${longTermStats ? `LONG-TERM STATS (all ${allPrices.length} ticks):
- Spread: ${longTermStats.spreadPercent.toFixed(4)}%  Volatility: ${longTermStats.volatilityRatio.toFixed(4)}%
- Trend: ${longTermStats.trendDirection} (Strength: ${(longTermStats.trendStrength * 100).toFixed(0)}%)` : ''}

TRADES IN PERIOD (${sells.length} completed${winRate !== null ? `, WR:${winRate}%, avgPnL:${avgPnl}%` : ''}):\
${tradePatternBlock}
${tradesBlock}

REGIME PERFORMANCE (historical):
${regimePerfBlock}

TIME-WINDOW PERFORMANCE (per-hour / per-weekday buckets):
${timeWindowBlock}

DRIFT ALERTS (bucket WR vs bot overall):
${driftBlock}

LESSONS LEARNED (recurring patterns):
${lessonsBlock}

RECENT ANALYSES + OUTCOMES:
${recentAdvicesBlock}

5-MINUTE OHLC (last 10, time|open|high|low|close):
${formatCandleRows(m5Candles, 10)}

15-MINUTE OHLC (last 5):
${formatCandleRows(m15Candles, 5)}`;

    return dataBlock;
  }

  private async queryOpencode(userContent: string, systemPrompt?: string): Promise<string> {
    const tempPromptPath = path.join(os.tmpdir(), `bot_prompt_${Date.now()}.txt`);
    const fullPrompt = `${systemPrompt ?? this.config.systemPrompt}\n\n${userContent}`;
    
    try {
      fs.writeFileSync(tempPromptPath, fullPrompt);
      console.log(`[OllamaAgent] Querying opencode CLI (model: ${this.config.model}) via file ${tempPromptPath}...`);
      
      return new Promise((resolve, reject) => {
        // Opencode bietet ein .cmd Wrapper auf Windows, der CLI-kompatibel ist.
        const opencodeCmd = 'C:\\Users\\info\\AppData\\Roaming\\npm\\opencode.cmd';
        const args = [
          'run',
          'Analyze market data from the attached file. Respond ONLY with the requested JSON.',
          '-m', this.config.model,
          '-f', tempPromptPath
        ];
        
        console.log(`[OllamaAgent] Executing: ${opencodeCmd} ${args.join(' ')}`);

        const child = spawn(opencodeCmd, args, { shell: true, timeout: 180000 });

        // WICHTIG: stdin schliessen, sonst haengt der Prozess evtl. (wartet auf Input)
        child.stdin?.end();

        let stdout = '';
        let stderr = '';

        if (child.stdout) {
          child.stdout.on('data', (data) => {
            stdout += data.toString();
          });
        }

        if (child.stderr) {
          child.stderr.on('data', (data) => {
            stderr += data.toString();
          });
        }

        child.on('close', (code) => {
          // Cleanup
          try { if (fs.existsSync(tempPromptPath)) fs.unlinkSync(tempPromptPath); } catch (e) { /* ignore */ }

          if (code !== 0) {
            console.error(`[OllamaAgent] opencode error (Code ${code})`);
            console.error(`[OllamaAgent] Stderr Snippet: ${stderr.slice(0, 500)}`);
            return reject(new Error(`opencode error: ${code} - ${stderr.slice(0, 100)}`));
          }

          // JSON extrahieren (zwischen erstem { und letztem })
          // Wir entfernen vorher moegliche Markdown-Codeblocks
          let normalized = stdout.replace(/```json/g, '').replace(/```/g, '');

          const firstBrace = normalized.indexOf('{');
          const lastBrace = normalized.lastIndexOf('}');
          
          let cleaned = '';
          if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            cleaned = normalized.substring(firstBrace, lastBrace + 1).trim();
          } else {
            cleaned = normalized.trim();
          }
          
          if (cleaned.length > 0) {
            console.log(`[OllamaAgent] opencode returned ${cleaned.length} bytes.`);
          }
          
          // Strip markdown if it persists
          const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
             resolve(jsonMatch[0]);
          } else {
             resolve(cleaned);
          }
        });

        child.on('error', (err) => {
          try { if (fs.existsSync(tempPromptPath)) fs.unlinkSync(tempPromptPath); } catch (e) { /* ignore */ }
          reject(err);
        });
      });
    } catch (err: any) {
      console.error("[OllamaAgent] Opencode execution setup failed:", err.message);
      try { if (fs.existsSync(tempPromptPath)) fs.unlinkSync(tempPromptPath); } catch (e) { /* ignore */ }
      throw err;
    }
  }

  private async queryCustomApi(userContent: string, systemPrompt?: string): Promise<string> {
    const apiUrl = this.config.apiUrl || 'https://api.openai.com/v1/chat/completions';
    const apiKey = this.config.apiKey;

    if (!apiKey) {
      throw new Error("OllamaAgent: provider 'custom_api' requires OLLAMA_API_KEY in .env");
    }

    console.log(`[OllamaAgent] Querying custom API: ${apiUrl} (model: ${this.config.model})`);

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          { role: 'system', content: systemPrompt ?? this.config.systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Custom API ${res.status}: ${errorText || res.statusText}`);
    }

    const data = (await res.json()) as any;
    // Handle standard OpenAI/Anthropic/OpenRouter response format
    return data.choices?.[0]?.message?.content || data.content?.[0]?.text || JSON.stringify(data);
  }

  private async queryAI(userContent: string, systemPrompt?: string): Promise<string> {
    if (this.config.provider === 'opencode') {
      return this.queryOpencode(userContent, systemPrompt);
    }
    
    if (this.config.provider === 'custom_api') {
      return this.queryCustomApi(userContent, systemPrompt);
    }

    // Default: local Ollama
    const baseUrl = this.config.apiUrl || 'http://localhost:11434';
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          { role: 'system', content: systemPrompt ?? this.config.systemPrompt },
          { role: 'user', content: userContent },
        ],
        stream: false,
        think: false,
        options: {
          temperature: this.config.temperature,
          num_predict: this.config.maxTokens,
          top_p: 0.9,
        },
      }),
    });

    if (!res.ok) throw new Error(`Ollama API ${res.status}: ${res.statusText}`);
    const data = (await res.json()) as { message: { content: string } };
    return data.message.content;
  }

  private parseResponse(raw: string, currentSettings: PatternSettings, lessons: LessonEntry[] = []): OllamaAdvice | null {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn('[OllamaAgent] Kein JSON in Antwort:', raw.slice(0, 200));
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        regime?: string;
        confidence?: number;
        reason?: string;
        analysis?: string;
        aggressiveness?: number;
        settings?: Partial<PatternSettings>;
        strategyAdjustments?: {
          indicators?: IndicatorConfig[];
          scalping_settings?: Partial<PatternSettings>;
          risk_management?: { position_size?: number };
          entry_condition_hints?: string;
        };
        strategySwitch?: {
          fromStrategyType?: string;
          toStrategyType?: string;
          reason?: string;
        };
      };

      const regime = (['RANGING', 'TRENDING', 'DEAD', 'VOLATILE'].includes(parsed.regime ?? ''))
        ? parsed.regime as OllamaAdvice['regime']
        : 'RANGING';
      let confidence = Math.max(0, Math.min(1, parsed.confidence ?? 0.5));

      const newSettings: Partial<PatternSettings> = {};
      const s = parsed.settings;
      if (s) {
        if (typeof s.spikeThreshold === 'number') {
          newSettings.spikeThreshold = parseFloat(Math.max(0.05, Math.min(5.0, s.spikeThreshold)).toFixed(3));
        }
        if (typeof s.sellDropThreshold === 'number') {
          newSettings.sellDropThreshold = parseFloat(Math.max(0.03, Math.min(2.0, s.sellDropThreshold)).toFixed(3));
        }
        if (typeof s.floorWindow === 'number') {
          newSettings.floorWindow = Math.max(10, Math.min(50, Math.round(s.floorWindow)));
        }
        if (typeof s.cooldownTicks === 'number') {
          newSettings.cooldownTicks = Math.max(2, Math.min(20, Math.round(s.cooldownTicks)));
        }
      }

      const changedSettings: Partial<PatternSettings> = {};
      const previousSettings: Partial<PatternSettings> = {};
      for (const [key, value] of Object.entries(newSettings)) {
        const k = key as keyof PatternSettings;
        if (currentSettings[k] !== value) {
          (changedSettings as Record<string, number>)[k] = value as number;
          (previousSettings as Record<string, number>)[k] = currentSettings[k] as number;
        }
      }

      let aggressiveness: number | undefined;
      if (typeof parsed.aggressiveness === 'number') {
        aggressiveness = Math.max(5, Math.min(80, Math.round(parsed.aggressiveness)));
      }

      const strategyAdjustments = parsed.strategyAdjustments;

      // ADR-011 Phase B: optional strategy switch
      let strategySwitch: OllamaAdvice['strategySwitch'] | undefined;
      const sw = parsed.strategySwitch;
      if (sw && typeof sw.toStrategyType === 'string' && sw.toStrategyType.length > 0) {
        strategySwitch = {
          fromStrategyType: sw.fromStrategyType ?? 'unknown',
          toStrategyType: sw.toStrategyType,
          reason: sw.reason ?? 'no reason provided',
        };
      }

      // ADR-011 Phase D: Bonus-Confidence when reason/analysis cites a known lesson.
      const bonusEnv = parseFloat(process.env.AI_REFLECTION_BONUS_CONFIDENCE ?? '0.1');
      const bonus = Number.isFinite(bonusEnv) ? bonusEnv : 0.1;
      const reflectionText = `${parsed.reason ?? ''} ${parsed.analysis ?? ''}`.toLowerCase();
      if (bonus > 0 && lessons.length > 0 && reflectionText.length > 0) {
        const cited = lessons.some(l => {
          // Substring match on first 6 normalized words of the lesson
          const head = l.lesson.toLowerCase().split(/\s+/).slice(0, 6).join(' ');
          return head.length >= 6 && reflectionText.includes(head);
        });
        if (cited) {
          confidence = Math.min(1, confidence + bonus);
        }
      }

      return {
        adjustedSettings: changedSettings,
        previousSettings,
        reason: parsed.reason ?? 'Keine Begründung',
        confidence,
        regime,
        analysis: parsed.analysis ?? '',
        timestamp: Date.now(),
        aggressiveness,
        strategyAdjustments,
        strategySwitch,
      };
    } catch (err) {
      console.warn('[OllamaAgent] JSON Parse Fehler:', (err as Error).message);
      console.warn('[OllamaAgent] Raw:', raw.slice(0, 300));
      return null;
    }
  }



  getHistory(botId?: string, limit = 50): RecentAdvice[] {
    return getAgentHistoryFromDb(botId, limit) as RecentAdvice[];
  }

  getStatus(): { running: boolean; analyzing: boolean; config: AgentConfig; historyCount: number; lastAnalysisTime: number | null; nextAnalysisTime: number | null } {
    return {
      running: this.running,
      analyzing: this.analyzing,
      config: { ...this.config },
      historyCount: this.adviceHistory.length,
      lastAnalysisTime: this.lastAnalysisTime,
      nextAnalysisTime: this.nextAnalysisTime,
    };
  }

  triggerAnalysis(botId?: string): void {
    if (!this.botManager) return;

    if (botId) {
      console.log(`[OllamaAgent] Manuelle Analyse für Bot ${botId} ausgelöst`);
      logger.info(botId, 'AI_AGENT', 'Manual analysis queued.');
      this.enqueueBot(botId);
    } else {
      console.log('[OllamaAgent] Manuelle Analyse für ALLE Bots ausgelöst');
      logger.system('Manuelle Analyse-Anfrage für alle Bots erhalten.');
      for (const bot of this.botManager.getAllBots()) {
        this.enqueueBot(bot.id);
      }
    }

    if (this.analysisQueue.length > 0) {
      this.drainQueue();
    }
  }
}
