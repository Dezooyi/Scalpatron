import type { TimesFmForecast } from '../timesFmForecast.js';
import { ForecastCacheService } from '../timesFmCache.js';

let failures = 0;

function check(name: string, condition: boolean): void {
  console.log(`[TimesFmCache Test] ${name}: ${condition ? 'PASS' : 'FAIL'}`);
  if (!condition) failures++;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function makeForecast(net = -0.8): TimesFmForecast {
  return {
    expectedReturnPct: net + 2,
    netExpectedReturnPct: net,
    signalVector: {
      directionScore: -0.5,
      slopeConsistency: 0.8,
      forecastVolatilityPct: 0.2,
      dataQualityScore: 0.9,
    },
    forecastPrices: [1.0, 0.995, 0.99],
    contextLength: 128,
    horizon: 12,
    medianIntervalMs: 2000,
    maxGapMs: 2100,
  };
}

async function run(): Promise<boolean> {
  // ── 1. Erfolg: Forecast wird gecacht und frisch geliefert ─────────────────
  let fetchCount = 0;
  let persistCount = 0;
  const cacheOk = new ForecastCacheService(
    async () => { fetchCount++; return makeForecast(-1.2); },
    { ttlMs: 50, failCooldownMs: 1000 },
    () => { persistCount++; },
  );
  await cacheOk.refresh('mint1');
  check('fresh forecast available after refresh', cacheOk.getSnapshot('mint1') !== null);
  check('persist hook called on success', persistCount === 1);
  check('fetcher called exactly once', fetchCount === 1);

  // ── 2. TTL: nach Ablauf gilt der Forecast als veraltet ────────────────────
  await sleep(70);
  check('forecast stale after TTL', cacheOk.getSnapshot('mint1') === null);

  // ── 3. Dedupe: parallele Refreshs erzeugen nur einen HTTP-Aufruf ──────────
  fetchCount = 0;
  const cacheDedupe = new ForecastCacheService(
    async () => { fetchCount++; await sleep(30); return makeForecast(0.5); },
    { ttlMs: 60_000, failCooldownMs: 0 },
  );
  const [r1, r2] = await Promise.all([
    cacheDedupe.refresh('mint2'),
    cacheDedupe.refresh('mint2'),
  ]);
  check('concurrent refresh deduped to one fetch', fetchCount === 1);
  check('both callers got the forecast', r1 !== null && r2 !== null);

  // ── 4. Fehler: null-Forecast wird nicht gecacht, Cooldown greift ──────────
  fetchCount = 0;
  const cacheFail = new ForecastCacheService(
    async () => { fetchCount++; return null; },
    { ttlMs: 1000, failCooldownMs: 5000 },
  );
  await cacheFail.refresh('mint3');
  check('failed refresh yields no snapshot', cacheFail.getSnapshot('mint3') === null);
  await cacheFail.refresh('mint3');
  check('failure cooldown prevents refetch', fetchCount === 1);

  // ── 5. maybeRefresh: keine Aktion bei frischem Forecast ───────────────────
  fetchCount = 0;
  const cacheFresh = new ForecastCacheService(
    async () => { fetchCount++; return makeForecast(0.2); },
    { ttlMs: 60_000, failCooldownMs: 0 },
  );
  await cacheFresh.refresh('mint4');
  cacheFresh.maybeRefresh('mint4');
  check('maybeRefresh no-op while fresh', fetchCount === 1);

  return failures === 0;
}

run().then((ok) => process.exit(ok ? 0 : 1));
