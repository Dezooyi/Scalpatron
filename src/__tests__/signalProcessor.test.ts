import { fft, dominantFrequencyPeriod, stlDecompose, computeDerivatives, volatilityBand } from '../signalProcessor.js';

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

function rms(values: number[]): number {
  const valid = values.filter(v => !isNaN(v));
  if (valid.length === 0) return 0;
  return Math.sqrt(valid.reduce((s, v) => s + v * v, 0) / valid.length);
}

function makeSine(n: number, period: number, amplitude = 1, offset = 0): number[] {
  return Array.from({ length: n }, (_, i) => offset + amplitude * Math.sin((2 * Math.PI * i) / period));
}

// ─── FFT ────────────────────────────────────────────────────────────────────

console.log('\n[signalProcessor.test] FFT\n');

console.log('Test 1: pure sine period=32, n=256 → peak bin at 8');
{
  const period = 32;
  const n = 256; // exactly 8 complete cycles → no spectral leakage
  const prices = makeSine(n, period);
  const { re: fRe, im: fIm } = fft(prices.slice(), new Array(n).fill(0));

  const half = n >> 1;
  let maxMagSq = 0;
  let peakBin = 0;
  for (let i = 1; i <= half; i++) {
    const magSq = fRe[i] * fRe[i] + fIm[i] * fIm[i];
    if (magSq > maxMagSq) { maxMagSq = magSq; peakBin = i; }
  }
  const expectedBin = n / period;
  assert(peakBin === expectedBin, `peak bin = ${peakBin}, expected ${expectedBin}`);
}

console.log('\nTest 2: FFT of constant signal → all bins (except DC) near zero');
{
  const n = 64;
  const re = new Array(n).fill(5);
  const im = new Array(n).fill(0);
  const { re: fRe, im: fIm } = fft(re, im);
  const half = n >> 1;
  let maxNonDC = 0;
  for (let i = 1; i <= half; i++) {
    maxNonDC = Math.max(maxNonDC, Math.sqrt(fRe[i] * fRe[i] + fIm[i] * fIm[i]));
  }
  assert(maxNonDC < 1e-9, `max non-DC magnitude = ${maxNonDC.toExponential(2)}`);
}

console.log('\nTest 3: Parseval — energy conserved (|FFT|² / n = Σ|x|²)');
{
  const prices = makeSine(64, 16, 3, 10);
  const re = prices.slice();
  const im = new Array(64).fill(0);
  const { re: fRe, im: fIm } = fft(re, im);
  const n = 64;
  const timeDomainEnergy = prices.reduce((s, v) => s + v * v, 0);
  const freqDomainEnergy = fRe.reduce((s, r, i) => s + r * r + fIm[i] * fIm[i], 0) / n;
  const relError = Math.abs(timeDomainEnergy - freqDomainEnergy) / timeDomainEnergy;
  assert(relError < 1e-9, `Parseval error = ${relError.toExponential(2)}`);
}

// ─── dominantFrequencyPeriod ─────────────────────────────────────────────────

console.log('\n[signalProcessor.test] dominantFrequencyPeriod\n');

console.log('Test 4: period=45, n=256 → detected within ±5');
{
  const period = 45;
  // amplitude 10 >> linear trend max-deviation 1.28 → sine dominates
  const prices = makeSine(256, period, 10, 100).map((v, i) => v + i * 0.01);
  const detected = dominantFrequencyPeriod(prices);
  assert(Math.abs(detected - period) <= 5, `detected=${detected}, expected≈${period}`);
}

console.log('\nTest 5: period=20, n=128 → detected within ±3');
{
  const period = 20;
  const prices = makeSine(128, period, 5, 50);
  const detected = dominantFrequencyPeriod(prices);
  assert(Math.abs(detected - period) <= 3, `detected=${detected}, expected≈${period}`);
}

console.log('\nTest 6: very short input (< 32) → returns value in [2, 240]');
{
  const prices = [1, 2, 3, 4, 5];
  const detected = dominantFrequencyPeriod(prices);
  assert(detected >= 2 && detected <= 240, `out-of-range: ${detected}`);
}

// ─── STL Decomposition ───────────────────────────────────────────────────────

console.log('\n[signalProcessor.test] STL decomposition\n');

console.log('Test 7: reconstruction identity Y = T + S + I');
{
  const n = 200;
  const prices: number[] = Array.from({ length: n }, (_, i) =>
    100 + 0.05 * i + 3 * Math.sin((2 * Math.PI * i) / 20) + (Math.random() - 0.5) * 0.5,
  );
  const { trend, seasonal, residual } = stlDecompose(prices, 40, 20);
  let identityHolds = true;
  for (let i = 0; i < n; i++) {
    if (!isNaN(trend[i])) {
      const reconstructed = trend[i] + seasonal[i] + residual[i];
      if (Math.abs(reconstructed - prices[i]) > 1e-9) {
        identityHolds = false;
        break;
      }
    }
  }
  assert(identityHolds, 'T + S + I = Y for all non-NaN indices');
}

console.log('\nTest 8: trend smoother than raw prices (lower variance of first-differences)');
{
  const n = 200;
  const prices: number[] = Array.from({ length: n }, (_, i) =>
    100 + 0.05 * i + 3 * Math.sin((2 * Math.PI * i) / 20) + (Math.random() - 0.5) * 0.5,
  );
  const { trend } = stlDecompose(prices, 40, 20);

  const rawDiffStd = rms(prices.slice(1).map((p, i) => p - prices[i]));
  const validTrend = trend.filter(v => !isNaN(v));
  const trendDiffStd = rms(validTrend.slice(1).map((p, i) => p - validTrend[i]));

  assert(trendDiffStd < rawDiffStd, `trendDiffStd=${trendDiffStd.toFixed(4)}, rawDiffStd=${rawDiffStd.toFixed(4)}`);
}

console.log('\nTest 9: residual amplitude < seasonal amplitude (signal captured by S)');
{
  const n = 200;
  // Seasonal amplitude 5, noise amplitude 0.25 — residual should be ≈ noise only
  const prices: number[] = Array.from({ length: n }, (_, i) =>
    100 + 5 * Math.sin((2 * Math.PI * i) / 20) + (Math.random() - 0.5) * 0.5,
  );
  const { seasonal, residual } = stlDecompose(prices, 40, 20);
  const residualRms = rms(residual);
  const seasonalRms = rms(seasonal);
  assert(
    residualRms < seasonalRms,
    `residualRms=${residualRms.toFixed(4)}, seasonalRms=${seasonalRms.toFixed(4)}`,
  );
}

console.log('\nTest 10: constant prices → residual is exactly zero');
{
  const prices = new Array(100).fill(42);
  const { residual } = stlDecompose(prices, 20, 10);
  const validResidual = residual.filter(v => !isNaN(v));
  assert(validResidual.length > 0, 'some valid residual values exist');
  const maxResidual = Math.max(...validResidual.map(Math.abs));
  assert(maxResidual < 1e-9, `max|residual|=${maxResidual.toExponential(2)}`);
}

console.log('\nTest 11: auto-detect (seasonalPeriod=0) — returns valid period');
{
  const period = 30;
  const prices = makeSine(200, period, 8, 100);
  const { dominantPeriodCandles } = stlDecompose(prices, 40, 0);
  assert(
    dominantPeriodCandles >= 2 && dominantPeriodCandles <= 240,
    `dominantPeriodCandles=${dominantPeriodCandles} out of [2,240]`,
  );
}

console.log('\nTest 12: short input (n < trendWindow) — no crash, returns arrays of correct length');
{
  const prices = [100, 101, 99, 102, 98];
  const { trend, seasonal, residual } = stlDecompose(prices, 60, 3);
  assert(trend.length === prices.length, `trend.length=${trend.length}`);
  assert(seasonal.length === prices.length, `seasonal.length=${seasonal.length}`);
  assert(residual.length === prices.length, `residual.length=${residual.length}`);
}

// ─── computeDerivatives ───────────────────────────────────────────────────────

console.log('\n[signalProcessor.test] computeDerivatives\n');

console.log('Test 13: constant price → velocity = 0, acceleration = 0');
{
  const prices = new Array(30).fill(100);
  const { velocity, acceleration } = computeDerivatives(prices, 3);
  const validV = velocity.filter(v => !isNaN(v));
  const validA = acceleration.filter(v => !isNaN(v));
  assert(validV.length > 0, 'some valid velocity values');
  assert(Math.max(...validV.map(Math.abs)) < 1e-9, 'velocity ≈ 0 for constant price');
  assert(Math.max(...validA.map(Math.abs)) < 1e-9, 'acceleration ≈ 0 for constant price');
}

console.log('\nTest 14: linearly falling price → velocity < 0, acceleration ≈ 0');
{
  // p[i] = 100 - 2*i  → first diff = -2, second diff = 0
  const prices = Array.from({ length: 40 }, (_, i) => 100 - 2 * i);
  const { velocity, acceleration } = computeDerivatives(prices, 3);
  const validV = velocity.filter(v => !isNaN(v));
  const validA = acceleration.filter(v => !isNaN(v));
  assert(validV.every(v => v <= 0), 'all velocity values ≤ 0 for falling price');
  // EMA smoothing introduces tiny delay but 2nd diff converges to ~0
  const maxAcc = Math.max(...validA.map(Math.abs));
  assert(maxAcc < 0.5, `acceleration near-zero for linear fall, max=${maxAcc.toFixed(4)}`);
}

console.log('\nTest 15: quadratically accelerating crash → acceleration < 0');
{
  // p[i] = 100 - i²/50  →  d²p/dt² = -2/50 = -0.04 < 0 (price fall accelerates)
  // Note: exponential *decay* e^(-kt) has d²/dt² > 0 (concave up, decelerating fall).
  // An accelerating crash requires a parabola opening downward.
  const n = 60;
  const prices = Array.from({ length: n }, (_, i) => 100 - (i * i) / 50);
  const { acceleration } = computeDerivatives(prices, 3);
  const validA = acceleration.filter(v => !isNaN(v));
  // Skip initial EMA warmup; last 80% should all be negative
  const steadyAccel = validA.slice(-Math.floor(validA.length * 0.8));
  assert(
    steadyAccel.length > 0 && steadyAccel.every(a => a < 0),
    `acceleration < 0 for accelerating crash, last: ${steadyAccel.slice(-3).map(a => a.toFixed(4)).join(', ')}`,
  );
}

console.log('\nTest 16: short input (< 3) → returns NaN arrays of correct length');
{
  const prices = [50, 48];
  const { velocity, acceleration } = computeDerivatives(prices, 3);
  assert(velocity.length === 2, `velocity.length=${velocity.length}`);
  assert(acceleration.length === 2, `acceleration.length=${acceleration.length}`);
}

// ─── volatilityBand ───────────────────────────────────────────────────────────

console.log('\n[signalProcessor.test] volatilityBand\n');

console.log('Test 17: band symmetric around trend, width = 2 * σ * multiplier');
{
  const n = 100;
  const trendPrices = new Array(n).fill(100);
  // Residual with known std (uniform ±1, std ≈ 0.577)
  const residualPrices = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 1 : -1));
  const { upper, lower, sigma } = volatilityBand(trendPrices, residualPrices, 2.0);
  const validU = upper.filter(v => !isNaN(v));
  const validL = lower.filter(v => !isNaN(v));
  assert(validU.length > 0, 'upper band has valid values');
  assert(validL.length > 0, 'lower band has valid values');
  // upper[i] = 100 + 2σ, lower[i] = 100 - 2σ
  const expectedHalfBand = 2.0 * sigma;
  assert(Math.abs(validU[0] - 100 - expectedHalfBand) < 1e-9, 'upper = trend + 2σ');
  assert(Math.abs(validL[0] - 100 + expectedHalfBand) < 1e-9, 'lower = trend - 2σ');
}

console.log('\nTest 18: residual σ from STL < raw price σ when cycles present');
{
  const n = 200;
  const seasonPeriod = 20;
  const prices: number[] = Array.from({ length: n }, (_, i) =>
    100 + 5 * Math.sin((2 * Math.PI * i) / seasonPeriod) + (Math.random() - 0.5) * 0.4,
  );
  const { trend, residual } = stlDecompose(prices, 40, seasonPeriod);
  const { sigma: stlSigma } = volatilityBand(trend, residual, 2.0);

  const validPrices = prices.filter(v => !isNaN(v));
  const rawMean = validPrices.reduce((a, b) => a + b, 0) / validPrices.length;
  const rawVariance = validPrices.reduce((s, v) => s + (v - rawMean) ** 2, 0) / validPrices.length;
  const rawSigma = Math.sqrt(rawVariance);

  assert(!isNaN(stlSigma), 'sigma is computed');
  assert(stlSigma < rawSigma, `stlSigma=${stlSigma.toFixed(4)} < rawSigma=${rawSigma.toFixed(4)}`);
}

console.log('\nTest 19: NaN trend → NaN band at that index');
{
  // trend = [NaN, NaN, 100, 100], residual all valid
  const trend = [NaN, NaN, 100, 100];
  const residual = [0.1, -0.1, 0.2, -0.2];
  const { upper, lower } = volatilityBand(trend, residual, 2.0);
  assert(isNaN(upper[0]) && isNaN(upper[1]), 'upper NaN where trend NaN');
  assert(isNaN(lower[0]) && isNaN(lower[1]), 'lower NaN where trend NaN');
  assert(!isNaN(upper[2]) && !isNaN(upper[3]), 'upper valid where trend valid');
}

console.log('\nAll signalProcessor tests done.\n');
