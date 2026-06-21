// Signal processing for PAET strategy: FFT + STL decomposition + derivatives
// Zero external dependencies — all algorithms implemented in-place.

import { SMA, EMA } from './indicatorEngine.js';

export interface STLResult {
  trend: number[];
  seasonal: number[];
  residual: number[];
  dominantPeriodCandles: number;
}

function nextPowerOf2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

// Cooley-Tukey DIT FFT (non-recursive, in-place).
// Input arrays must have the same length — a power of 2.
// Returns new arrays; inputs are not mutated.
export function fft(re: number[], im: number[]): { re: number[]; im: number[] } {
  const n = re.length;
  const outRe = re.slice();
  const outIm = im.slice();

  // Bit-reversal permutation
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [outRe[i], outRe[j]] = [outRe[j], outRe[i]];
      [outIm[i], outIm[j]] = [outIm[j], outIm[i]];
    }
  }

  // Butterfly stages
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wBaseRe = Math.cos(angle);
    const wBaseIm = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let k = 0; k < halfLen; k++) {
        const uRe = outRe[i + k];
        const uIm = outIm[i + k];
        const vRe = outRe[i + k + halfLen] * wRe - outIm[i + k + halfLen] * wIm;
        const vIm = outRe[i + k + halfLen] * wIm + outIm[i + k + halfLen] * wRe;

        outRe[i + k] = uRe + vRe;
        outIm[i + k] = uIm + vIm;
        outRe[i + k + halfLen] = uRe - vRe;
        outIm[i + k + halfLen] = uIm - vIm;

        const nextWRe = wRe * wBaseRe - wIm * wBaseIm;
        wIm = wRe * wBaseIm + wIm * wBaseRe;
        wRe = nextWRe;
      }
    }
  }

  return { re: outRe, im: outIm };
}

// Identifies the dominant cycle length in `prices` (in candles).
// Removes the mean before FFT to eliminate the DC component.
// Returns a period clamped to [2, 240].
export function dominantFrequencyPeriod(prices: number[]): number {
  if (prices.length < 4) return 2;

  const n = nextPowerOf2(Math.max(prices.length, 32));
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;

  const re = new Array<number>(n).fill(0);
  const im = new Array<number>(n).fill(0);
  for (let i = 0; i < prices.length; i++) {
    re[i] = prices[i] - mean;
  }

  const { re: fRe, im: fIm } = fft(re, im);

  // Find peak magnitude in [1 .. n/2] — skip DC (index 0) and mirror half
  let maxMagSq = 0;
  let peakIdx = 1;
  const half = n >> 1;
  for (let i = 1; i <= half; i++) {
    const magSq = fRe[i] * fRe[i] + fIm[i] * fIm[i];
    if (magSq > maxMagSq) {
      maxMagSq = magSq;
      peakIdx = i;
    }
  }

  const period = Math.round(n / peakIdx);
  return Math.max(2, Math.min(240, period));
}

// Simplified STL decomposition: Y(t) = T(t) + S(t) + I(t)
//
// T(t) — Trend:    SMA with trendWindow period
// S(t) — Seasonal: mean detrended value per seasonal phase
// I(t) — Residual: Y - T - S
//
// Set seasonalPeriod = 0 to auto-detect via FFT.
// The reconstruction identity Y = T + S + I holds exactly for all non-NaN indices.
export function stlDecompose(
  prices: number[],
  trendWindow: number,
  seasonalPeriod: number,
): STLResult {
  const n = prices.length;

  const period =
    seasonalPeriod === 0 ? dominantFrequencyPeriod(prices) : Math.max(2, seasonalPeriod);

  // Clamp window so there are at least a few valid trend values
  const effectiveWindow = Math.min(trendWindow, Math.max(2, Math.floor(n * 0.8)));
  const trend = SMA(prices, effectiveWindow);

  // Detrended series (NaN where trend is NaN)
  const detrended = prices.map((p, i) => (isNaN(trend[i]) ? NaN : p - trend[i]));

  // Seasonal: average detrended value per phase within the detected period
  const phaseSum = new Array<number>(period).fill(0);
  const phaseCount = new Array<number>(period).fill(0);
  for (let i = 0; i < n; i++) {
    if (!isNaN(detrended[i])) {
      const ph = i % period;
      phaseSum[ph] += detrended[i];
      phaseCount[ph]++;
    }
  }
  const phaseAvg = phaseSum.map((s, i) => (phaseCount[i] > 0 ? s / phaseCount[i] : 0));

  const seasonal = prices.map((_, i) => phaseAvg[i % period]);

  // Residual — exact by construction (T + S + I = Y for valid indices)
  const residual = prices.map((p, i) =>
    isNaN(trend[i]) ? NaN : p - trend[i] - seasonal[i],
  );

  return { trend, seasonal, residual, dominantPeriodCandles: period };
}

export interface DerivativesResult {
  velocity: number[];      // dv/dt  (1st derivative, smoothed)
  acceleration: number[];  // d²v/dt² (2nd derivative, smoothed)
}

// Computes smoothed 1st and 2nd derivatives via numerical differentiation.
// Applies EMA(emaPeriod) before differentiating to reduce tick noise.
// Both output arrays are aligned to the input length (NaN for insufficient history).
export function computeDerivatives(prices: number[], emaPeriod: number): DerivativesResult {
  const n = prices.length;
  const zero = new Array<number>(n).fill(NaN);
  if (n < 3) return { velocity: zero, acceleration: zero };

  const smooth = EMA(prices, emaPeriod);

  const velocity = new Array<number>(n).fill(NaN);
  const acceleration = new Array<number>(n).fill(NaN);

  for (let i = 1; i < n; i++) {
    if (!isNaN(smooth[i]) && !isNaN(smooth[i - 1])) {
      velocity[i] = smooth[i] - smooth[i - 1];
    }
  }

  for (let i = 2; i < n; i++) {
    if (!isNaN(smooth[i]) && !isNaN(smooth[i - 1]) && !isNaN(smooth[i - 2])) {
      acceleration[i] = smooth[i] - 2 * smooth[i - 1] + smooth[i - 2];
    }
  }

  return { velocity, acceleration };
}

export interface VolatilityBandResult {
  upper: number[];
  lower: number[];
  sigma: number;  // current residual σ (scalar, for PNR engine)
}

// Computes a dynamic volatility band around the trend T(t) using the
// standard deviation of the STL residuals I(t).
//
// upper[i] = trend[i] + sigmaMultiplier * σ_I
// lower[i] = trend[i] - sigmaMultiplier * σ_I
//
// Only the last `lookbackResiduals` non-NaN residuals contribute to σ.
export function volatilityBand(
  trend: number[],
  residual: number[],
  sigmaMultiplier: number,
  lookbackResiduals = 60,
): VolatilityBandResult {
  const n = trend.length;
  const upper = new Array<number>(n).fill(NaN);
  const lower = new Array<number>(n).fill(NaN);

  // Collect recent valid residuals
  const validResiduals: number[] = [];
  for (let i = n - 1; i >= 0 && validResiduals.length < lookbackResiduals; i--) {
    if (!isNaN(residual[i])) validResiduals.push(residual[i]);
  }

  if (validResiduals.length < 2) return { upper, lower, sigma: NaN };

  const mean = validResiduals.reduce((a, b) => a + b, 0) / validResiduals.length;
  const variance = validResiduals.reduce((s, v) => s + (v - mean) ** 2, 0) / validResiduals.length;
  const sigma = Math.sqrt(variance);
  const halfBand = sigmaMultiplier * sigma;

  for (let i = 0; i < n; i++) {
    if (!isNaN(trend[i])) {
      upper[i] = trend[i] + halfBand;
      lower[i] = trend[i] - halfBand;
    }
  }

  return { upper, lower, sigma };
}
