import { db } from './db.js';
import {
  getTimeWindowPerformance,
  getRecentAdvicesWithOutcomes,
  insertLesson,
  countLessonsForBot,
  getLessonsForBot,
  type LessonEntry,
} from './db.js';
import { isNearDuplicate } from './utils/textUtils.js';

/**
 * ADR-011 Phase D: Lessons-Learned auto-generator.
 *
 * Runs before each agent cycle to surface recurring failure patterns.
 * Heuristics implemented:
 *  - time_window: WR < 40% with n ≥ 10 in a specific hour/weekday bucket.
 *  - streak:       3+ consecutive losing settings-changes in agent_history.
 *  - param_drift:  |aggressiveness delta| > 50% without WR improvement.
 *  - strategy:     last 5 cycles in same regime all under 35% WR.
 *
 * Cold-Start-Guard: skips entirely when trade count < minSampleSize.
 * Dedup: new lessons are compared to last `lookbackDays` lessons and skipped
 *        when near-duplicate (Levenshtein ≥ 0.85 similarity).
 * Cap:    at most `maxPerBot` lessons per lookback window.
 */

export interface GenerateLessonsOptions {
  minSampleSize?: number;       // default: from .env AI_TIMEWINDOW_MIN_SAMPLES (5)
  maxPerBot?: number;           // default: 5
  lookbackDays?: number;        // default: 7
  windowMinN?: number;          // bucket sample-size minimum (default: 10)
  badWindowWR?: number;         // default: 40
  badRegimeWR?: number;         // default: 35
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const v = parseFloat(raw);
  return Number.isFinite(v) ? v : fallback;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const v = parseInt(raw, 10);
  return Number.isFinite(v) ? v : fallback;
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function isDuplicateOf(lesson: string, recent: LessonEntry[], threshold = 0.85): boolean {
  for (const r of recent) {
    if (isNearDuplicate(lesson.toLowerCase(), r.lesson.toLowerCase(), threshold)) {
      return true;
    }
  }
  return false;
}

export function generateLessons(botId: string, opts: GenerateLessonsOptions = {}): LessonEntry[] {
  const minSampleSize = opts.minSampleSize ?? envInt('AI_TIMEWINDOW_MIN_SAMPLES', 5);
  const maxPerBot = opts.maxPerBot ?? envInt('AI_LESSONS_MAX_PER_BOT', 5);
  const lookbackDays = opts.lookbackDays ?? envInt('AI_LESSONS_LOOKBACK_DAYS', 7);
  const windowMinN = opts.windowMinN ?? 10;
  const badWindowWR = opts.badWindowWR ?? 40;
  const badRegimeWR = opts.badRegimeWR ?? 35;

  // --- Cold-Start-Guard ---
  const tradeCount = (db.prepare(
    `SELECT COUNT(*) as c FROM trades WHERE botId = ? AND status = 'CONFIRMED' AND action = 'SELL'`
  ).get(botId) as { c: number }).c;

  if (tradeCount < minSampleSize) {
    return [];
  }

  // Existing lessons for dedup + cap
  const existing = getLessonsForBot(botId, maxPerBot * 2, lookbackDays);
  if (existing.length >= maxPerBot) {
    return existing.slice(0, maxPerBot);
  }

  const created: LessonEntry[] = [];

  // --- Heuristic 1: time_window buckets with WR < badWindowWR at n ≥ windowMinN ---
  const hourPerf = getTimeWindowPerformance(botId, 'hour_of_day', windowMinN);
  const dayPerf = getTimeWindowPerformance(botId, 'weekday', windowMinN);

  for (const bucket of hourPerf) {
    if (bucket.winRate < badWindowWR) {
      const text = `Hour ${String(bucket.bucket).padStart(2, '0')}:00–${String(bucket.bucket).padStart(2, '0')}:59 UTC — WR ${bucket.winRate}% at n=${bucket.tradeCount} (avg PnL ${bucket.avgPnl.toFixed(2)}%). Avoid entries in this window.`;
      if (!isDuplicateOf(text, existing) && !isDuplicateOf(text, created)) {
        const evidence = { windowType: 'hour_of_day', tradeCount: bucket.tradeCount, wins: bucket.wins, winRate: bucket.winRate, avgPnl: bucket.avgPnl, totalPnl: bucket.totalPnl, bucket: bucket.bucket };
        const id = insertLesson(
          botId,
          'time_window',
          text,
          evidence,
          0.7,
        );
        created.push({
          id, botId, createdAt: Date.now(),
          category: 'time_window', lesson: text,
          evidence: JSON.stringify(evidence),
          severity: 0.7,
        });
        if (created.length + existing.length >= maxPerBot) break;
      }
    }
  }

  for (const bucket of dayPerf) {
    if (bucket.winRate < badWindowWR) {
      const dayName = WEEKDAY_NAMES[bucket.bucket] ?? `d${bucket.bucket}`;
      const text = `${dayName} (UTC): WR ${bucket.winRate}% at n=${bucket.tradeCount} (avg PnL ${bucket.avgPnl.toFixed(2)}%). Consider pausing or tightening parameters on this weekday.`;
      if (!isDuplicateOf(text, existing) && !isDuplicateOf(text, created)) {
        const evidence = { windowType: 'weekday', tradeCount: bucket.tradeCount, wins: bucket.wins, winRate: bucket.winRate, avgPnl: bucket.avgPnl, totalPnl: bucket.totalPnl, bucket: bucket.bucket };
        const id = insertLesson(
          botId,
          'time_window',
          text,
          evidence,
          0.6,
        );
        created.push({
          id, botId, createdAt: Date.now(),
          category: 'time_window', lesson: text,
          evidence: JSON.stringify(evidence),
          severity: 0.6,
        });
        if (created.length + existing.length >= maxPerBot) break;
      }
    }
  }

  // --- Heuristic 2: 3+ consecutive losing settings-changes (streak) ---
  const advices = getRecentAdvicesWithOutcomes(botId, 5);
  let streak = 0;
  let lastStreakEnd: { regime: string; confidence: number; totalPnl: number; trades: number } | null = null;
  for (const a of advices) {
    const trades = a.outcomeTradeCount ?? 0;
    if (trades === 0) break;
    if ((a.outcomeTotalPnl ?? 0) < 0) {
      streak += 1;
      lastStreakEnd = {
        regime: a.regime,
        confidence: a.confidence,
        totalPnl: a.outcomeTotalPnl ?? 0,
        trades,
      };
    } else {
      break;
    }
  }
  if (streak >= 3 && lastStreakEnd) {
    const text = `Streak of ${streak} consecutive losing agent settings-changes (last: ${lastStreakEnd.regime}, total PnL ${lastStreakEnd.totalPnl.toFixed(2)}% over ${lastStreakEnd.trades} trades). Consider increasing minConfidence or pausing auto-apply.`;
    if (!isDuplicateOf(text, existing) && !isDuplicateOf(text, created)) {
      const id = insertLesson(botId, 'streak', text, { streak, ...lastStreakEnd }, 0.8);
      created.push({
        id, botId, createdAt: Date.now(),
        category: 'streak', lesson: text,
        evidence: JSON.stringify({ streak, ...lastStreakEnd }),
        severity: 0.8,
      });
    }
  }

  // --- Heuristic 3: param_drift — aggressiveness change > 50% without WR improvement ---
  if (advices.length >= 2) {
    const newest = advices[0];
    const prev = advices[1];
    const newAgg = newest.aggressivenessAdvice ?? null;
    const prevAgg = prev.aggressivenessAdvice ?? null;
    if (newAgg !== null && prevAgg !== null && prevAgg > 0) {
      const deltaPct = Math.abs(((newAgg - prevAgg) / prevAgg) * 100);
      if (deltaPct > 50) {
        const newWR = (newest.outcomeTradeCount ?? 0) > 0
          ? ((newest.outcomeWins ?? 0) / (newest.outcomeTradeCount ?? 1)) * 100
          : null;
        const prevWR = (prev.outcomeTradeCount ?? 0) > 0
          ? ((prev.outcomeWins ?? 0) / (prev.outcomeTradeCount ?? 1)) * 100
          : null;
        const wrImproved = newWR !== null && prevWR !== null && newWR > prevWR;
        if (!wrImproved) {
          const text = `Aggressiveness moved ${prevAgg}% → ${newAgg}% (Δ ${deltaPct.toFixed(0)}%) without measurable WR improvement. Revert or halve the step size.`;
          if (!isDuplicateOf(text, existing) && !isDuplicateOf(text, created)) {
            const id = insertLesson(botId, 'param_drift', text, { prevAgg, newAgg, deltaPct, prevWR, newWR }, 0.6);
            created.push({
              id, botId, createdAt: Date.now(),
              category: 'param_drift', lesson: text,
              evidence: JSON.stringify({ prevAgg, newAgg, deltaPct, prevWR, newWR }),
              severity: 0.6,
            });
          }
        }
      }
    }
  }

  // --- Heuristic 4: regime-strategy mismatch ---
  const regimeBuckets = new Map<string, { wins: number; total: number; totalPnl: number }>();
  for (const a of advices) {
    if ((a.outcomeTradeCount ?? 0) === 0) continue;
    const cur = regimeBuckets.get(a.regime) ?? { wins: 0, total: 0, totalPnl: 0 };
    cur.wins += a.outcomeWins ?? 0;
    cur.total += a.outcomeTradeCount ?? 0;
    cur.totalPnl += a.outcomeTotalPnl ?? 0;
    regimeBuckets.set(a.regime, cur);
  }
  for (const [regime, agg] of regimeBuckets.entries()) {
    if (agg.total < 5) continue;
    const wr = (agg.wins / agg.total) * 100;
    if (wr < badRegimeWR) {
      const text = `Current strategy underperforms in ${regime} regime: WR ${wr.toFixed(0)}% over ${agg.total} trades (avg PnL ${(agg.totalPnl / agg.total).toFixed(2)}%). Consider switching strategy type for this regime.`;
      if (!isDuplicateOf(text, existing) && !isDuplicateOf(text, created)) {
        const id = insertLesson(botId, 'strategy', text, { regime, wr, total: agg.total, avgPnl: agg.totalPnl / agg.total }, 0.75);
        created.push({
          id, botId, createdAt: Date.now(),
          category: 'strategy', lesson: text,
          evidence: JSON.stringify({ regime, wr, total: agg.total }),
          severity: 0.75,
        });
      }
    }
  }

  // Use stored count to enforce the cap (in case dedup let extras slip through)
  const totalNow = countLessonsForBot(botId, lookbackDays);
  if (totalNow > maxPerBot) {
    // Remove oldest/lowest-severity lessons beyond cap
    const overflow = db.prepare(`
      SELECT id FROM lessons_learned
      WHERE botId = ?
      ORDER BY severity ASC, createdAt ASC
      LIMIT ?
    `).all(botId, totalNow - maxPerBot) as { id: number }[];
    for (const o of overflow) {
      db.prepare('DELETE FROM lessons_learned WHERE id = ?').run(o.id);
    }
  }

  // Return the lessons this run created, capped to maxPerBot
  return created.slice(0, maxPerBot);
}
