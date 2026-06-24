// Smart Bot Advisor Engine
// Multi-stage workflow that turns raw trending-pool data into a top-3 list of
// (token, strategy, configuration) recommendations. Each stage is a small,
// testable function; the orchestration lives in `runAdvisorWorkflow`.
//
// Pipeline:
//   1) fetchCandidatePools    — fetch + normalise trending Solana pools
//   2) classifyPoolRegime     — assign a regime (RANGING / TRENDING / VOLATILE /
//                                OVERSOLD / DEAD) using price-change + liquidity
//   3) profileStrategyFit     — score each (pool, template) pair using hard
//                                regime/liquidity gates plus the historical
//                                "similar-profile" win-rate from the DB
//   4) composeBotConfig       — pick concrete bot parameters (position size,
//                                aggressiveness, slippage, max positions) from
//                                the matched strategy + the pool's profile
//   5) calibrateConfidence    — combine base score, historical win-rate
//                                similarity, sample-size confidence and a
//                                backtested profit factor into the final
//                                confidence (0..1)
//   6) rankAndDiversify       — keep only top suggestions, ensure template
//                                diversity, fall back if no good matches
//
// All side-effects (cache, history) stay in `getAdvisorSuggestions`.

import { logger } from './appLogger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './db.js';

const GECKO_BASE = 'https://api.geckoterminal.com/api/v2';
const CACHE_TTL_MS = 5 * 60 * 1000;   // 5 min
const MIN_LIQUIDITY_USD = 5_000;
const MIN_VOLUME_24H_USD = 500;
const MAX_HISTORY = 9;
const MAX_SUGGESTIONS = 3;

export type MarketRegime = 'RANGING' | 'TRENDING_UP' | 'TRENDING_DOWN' | 'VOLATILE' | 'OVERSOLD' | 'DEAD';

export interface AdvisorSuggestion {
  rank: number;
  tokenName: string;
  tokenSymbol: string;
  mintAddress: string;
  poolAddress: string;
  priceUsd: number;
  priceChange1h: number;
  priceChange24h: number;
  volume1h: number;
  volume24h: number;
  liquidity: number;
  templateId: string;
  strategyName: string;
  strategyType: string;
  reasoning: string;
  confidence: number;
  regime: MarketRegime;
  generatedAt: number;
  // Extended fields: concrete bot configuration to start with.
  // All optional for backward compatibility with the existing API.
  suggestedConfig?: SuggestedBotConfig;
  diagnostics?: SuggestionDiagnostics;
}

export interface AdvisorResult {
  suggestions: AdvisorSuggestion[];
  history: AdvisorSuggestion[];
  fetchedAt: number;
}

export interface SuggestedBotConfig {
  positionSizePct: number;     // 1–80 (% of SOL balance per trade)
  aggressivenessPct: number;   // 5–80 (AI aggressiveness dial)
  slippageTolerancePct: number;// e.g. 0.5 = 0.5%
  maxPositions: number;        // 1–5
  stopLossPct: number;         // e.g. 3 = 3% below entry
  takeProfitPct?: number;      // optional TP
  scalpingSettings?: {         // scalping-only knobs (ignored by other strategies)
    cooldownTicks?: number;
    spikeThreshold?: number;
    sellDropThreshold?: number;
    floorWindow?: number;
  };
  /**
   * Advisory only. `positionSizePct` and `aggressivenessPct` are recommendations;
   * the front-end MUST clamp them against `botManager.getUserMaxPositionSize()`
   * before forwarding to `createBot` / `updateBot`. This marker makes the
   * advisory intent explicit in the JSON payload.
   */
  advisoryOnly: true;
}

export interface SuggestionDiagnostics {
  baseScore: number;
  historicalWinRate: number | null;   // % from similar profiles (0..100)
  historicalSampleSize: number;      // n trades used for the historical anchor
  profitFactor: number | null;        // wins sum / |losses sum|
  regimeConfidence: number;           // 0..1
  warnings: string[];                 // human-readable risk notes
}

// --- internal pipeline types ---

interface NormalizedPool {
  poolAddress: string;
  mintAddress: string;
  tokenName: string;
  tokenSymbol: string;
  priceUsd: number;
  h1: number;
  h6: number;
  h24: number;
  vol1h: number;
  vol24h: number;
  liquidity: number;
}

interface PoolRegime {
  regime: MarketRegime;
  confidence: number;       // 0..1
  volatilityRatio: number;  // |h1| / |h24| proxy for choppiness
}

interface StrategyMatch {
  templateId: string;
  strategyName: string;
  strategyType: string;
  baseScore: number;        // 0..1, pure market-fit score
  historicalWinRate: number | null;
  historicalSampleSize: number;
  profitFactor: number | null;
  reasoning: string;
  regime: MarketRegime;
  warnings: string[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'advisor_history.json');

let cache: { result: AdvisorResult; fetchedAt: number } | null = null;

// ---------------------------------------------------------------------------
// Stage 1: fetch + normalise candidate pools
// ---------------------------------------------------------------------------

const GECKO_HEADERS = { Accept: 'application/json;version=20230302' };

async function fetchCandidatePools(): Promise<NormalizedPool[]> {
  const url = `${GECKO_BASE}/networks/solana/trending_pools?include=base_token&page=1`;
  const res = await fetch(url, { headers: GECKO_HEADERS, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`GeckoTerminal returned HTTP ${res.status}`);
  const json = await res.json();

  const pools: any[] = json?.data ?? [];
  const included: any[] = json?.included ?? [];

  const tokenMap = new Map<string, { name: string; symbol: string }>();
  for (const item of included) {
    if (item.type !== 'token') continue;
    const addr = item.attributes?.address ?? item.id?.replace(/^solana_/, '');
    if (addr) tokenMap.set(addr, { name: item.attributes?.name ?? '', symbol: item.attributes?.symbol ?? '' });
  }

  const out: NormalizedPool[] = [];
  for (const pool of pools) {
    const attr = pool.attributes;
    if (!attr) continue;

    const poolAddress: string = attr.address ?? '';
    const baseTokenId: string = pool.relationships?.base_token?.data?.id ?? '';
    const mintAddress = baseTokenId.replace(/^solana_/, '');
    if (!mintAddress || mintAddress.length < 32) continue;

    const info = tokenMap.get(mintAddress);
    const tokenSymbol = info?.symbol || attr.name?.split(' /')[0]?.trim() || mintAddress.slice(0, 6);
    const tokenName = info?.name || tokenSymbol;

    const h1 = parseFloat(attr.price_change_percentage?.h1 ?? '0') || 0;
    const h6 = parseFloat(attr.price_change_percentage?.h6 ?? '0') || 0;
    const h24 = parseFloat(attr.price_change_percentage?.h24 ?? '0') || 0;
    const vol1h = parseFloat(attr.volume_usd?.h1 ?? '0') || 0;
    const vol24h = parseFloat(attr.volume_usd?.h24 ?? '0') || 0;
    const liquidity = parseFloat(attr.reserve_in_usd ?? '0') || 0;
    const priceUsd = parseFloat(attr.base_token_price_usd ?? '0') || 0;

    if (liquidity < MIN_LIQUIDITY_USD || vol24h < MIN_VOLUME_24H_USD) continue;

    out.push({ poolAddress, mintAddress, tokenName, tokenSymbol, priceUsd, h1, h6, h24, vol1h, vol24h, liquidity });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stage 2: classify regime from raw pool metrics
// ---------------------------------------------------------------------------

function classifyPoolRegime(pool: NormalizedPool): PoolRegime {
  const { h1, h6, h24, vol1h, vol24h, liquidity } = pool;
  const absH1 = Math.abs(h1);
  const absH24 = Math.abs(h24);
  const avgHourly = vol24h / 24;
  const volMom = avgHourly > 0 ? vol1h / avgHourly : 1;
  const allUp = h1 > 0 && h6 > 0 && h24 > 0;
  const allDown = h1 < 0 && h6 < 0 && h24 < 0;
  const volatilityRatio = absH24 > 0 ? absH1 / absH24 : 0;

  // Confidence in the classification — high when signals agree.
  let regime: MarketRegime;
  let confidence = 0.5;

  if (h24 < -8 && h1 > -1) {
    regime = 'OVERSOLD';
    confidence = 0.8;
  } else if (h1 > 4 && volMom > 1.5) {
    regime = 'VOLATILE';
    confidence = Math.min(0.9, 0.5 + volMom * 0.1);
  } else if (absH1 < 2 && absH24 < 6 && vol1h > 500) {
    regime = 'RANGING';
    confidence = liquidity > 20_000 ? 0.85 : 0.6;
  } else if (allUp && h24 > 4) {
    regime = 'TRENDING_UP';
    confidence = h24 > 10 ? 0.9 : 0.7;
  } else if (allDown && h24 < -4) {
    regime = 'TRENDING_DOWN';
    confidence = h24 < -10 ? 0.9 : 0.7;
  } else if (absH1 > 8) {
    regime = 'VOLATILE';
    confidence = 0.7;
  } else {
    regime = 'DEAD';
    confidence = Math.max(0.2, 1 - vol1h / 200);
  }

  return { regime, confidence, volatilityRatio };
}

// ---------------------------------------------------------------------------
// Stage 3: profile (pool, template) — base score + historical anchor
// ---------------------------------------------------------------------------

interface StrategyTemplate {
  id: string;
  name: string;
  type: string;
  matches: (pool: NormalizedPool, regime: PoolRegime) => { score: number; reasoning: string } | null;
}

function buildStrategyTemplates(): StrategyTemplate[] {
  const t = (
    id: string,
    name: string,
    type: string,
    matches: (pool: NormalizedPool, regime: PoolRegime) => { score: number; reasoning: string } | null,
  ): StrategyTemplate => ({ id, name, type, matches });

  return [
    t('scalping', 'Range Spike Scalper', 'scalping', (p, r) => {
      if (r.regime !== 'RANGING') return null;
      const absH1 = Math.abs(p.h1);
      const rangeScore = Math.max(0, 1 - absH1 / 3);
      const volFactor = clamp(Math.log10(p.vol1h + 1) / 4, 0, 1);
      const liqFactor = p.liquidity > 20_000 ? 1 : p.liquidity / 20_000;
      const score = rangeScore * 0.5 + volFactor * 0.3 + liqFactor * 0.2;
      return {
        score,
        reasoning: `Range-bound ±${absH1.toFixed(1)}%/h with $${Math.round(p.vol1h).toLocaleString()}/h volume — spike scalper fits.`,
      };
    }),

    t('solana_sniper', 'Solana Pulse Sniper', 'scalping', (p, r) => {
      if (!(p.h1 > 4 && r.regime === 'VOLATILE')) return null;
      const volMom = p.vol24h > 0 ? (p.vol1h / (p.vol24h / 24)) : 1;
      const pumpScore = clamp(p.h1 / 15, 0, 1);
      const volScore = clamp((volMom - 1.5) / 3.5, 0, 1);
      return {
        score: pumpScore * 0.6 + volScore * 0.4,
        reasoning: `+${p.h1.toFixed(1)}%/h vertical pump with ${volMom.toFixed(1)}x normal volume — sniper optimal.`,
      };
    }),

    t('momentum', 'MACD Momentum', 'momentum', (p, r) => {
      const allUp = p.h1 > 0 && p.h6 > 0 && p.h24 > 0;
      if (!(p.h1 > 1.5 && p.h24 > 4 && allUp && (r.regime === 'TRENDING_UP' || r.regime === 'VOLATILE'))) return null;
      const volMom = p.vol24h > 0 ? (p.vol1h / (p.vol24h / 24)) : 1;
      const trendScore = clamp((p.h1 / 8 + p.h24 / 25) / 2, 0, 1);
      const volBonus = clamp((volMom - 1) / 2, 0, 0.4);
      return {
        score: trendScore + volBonus,
        reasoning: `Consistent uptrend +${p.h1.toFixed(1)}%/h, +${p.h24.toFixed(1)}%/24h — MACD momentum alignment.`,
      };
    }),

    t('ema_trend', 'EMA Trend Strategy', 'trend', (p, r) => {
      const allUp = p.h1 > 0 && p.h6 > 0 && p.h24 > 0;
      if (!(allUp && p.h1 > 0.5 && p.h1 < 8 && p.h24 > 2 && r.regime === 'TRENDING_UP')) return null;
      const steadiness = Math.max(0, 1 - Math.abs(p.h1) / 8);
      const strength = clamp(p.h24 / 20, 0, 1);
      return {
        score: steadiness * 0.5 + strength * 0.5,
        reasoning: `All timeframes aligned (+${p.h1.toFixed(1)}% / +${p.h6.toFixed(1)}% / +${p.h24.toFixed(1)}%) — EMA crossover reliable.`,
      };
    }),

    t('breakout', 'Bollinger Breakout', 'breakout', (p, r) => {
      const volMom = p.vol24h > 0 ? (p.vol1h / (p.vol24h / 24)) : 1;
      if (!(Math.abs(p.h1) < 2.5 && p.h24 > 2 && volMom > 0.8)) return null;
      const consolidation = Math.max(0, 1 - Math.abs(p.h1) / 2.5);
      const trendBias = clamp(p.h24 / 15, 0, 1);
      const volBuild = clamp((volMom - 0.8) / 1.2, 0, 1);
      return {
        score: consolidation * 0.35 + trendBias * 0.35 + volBuild * 0.3,
        reasoning: `Tight ±${Math.abs(p.h1).toFixed(1)}%/h after +${p.h24.toFixed(1)}%/24h — Bollinger squeeze setup.`,
      };
    }),

    t('solana_runner', 'Asymmetric Breakout (Runner)', 'breakout', (p, r) => {
      if (!(p.h1 > 3 && p.h24 > 8 && r.regime === 'TRENDING_UP')) return null;
      const volMom = p.vol24h > 0 ? (p.vol1h / (p.vol24h / 24)) : 1;
      const strength = clamp((p.h1 / 10 + p.h24 / 30) / 2, 0, 1);
      const volFactor = clamp(volMom / 3, 0, 1);
      return {
        score: strength * 0.7 + volFactor * 0.3,
        reasoning: `Strong breakout +${p.h1.toFixed(1)}%/h, +${p.h24.toFixed(1)}%/24h — trailing stop maximises upside.`,
      };
    }),

    t('rsi_mean_reversion', 'RSI Mean Reversion', 'mean_reversion', (p, r) => {
      if (!(p.h24 < -6 && p.h1 > -1 && r.regime === 'OVERSOLD')) return null;
      const depth = clamp(Math.abs(p.h24) / 20, 0, 1);
      const stabilising = p.h1 >= 0 ? 0.25 : 0;
      const reasonSuffix = p.h1 >= 0 ? ` Hourly stabilising (+${p.h1.toFixed(1)}%).` : '';
      return {
        score: depth * 0.75 + stabilising,
        reasoning: `${p.h24.toFixed(1)}%/24h drop, RSI likely oversold.${reasonSuffix} Mean-reversion bounce expected.`,
      };
    }),

    t('solana_dip_buyer', 'Solana V-Shape Dip Buyer', 'mean_reversion', (p, r) => {
      if (!(p.h6 < -8 && p.h1 > 0 && r.regime === 'OVERSOLD')) return null;
      const depth = clamp(Math.abs(p.h6) / 20, 0, 1);
      const recovery = clamp(p.h1 / 5, 0, 0.3);
      return {
        score: depth * 0.8 + recovery,
        reasoning: `${p.h6.toFixed(1)}%/6h flash dump, now +${p.h1.toFixed(1)}%/h — V-shape recovery in progress.`,
      };
    }),

    t('dca', 'DCA Accumulator', 'dca', (p, r) => {
      if (!(Math.abs(p.h1) < 2 && p.h24 < 2 && p.liquidity > 20_000)) return null;
      const flatScore = Math.max(0, 1 - Math.abs(p.h1) / 2);
      const liqScore = clamp(Math.log10(p.liquidity) / 6, 0, 1);
      return {
        score: flatScore * 0.6 + liqScore * 0.4,
        reasoning: `Low-volatility (h24 ${p.h24.toFixed(1)}%) with $${(p.liquidity / 1000).toFixed(0)}k liquidity — DCA accumulation fits.`,
      };
    }),

    t('paet', 'PAET — Anomaly Trigger', 'paet', (p, r) => {
      // STL decomposition needs a meaningful price history — thin books produce
      // noisy residuals that cause false anomaly triggers.
      if (p.liquidity < 15_000) return null;
      // DEAD: velocity ≈ 0 → PNR never fires, bot idles indefinitely.
      // TRENDING_UP: auto-entry mode + rising prices cause immediate PNR false alarms.
      if (r.regime === 'DEAD' || r.regime === 'TRENDING_UP') return null;

      const liqFactor = clamp(Math.log10(p.liquidity / 10_000) / 2, 0, 1);
      const volFactor = clamp(Math.log10(p.vol1h + 1) / 4, 0, 1);

      if (r.regime === 'RANGING') {
        // Best fit: predictable cycles → STL separates T/S/I cleanly.
        // FFT detects the dominant period; Rules 1–3 auto-converge parameters.
        const absH1 = Math.abs(p.h1);
        const stabilityScore = Math.max(0, 1 - absH1 / 4);
        return {
          score: clamp(stabilityScore * 0.45 + liqFactor * 0.35 + volFactor * 0.20, 0, 1),
          reasoning: `PAET: Cyclical ranging ±${absH1.toFixed(1)}%/h — STL detects dominant cycle, self-calibrating PNR exits before collapse.`,
        };
      }
      if (r.regime === 'VOLATILE') {
        // Protective fit: residual anomaly detection catches sudden drops before
        // they accelerate past the collapse threshold.
        const pumpScore = clamp(p.h1 / 15, 0, 1);
        return {
          score: clamp((pumpScore * 0.35 + liqFactor * 0.40 + volFactor * 0.25) * 0.80, 0, 1),
          reasoning: `PAET: Volatile +${p.h1.toFixed(1)}%/h — residual anomaly detection guards against sudden reversal. PNR exits before collapse.`,
        };
      }
      if (r.regime === 'TRENDING_DOWN') {
        // Moderate fit: PNR catches early acceleration of a downtrend.
        const depth = clamp(Math.abs(p.h24) / 20, 0, 1);
        return {
          score: clamp((depth * 0.40 + liqFactor * 0.35 + volFactor * 0.25) * 0.65, 0, 1),
          reasoning: `PAET: Downtrend ${p.h24.toFixed(1)}%/24h — PNR exits early before decline accelerates beyond collapse threshold.`,
        };
      }
      // OVERSOLD — low confidence: auto-entry rides potential bounce, PNR exits if decline resumes
      const depth = clamp(Math.abs(p.h24) / 25, 0, 1);
      const recoveryBonus = p.h1 > 0 ? 0.10 : 0;
      return {
        score: clamp((depth * 0.35 + liqFactor * 0.35 + volFactor * 0.20 + recoveryBonus) * 0.55, 0, 1),
        reasoning: `PAET: Oversold ${p.h24.toFixed(1)}%/24h — auto-entry with anomaly protection. Exits immediately if decline resumes.`,
      };
    }),
  ];
}

// Per-strategyType historical aggregates are computed once per workflow run
// and looked up via a Map. This avoids the N×M correlated-subquery pattern
// that would otherwise blow up at ~4500 query iterations per cycle.
interface HistoricalAnchor {
  winRate: number | null;
  sampleSize: number;
  profitFactor: number | null;
  source: 'strategy_join' | 'legacy_inferred';
}

function loadHistoricalAnchorCache(): Map<string, HistoricalAnchor> {
  const cache = new Map<string, HistoricalAnchor>();

  // Source 1: bots with an explicit strategyId → use the JSON config's type.
  // (No filter that excludes legacy bots — see Source 2.)
  const joinedRows = db.prepare(`
    SELECT
      json_extract(s.config, '$.strategy_type') AS stype,
      t.pnlPercent AS pnlPercent
    FROM trades t
    JOIN bots b ON b.id = t.botId
    JOIN strategies s ON s.id = b.strategyId
    WHERE t.action = 'SELL'
      AND t.status = 'CONFIRMED'
      AND t.pnlPercent IS NOT NULL
      AND json_extract(s.config, '$.strategy_type') IS NOT NULL
    ORDER BY t.timestamp DESC
    LIMIT 2000
  `).all() as { stype: string; pnlPercent: number }[];

  // Source 2: legacy bots without a strategyId — best-effort infer via
  // recent agent_history. If a bot has applied AI advice that referenced a
  // strategyType (e.g. via strategySwitch), use that. Otherwise skip: we
  // refuse to invent a strategy type and risk biased evidence.
  const inferredRows = db.prepare(`
    SELECT ah.regime, t.pnlPercent AS pnlPercent
    FROM trades t
    JOIN bots b ON b.id = t.botId
    JOIN agent_history ah ON ah.botId = b.id
    WHERE t.action = 'SELL'
      AND t.status = 'CONFIRMED'
      AND t.pnlPercent IS NOT NULL
      AND b.strategyId IS NULL
      AND (b.customSystemPrompt IS NULL OR b.customSystemPrompt = '')
      AND t.timestamp >= ah.timestamp
    ORDER BY t.timestamp DESC
    LIMIT 2000
  `).all() as { regime: string; pnlPercent: number }[];

  const buckets = new Map<string, { pnls: number[]; source: HistoricalAnchor['source'] }>();

  for (const r of joinedRows) {
    const key = r.stype;
    const bucket = buckets.get(key) ?? { pnls: [], source: 'strategy_join' };
    bucket.pnls.push(r.pnlPercent);
    buckets.set(key, bucket);
  }

  for (const r of inferredRows) {
    const key = `legacy:${r.regime}`;
    const bucket = buckets.get(key) ?? { pnls: [], source: 'legacy_inferred' };
    bucket.pnls.push(r.pnlPercent);
    buckets.set(key, bucket);
  }

  for (const [key, { pnls, source }] of buckets.entries()) {
    if (pnls.length === 0) continue;
    const wins = pnls.filter(p => p > 0);
    const losses = pnls.filter(p => p < 0);
    const sumWin = wins.reduce((s, p) => s + p, 0);
    const sumLoss = Math.abs(losses.reduce((s, p) => s + p, 0));
    const winRate = pnls.length > 0 ? (wins.length / pnls.length) * 100 : null;
    const profitFactor = sumLoss > 0 ? sumWin / sumLoss : sumWin > 0 ? Infinity : null;
    cache.set(key, { winRate, sampleSize: pnls.length, profitFactor, source });
  }

  return cache;
}

function lookupHistoricalAnchor(
  cache: Map<string, HistoricalAnchor>,
  strategyType: string,
  regime: MarketRegime,
): HistoricalAnchor {
  // Prefer the strategy-join anchor; fall back to a legacy+regime key when
  // the bot has no explicit strategy link (covers Legacy-PatternDetector bots).
  const joined = cache.get(strategyType);
  if (joined && joined.sampleSize >= 5) return joined;

  const legacy = cache.get(`legacy:${regime}`);
  if (legacy && legacy.sampleSize >= 5) return legacy;

  // Aggregate both sources for a defensible fallback even at small n.
  const combined: HistoricalAnchor = {
    winRate: null,
    sampleSize: 0,
    profitFactor: null,
    source: 'legacy_inferred',
  };
  let wins = 0;
  let sumWin = 0;
  let sumLoss = 0;
  if (joined) {
    combined.sampleSize += joined.sampleSize;
    if (joined.winRate !== null) wins += (joined.winRate / 100) * joined.sampleSize;
    if (joined.profitFactor !== null && Number.isFinite(joined.profitFactor)) {
      // Reverse-engineer sumWin/sumLoss approximation from PF and sample
      // size — only safe for joined rows (n known).
      const sampleLoss = joined.sampleSize - Math.round((joined.winRate ?? 0) / 100 * joined.sampleSize);
      const denom = sampleLoss > 0 ? joined.profitFactor * (sampleLoss / 1) : 1;
      void denom;
    }
  }
  if (legacy) {
    combined.sampleSize += legacy.sampleSize;
    if (legacy.winRate !== null) wins += (legacy.winRate / 100) * legacy.sampleSize;
  }
  if (combined.sampleSize > 0) {
    combined.winRate = (wins / combined.sampleSize) * 100;
  }
  return combined;
}

function profileStrategyFit(
  pool: NormalizedPool,
  regime: PoolRegime,
  templates: StrategyTemplate[],
  histCache: Map<string, HistoricalAnchor>,
): StrategyMatch[] {
  const matches: StrategyMatch[] = [];
  for (const tpl of templates) {
    const fit = tpl.matches(pool, regime);
    if (!fit) continue;
    const hist = lookupHistoricalAnchor(histCache, tpl.type, regime.regime);

    const warnings: string[] = [];
    if (hist.winRate !== null && hist.winRate < 40 && hist.sampleSize >= 10) {
      warnings.push(`Historical WR for ${tpl.type} is only ${Math.round(hist.winRate)}% over ${hist.sampleSize} trades`);
    }
    if (hist.profitFactor !== null && hist.profitFactor < 1 && hist.sampleSize >= 10) {
      warnings.push(`Historical profit factor ${hist.profitFactor.toFixed(2)} < 1.0`);
    }
    if (pool.liquidity < 10_000) {
      warnings.push('Very low liquidity (<$10k) — slippage risk');
    }

    matches.push({
      templateId: tpl.id,
      strategyName: tpl.name,
      strategyType: tpl.type,
      baseScore: fit.score,
      historicalWinRate: hist.winRate,
      historicalSampleSize: hist.sampleSize,
      profitFactor: hist.profitFactor,
      reasoning: fit.reasoning,
      regime: regime.regime,
      warnings,
    });
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Stage 4: compose concrete bot configuration from a strategy match
// ---------------------------------------------------------------------------

function composeBotConfig(match: StrategyMatch, pool: NormalizedPool): SuggestedBotConfig {
  // Minimum TP must exceed roundtrip fee (2%) × safety factor so E[PnL] > 0 at ~50% WR.
  // Formula: TP > SL + 2 × fee. With SL=3%, fee=2%: TP must be > 7% → use 8%+ minimum.
  const baseByType: Record<string, Omit<SuggestedBotConfig, 'advisoryOnly'>> = {
    scalping:       { positionSizePct: 8,  aggressivenessPct: 10, slippageTolerancePct: 2.0, maxPositions: 1, stopLossPct: 3, scalpingSettings: { cooldownTicks: 5, spikeThreshold: 3.0, sellDropThreshold: 5.0, floorWindow: 20 } },
    trend:          { positionSizePct: 12, aggressivenessPct: 15, slippageTolerancePct: 0.5, maxPositions: 1, stopLossPct: 3, takeProfitPct: 8 },
    momentum:       { positionSizePct: 10, aggressivenessPct: 12, slippageTolerancePct: 0.5, maxPositions: 1, stopLossPct: 3, takeProfitPct: 8 },
    breakout:       { positionSizePct: 7,  aggressivenessPct: 10, slippageTolerancePct: 0.8, maxPositions: 1, stopLossPct: 3, takeProfitPct: 9 },
    mean_reversion: { positionSizePct: 6,  aggressivenessPct: 8,  slippageTolerancePct: 1.0, maxPositions: 1, stopLossPct: 3, takeProfitPct: 7 },
    dca:            { positionSizePct: 5,  aggressivenessPct: 5,  slippageTolerancePct: 1.0, maxPositions: 4, stopLossPct: 8 },
    grid:           { positionSizePct: 8,  aggressivenessPct: 10, slippageTolerancePct: 0.5, maxPositions: 3, stopLossPct: 5 },
    // PAET has its own internal exit logic (PNR + anomaly); no TP needed.
    // stopLossPct=6 acts as an external safety net — PAET normally exits well before 6%.
    paet:           { positionSizePct: 10, aggressivenessPct: 12, slippageTolerancePct: 0.5, maxPositions: 1, stopLossPct: 6 },
  };

  const cfg: SuggestedBotConfig = { ...(baseByType[match.strategyType] ?? baseByType.scalping), advisoryOnly: true };

  // Liquidity-aware slippage: low-liquidity pools need more tolerance or they
  // never fill. High liquidity can be tighter.
  if (pool.liquidity < 10_000) cfg.slippageTolerancePct = Math.max(cfg.slippageTolerancePct, 2.5);
  else if (pool.liquidity > 100_000) cfg.slippageTolerancePct = Math.min(cfg.slippageTolerancePct, 0.3);

  // Historical-edge aware sizing: if we have solid evidence the strategy works
  // (WR ≥ 60%, n ≥ 20, profit factor ≥ 1.5) we can size up modestly.
  const strongEvidence =
    match.historicalWinRate !== null &&
    match.historicalSampleSize >= 20 &&
    match.historicalWinRate >= 60 &&
    (match.profitFactor ?? 0) >= 1.5;

  if (strongEvidence) {
    cfg.positionSizePct = Math.min(cfg.positionSizePct * 1.5, 25);
    cfg.aggressivenessPct = Math.min(cfg.aggressivenessPct * 1.4, 40);
  }

  // Negative evidence: WR < 40% with n ≥ 15 → aggressively cut size and
  // aggressiveness, even if baseScore was high.
  const weakEvidence =
    match.historicalWinRate !== null &&
    match.historicalSampleSize >= 15 &&
    match.historicalWinRate < 40;

  if (weakEvidence) {
    cfg.positionSizePct = Math.max(cfg.positionSizePct * 0.4, 3);
    cfg.aggressivenessPct = Math.max(cfg.aggressivenessPct * 0.5, 5);
  }

  // Regime overrides — explicit safety floors.
  if (match.regime === 'VOLATILE') {
    cfg.positionSizePct = Math.min(cfg.positionSizePct, 10);
    cfg.aggressivenessPct = Math.min(cfg.aggressivenessPct, 15);
  }
  if (match.regime === 'DEAD') {
    cfg.positionSizePct = Math.min(cfg.positionSizePct, 5);
    cfg.aggressivenessPct = Math.min(cfg.aggressivenessPct, 8);
  }

  // Final safety bounds — hard caps shared across all strategies.
  applyFinalSafetyBounds(cfg);

  return cfg;
}

function applyFinalSafetyBounds(cfg: SuggestedBotConfig): void {
  cfg.positionSizePct = clamp(cfg.positionSizePct, 3, 25);
  cfg.aggressivenessPct = clamp(cfg.aggressivenessPct, 5, 40);
  cfg.slippageTolerancePct = clamp(cfg.slippageTolerancePct, 0.1, 5);
  cfg.maxPositions = clamp(Math.round(cfg.maxPositions), 1, 5);
  cfg.stopLossPct = clamp(cfg.stopLossPct, 1, 15);

  // TP must beat roundtrip fee + SL to have positive expectation at 50% WR.
  // Required: TP > SL + 2 × ROUNDTRIP_FEE (2%). Floor at max(7%, SL + 4%).
  const ROUNDTRIP_FEE_PCT = 2;
  const minTP = Math.max(7, cfg.stopLossPct + ROUNDTRIP_FEE_PCT * 2);
  if (cfg.takeProfitPct !== undefined) {
    cfg.takeProfitPct = Math.max(cfg.takeProfitPct, minTP);
  }

  // Scalping: trailing stop must be wide enough that a real move can develop.
  if (cfg.scalpingSettings) {
    cfg.scalpingSettings.spikeThreshold = Math.max(cfg.scalpingSettings.spikeThreshold ?? 3.0, 2.0);
    cfg.scalpingSettings.sellDropThreshold = Math.max(cfg.scalpingSettings.sellDropThreshold ?? 5.0, 3.0);
  }
}

// ---------------------------------------------------------------------------
// Stage 5: calibrate confidence
// ---------------------------------------------------------------------------

function calibrateConfidence(match: StrategyMatch, regime: PoolRegime): number {
  // Three multiplicative factors in [0..1]:
  //   - marketFit: how well the pool profile matches the strategy (baseScore)
  //   - evidence: how strong the historical anchor is
  //   - regime:   how confident we are in the regime classification
  const marketFit = clamp(match.baseScore, 0, 1);

  const wr = match.historicalWinRate;
  const n = match.historicalSampleSize;
  let evidence: number;
  if (wr === null || n < 5) {
    evidence = 0.45;            // unproven → middle ground, no penalty
  } else if (wr >= 60 && n >= 20) {
    evidence = clamp(0.6 + (wr - 60) / 100, 0.6, 0.95);
  } else if (wr >= 50) {
    evidence = 0.55;
  } else if (wr >= 40) {
    evidence = 0.4;
  } else {
    evidence = 0.2;             // strong evidence the strategy is losing here
  }

  const regimeFactor = clamp(regime.confidence, 0.2, 1);

  // Profit factor modifier: if we know the historical PF, nudge confidence.
  let pfMod = 0;
  if (match.profitFactor !== null && Number.isFinite(match.profitFactor) && n >= 10) {
    if (match.profitFactor >= 2) pfMod = 0.05;
    else if (match.profitFactor >= 1.3) pfMod = 0.02;
    else if (match.profitFactor < 0.8) pfMod = -0.1;
  }

  const raw = marketFit * 0.5 + evidence * 0.35 + regimeFactor * 0.15 + pfMod;
  return clamp(raw, 0.15, 0.92);
}

// ---------------------------------------------------------------------------
// Stage 6: rank and diversify
// ---------------------------------------------------------------------------

function rankAndDiversify(
  scored: Array<{ pool: NormalizedPool; match: StrategyMatch; confidence: number; cfg: SuggestedBotConfig; diagnostics: SuggestionDiagnostics }>,
): Array<{ pool: NormalizedPool; match: StrategyMatch; confidence: number; cfg: SuggestedBotConfig; diagnostics: SuggestionDiagnostics }> {
  scored.sort((a, b) => b.confidence - a.confidence);

  // First pass: best match per templateId (ensures template diversity).
  const picked: typeof scored = [];
  const usedTemplates = new Set<string>();
  const usedMints = new Set<string>();
  for (const entry of scored) {
    if (picked.length >= MAX_SUGGESTIONS) break;
    if (!usedTemplates.has(entry.match.templateId) && !usedMints.has(entry.pool.mintAddress)) {
      usedTemplates.add(entry.match.templateId);
      usedMints.add(entry.pool.mintAddress);
      picked.push(entry);
    }
  }

  // Second pass: fill the remaining slots with the next-best pool entries
  // even if a template is reused — diversity helps but coverage matters more.
  for (const entry of scored) {
    if (picked.length >= MAX_SUGGESTIONS) break;
    if (!picked.some(p => p.pool.mintAddress === entry.pool.mintAddress)) {
      picked.push(entry);
    }
  }

  return picked;
}

// ---------------------------------------------------------------------------
// Workflow orchestration
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export async function runAdvisorWorkflow(): Promise<{
  suggestions: AdvisorSuggestion[];
  history: AdvisorSuggestion[];
  fetchedAt: number;
}> {
  const pools = await fetchCandidatePools();
  logger.info('system', 'Advisor', `Stage 1 — fetched ${pools.length} candidate pools`);

  const templates = buildStrategyTemplates();
  const histCache = loadHistoricalAnchorCache();

  const scored: Array<{
    pool: NormalizedPool;
    match: StrategyMatch;
    confidence: number;
    cfg: SuggestedBotConfig;
    diagnostics: SuggestionDiagnostics;
  }> = [];

  for (const pool of pools) {
    const regime = classifyPoolRegime(pool);
    const matches = profileStrategyFit(pool, regime, templates, histCache);
    for (const match of matches) {
      const cfg = composeBotConfig(match, pool);
      const confidence = calibrateConfidence(match, regime);
      const diagnostics: SuggestionDiagnostics = {
        baseScore: match.baseScore,
        historicalWinRate: match.historicalWinRate,
        historicalSampleSize: match.historicalSampleSize,
        profitFactor: match.profitFactor,
        regimeConfidence: regime.confidence,
        warnings: match.warnings,
      };
      scored.push({ pool, match, confidence, cfg, diagnostics });
    }
  }

  logger.info('system', 'Advisor', `Stage 2–5 — produced ${scored.length} (pool × strategy) candidates`);

  const picked = rankAndDiversify(scored);
  const now = Date.now();

  const suggestions: AdvisorSuggestion[] = picked.map((entry, idx) => ({
    rank: idx + 1,
    tokenName: entry.pool.tokenName,
    tokenSymbol: entry.pool.tokenSymbol,
    mintAddress: entry.pool.mintAddress,
    poolAddress: entry.pool.poolAddress,
    priceUsd: entry.pool.priceUsd,
    priceChange1h: entry.pool.h1,
    priceChange24h: entry.pool.h24,
    volume1h: entry.pool.vol1h,
    volume24h: entry.pool.vol24h,
    liquidity: entry.pool.liquidity,
    templateId: entry.match.templateId,
    strategyName: entry.match.strategyName,
    strategyType: entry.match.strategyType,
    reasoning: entry.match.reasoning,
    confidence: entry.confidence,
    regime: entry.match.regime,
    generatedAt: now,
    suggestedConfig: entry.cfg,
    diagnostics: entry.diagnostics,
  }));

  // Fallback when no matches were found at all.
  if (suggestions.length === 0 && pools.length > 0) {
    const top = pools[0];
    const fallbackRegime = classifyPoolRegime(top);
    const fallbackMatch: StrategyMatch = {
      templateId: 'scalping',
      strategyName: 'Range Spike Scalper',
      strategyType: 'scalping',
      baseScore: 0.05,
      historicalWinRate: null,
      historicalSampleSize: 0,
      profitFactor: null,
      reasoning: 'No clear market pattern matched any template. Scalping used as conservative fallback.',
      regime: fallbackRegime.regime === 'DEAD' ? 'DEAD' : fallbackRegime.regime,
      warnings: ['Fallback used — no strong template match'],
    };
    const cfg = composeBotConfig(fallbackMatch, top);
    suggestions.push({
      rank: 1,
      tokenName: top.tokenName,
      tokenSymbol: top.tokenSymbol,
      mintAddress: top.mintAddress,
      poolAddress: top.poolAddress,
      priceUsd: top.priceUsd,
      priceChange1h: top.h1,
      priceChange24h: top.h24,
      volume1h: top.vol1h,
      volume24h: top.vol24h,
      liquidity: top.liquidity,
      templateId: fallbackMatch.templateId,
      strategyName: fallbackMatch.strategyName,
      strategyType: fallbackMatch.strategyType,
      reasoning: fallbackMatch.reasoning,
      confidence: 0.2,
      regime: fallbackRegime.regime,
      generatedAt: now,
      suggestedConfig: cfg,
      diagnostics: {
        baseScore: fallbackMatch.baseScore,
        historicalWinRate: null,
        historicalSampleSize: 0,
        profitFactor: null,
        regimeConfidence: fallbackRegime.confidence,
        warnings: fallbackMatch.warnings,
      },
    });
  }

  return { suggestions, history: [], fetchedAt: now };
}

// ---------------------------------------------------------------------------
// Cache + history (kept as a thin wrapper around the workflow)
// ---------------------------------------------------------------------------

function loadHistory(): AdvisorSuggestion[] {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = fs.readFileSync(HISTORY_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as AdvisorSuggestion[];
    }
  } catch { /* ignore corrupt file */ }
  return [];
}

function saveHistory(history: AdvisorSuggestion[]): void {
  try {
    // Atomic write: temp file + rename so a crash mid-write cannot corrupt
    // the live history file.
    const tmp = `${HISTORY_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(history), 'utf-8');
    fs.renameSync(tmp, HISTORY_FILE);
  } catch { /* ignore write errors */ }
}

export async function getAdvisorSuggestions(forceRefresh = false): Promise<AdvisorResult> {
  if (!forceRefresh && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.result;
  }

  const { suggestions, fetchedAt } = await runAdvisorWorkflow();

  // Merge previous suggestions into the rolling history.
  const prevSuggestions = cache?.result.suggestions ?? [];
  const existingHistory = cache?.result.history ?? loadHistory();
  const newMints = new Set(suggestions.map(s => s.mintAddress));
  const merged = [
    ...prevSuggestions.filter(s => !newMints.has(s.mintAddress)),
    ...existingHistory.filter(s => !newMints.has(s.mintAddress)),
  ];
  const seen = new Set<string>();
  const history: AdvisorSuggestion[] = [];
  for (const s of merged) {
    if (!seen.has(s.mintAddress)) {
      seen.add(s.mintAddress);
      history.push(s);
    }
    if (history.length >= MAX_HISTORY) break;
  }
  saveHistory(history);

  const result: AdvisorResult = { suggestions, history, fetchedAt };
  cache = { result, fetchedAt };
  return result;
}
