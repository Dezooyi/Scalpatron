import type { TimesFmForecast } from '../timesFmForecast.js';
import {
  forecastToEvidence,
  isUsableForecastEvidence,
  enrichNovaPulseSnapshot,
  paetForecastCollapseBias,
} from '../strategy/selfOptSnapshots.js';

let failures = 0;

function check(name: string, condition: boolean): void {
  console.log(`[SelfOptSnapshots Test] ${name}: ${condition ? 'PASS' : 'FAIL'}`);
  if (!condition) failures++;
}

function makeForecast(): TimesFmForecast {
  return {
    expectedReturnPct: 0.8,
    netExpectedReturnPct: -1.2,
    signalVector: {
      directionScore: -0.6,
      slopeConsistency: 0.8,
      forecastVolatilityPct: 4.0,
      dataQualityScore: 0.8,
    },
    forecastPrices: [1.0, 0.99, 0.98],
    contextLength: 128,
    horizon: 12,
    medianIntervalMs: 2000,
    maxGapMs: 2100,
  };
}

function evidence(partial: Partial<ReturnType<typeof forecastToEvidence>> = {}) {
  return { ...forecastToEvidence(makeForecast(), 1000), ...partial };
}

// ── forecastToEvidence ───────────────────────────────────────────────────────
const ev = forecastToEvidence(makeForecast(), 5000);
check('maps net return', ev.netReturnPct === -1.2);
check('maps direction score', ev.directionScore === -0.6);
check('maps consistency', ev.slopeConsistency === 0.8);
check('maps volatility', ev.volatilityPct === 4.0);
check('maps data quality', ev.dataQuality === 0.8);
check('maps age', ev.ageMs === 5000);

// ── isUsableForecastEvidence ─────────────────────────────────────────────────
check('null evidence unusable', !isUsableForecastEvidence(null));
check('fresh high-quality usable', isUsableForecastEvidence(ev));
check('stale evidence unusable', !isUsableForecastEvidence(evidence({ ageMs: 300_000 })));
check('low quality unusable', !isUsableForecastEvidence(evidence({ dataQuality: 0.4 })));

// ── enrichNovaPulseSnapshot ──────────────────────────────────────────────────
const enriched = enrichNovaPulseSnapshot({ volatility: 2.0, avgRange: 1.5 }, ev);
const expVol = 2.0 * (1 - 0.4) + 4.0 * 0.4;   // volWeight = 0.5*0.8
const expRange = 1.5 * 0.5 + 4.0 * 0.5;
check('volatility blended toward forecast', Math.abs(enriched.volatility - expVol) < 1e-9);
check('avgRange blended toward forecast', Math.abs(enriched.avgRange - expRange) < 1e-9);
check('forecast quality exposed', enriched.forecastQuality === 0.8);

const noFc = enrichNovaPulseSnapshot({ volatility: 2.0, avgRange: 1.5 }, null);
check('no forecast → unchanged snapshot', noFc.volatility === 2.0 && noFc.avgRange === 1.5 && noFc.forecastQuality === undefined);

// ── paetForecastCollapseBias ─────────────────────────────────────────────────
const severe = evidence({ directionScore: -0.6, netReturnPct: -1.5, slopeConsistency: 0.8, dataQuality: 0.9 });
const bias = paetForecastCollapseBias(severe);
check('severe negative forecast lowers collapse threshold', bias < 1);
check('bias bounded', bias >= 0.8 && bias < 1);

const bullish = evidence({ directionScore: 0.6, netReturnPct: 1.0 });
check('bullish forecast keeps collapse threshold', paetForecastCollapseBias(bullish) === 1);
check('no forecast keeps collapse threshold', paetForecastCollapseBias(null) === 1);

process.exit(failures === 0 ? 0 : 1);
