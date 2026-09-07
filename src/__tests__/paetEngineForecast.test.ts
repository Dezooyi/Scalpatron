import { PAETEngine, paetEffectiveOmega, isPaetForecastAdverse } from '../paetEngine.js';
import type { PricePoint } from '../priceFeed.js';
import type { MarketForecastEvidence } from '../strategyTypes.js';

let failures = 0;

function check(name: string, condition: boolean): void {
  console.log(`[PaetEngineForecast Test] ${name}: ${condition ? 'PASS' : 'FAIL'}`);
  if (!condition) failures++;
}

function makeSeries(length: number, step = 0.0001, base = 100): PricePoint[] {
  return Array.from({ length }, (_, i) => ({
    timestamp: Date.now() + i * 2000,
    price: base + i * step,
  }));
}

function engine(): PAETEngine {
  return new PAETEngine({
    min_history_candles: 10,
    stl_trend_window: 10,
    entry_mode: 'once',
    entry_cooldown_ticks: 5,
    evacuation_ticks: 3,
    safety_coefficient_k: 2,
    false_alarm_penalty_omega: 1.5,
  });
}

function adverseForecast(): MarketForecastEvidence {
  return {
    netReturnPct: -1.2,
    directionScore: -0.6,
    slopeConsistency: 0.8,
    volatilityPct: 2.0,
    dataQuality: 0.9,
    ageMs: 1000,
    horizon: 12,
  };
}

function neutralForecast(): MarketForecastEvidence {
  return {
    netReturnPct: 0.4,
    directionScore: 0.3,
    slopeConsistency: 0.8,
    volatilityPct: 1.0,
    dataQuality: 0.9,
    ageMs: 1000,
    horizon: 12,
  };
}

// ── 1. Engine-level Entry-Gate (ADR-027 E3) ─────────────────────────────────
const ticks = makeSeries(40);
const engBuy = engine();
const withoutFc = engBuy.analyze(ticks, 0);
check('once-entry BUY without forecast', withoutFc.signal === 'BUY');

const engBlocked = engine();
const blocked = engBlocked.analyze(ticks, 0, adverseForecast());
check('adverse forecast blocks once-entry', blocked.signal !== 'BUY');

const engBull = engine();
const bullish = engBull.analyze(ticks, 0, neutralForecast());
check('neutral/bullish forecast keeps entry', bullish.signal === 'BUY');

// ── 2. Exit-Sync: kein Sofort-Re-Entry (ADR-027 E1) ──────────────────────────
const engExit = engine();
const first = engExit.analyze(ticks, 0);
check('precondition: engine wants to buy', first.signal === 'BUY');
const lastPrice = ticks[ticks.length - 1].price;
engExit.onExternalExit(ticks.length, lastPrice);
const afterExit = engExit.analyze(ticks, 0);
check('no immediate re-entry after external exit', afterExit.signal !== 'BUY');

// ── 3. paetEffectiveOmega (ADR-027 E4) ───────────────────────────────────────
check('omega unchanged without forecast', paetEffectiveOmega(2.0, null) === 2.0);
check('omega unchanged for bullish forecast', paetEffectiveOmega(2.0, neutralForecast()) === 2.0);
const reduced = paetEffectiveOmega(2.0, adverseForecast());
check('omega reduced for adverse forecast', reduced < 2.0 && reduced >= 0.5);
const low = paetEffectiveOmega(0.6, adverseForecast());
check('omega clamped at 0.5 floor', low === 0.5);
check('omega clamp range respected', paetEffectiveOmega(5.0, adverseForecast()) <= 5.0);

// ── 4. isPaetForecastAdverse ─────────────────────────────────────────────────
check('no forecast → not adverse', !isPaetForecastAdverse(null));
check('bullish forecast → not adverse', !isPaetForecastAdverse(neutralForecast()));
check('adverse forecast → adverse', isPaetForecastAdverse(adverseForecast()));
check(
  'low consistency → not adverse',
  !isPaetForecastAdverse({ ...adverseForecast(), slopeConsistency: 0.3 }),
);
check(
  'low data quality → not adverse',
  !isPaetForecastAdverse({ ...adverseForecast(), dataQuality: 0.4 }),
);

process.exit(failures === 0 ? 0 : 1);
