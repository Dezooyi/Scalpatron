/**
 * ADR-021: PAET Safety-Bounds — Validation-Wrapper für paetConfig.
 *
 * Scope-Einschränkung: Diese Datei validiert AUSSCHLIESSLICH das
 * `paetConfig`-Feld (enabled + blendRateR1/R2/Guard) via
 * `normalizePaetSelfOptConfig()`. Sie deckt NICHT die 12 PAET-Basis-Felder
 * (stl_seasonal_period, volatility_sigma_multiplier, ...) ab — diese
 * wurden in ADR-019 noch nicht mit Safety-Bounds versehen (eigene Lücke,
 * ADR-022-Kandidat).
 */

import { normalizePaetSelfOptConfig } from './paetTargets.js';
import type { PaetSettings } from '../paetEngine.js';

export function clampPaetSettings(s: PaetSettings): PaetSettings {
  if (s.paetConfig === undefined) return s;
  return { ...s, paetConfig: normalizePaetSelfOptConfig(s.paetConfig) };
}
