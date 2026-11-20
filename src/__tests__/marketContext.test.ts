/**
 * Tests für Quantisierungs-Censoring in buildMarketContext.
 *
 * Hintergrund: Feeds wie DexScreener runden Preise (z. B. 4 Dezimalstellen).
 * Eine komplett flache Serie ist dann nicht „toter Markt", sondern
 * „Bewegung unterhalb der Feed-Auflösung" — die Forks sollen die LowVol-/
 * DeadVol-Verstärkungen in dem Fall NICHT anwenden.
 */
import { buildMarketContext } from '../marketContext.js';
import { computeForkMultipliers } from '../strategy/novaPulseTargets.js';
import type { PricePoint } from '../priceFeed.js';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS: ${name}`);
  else { failures++; console.error(`  FAIL: ${name} ${detail}`); }
}

function ticks(prices: number[], stepMs = 2000): PricePoint[] {
  const t0 = 1_700_000_000_000;
  return prices.map((p, i) => ({ timestamp: t0 + i * stepMs, price: p }));
}

// 1) Flache Serie mit GROBER Auflösung (0.1311 → Quantum 1e-4 = 0.076 %) → zensiert
{
  const ctx = buildMarketContext(ticks(Array(60).fill(0.1311)));
  check('flat coarse grid → volatilityCensored=true', ctx.volatilityCensored === true);
  check(
    'flat coarse grid → volatility = Quantum-Untergrenze ~0.076%',
    Math.abs(ctx.volatility - (0.0001 / 0.1311) * 100) < 1e-9,
    `got ${ctx.volatility}`,
  );
  const fm = computeForkMultipliers({ session: 'ny', volatility: ctx.volatility, volatilityCensored: ctx.volatilityCensored });
  check('censored → kein LowVol-Spike-Multiplikator', fm.spike === 1.0, `got ${fm.spike}`);
  check('censored → kein DeadVol-SellDrop-Multiplikator', fm.sellDrop === 1.0, `got ${fm.sellDrop}`);
  check('censored → kein LowVol/DeadVol-Trigger', !fm.triggers.includes('LowVol') && !fm.triggers.includes('DeadVol'));
}

// 2) Flache Serie mit FEINER Auflösung (9 Dezimalstellen, Quantum 0.00004 %) → nicht zensiert
{
  const ctx = buildMarketContext(ticks(Array(60).fill(0.000002301)));
  check('flat fine grid → nicht zensiert', ctx.volatilityCensored === undefined);
  check('flat fine grid → volatility bleibt 0', ctx.volatility === 0, `got ${ctx.volatility}`);
  const fm = computeForkMultipliers({ session: 'ny', volatility: ctx.volatility, volatilityCensored: ctx.volatilityCensored });
  check('feine Auflösung → LowVol-Multiplikator greift weiter', fm.spike === 1.3, `got ${fm.spike}`);
  check('feine Auflösung → DeadVol-Multiplikator greift weiter', fm.sellDrop === 1.15, `got ${fm.sellDrop}`);
}

// 3) Bewegte Serie → kein Censoring, normale Messung
{
  const prices: number[] = [];
  let p = 0.1311;
  for (let i = 0; i < 60; i++) { p *= i % 2 === 0 ? 1.002 : 0.999; prices.push(p); }
  const ctx = buildMarketContext(ticks(prices));
  check('moving series → nicht zensiert', ctx.volatilityCensored === undefined);
  check('moving series → volatility > 0', ctx.volatility > 0, `got ${ctx.volatility}`);
}

// 4) Zu kurze Serie → kein Crash, kein Censoring
{
  const ctx = buildMarketContext(ticks([0.1311]));
  check('single tick → volatility 0, nicht zensiert', ctx.volatility === 0 && ctx.volatilityCensored === undefined);
}

// 5) Session-Multiplikator bleibt von Censoring unberührt (asia × 1.3 greift weiter)
{
  const fm = computeForkMultipliers({ session: 'asia', volatility: 0.076, volatilityCensored: true });
  check('censored + asia → Asia-Multiplikator bleibt', fm.spike === 1.3 && fm.triggers.includes('Asia'));
}

if (failures === 0) console.log('[MarketContext Test] ALL PASS');
else { console.error(`[MarketContext Test] ${failures} FAILED`); process.exit(1); }
