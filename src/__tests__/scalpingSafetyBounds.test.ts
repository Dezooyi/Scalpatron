import {
  clampScalpingSettings,
  isScalpingSettingsDrifted,
  MIN_TAKE_PROFIT,
  MIN_SELL_DROP_THRESHOLD_PCT,
  MIN_SPIKE_THRESHOLD_PCT,
  MIN_COOLDOWN_TICKS,
  MIN_FLOOR_WINDOW,
} from '../strategy/scalpingSafetyBounds.js';

console.log('[Test] scalpingSafetyBounds: starting...');

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.error('  FAIL: ' + msg); }
}

// TP floor: any value below MIN_TAKE_PROFIT must be raised to MIN_TAKE_PROFIT.
const tpClamped = clampScalpingSettings({ takeProfitThreshold: 0.005 });
assert(
  tpClamped.takeProfitThreshold === MIN_TAKE_PROFIT,
  `clampTakeProfit(0.005) → ${MIN_TAKE_PROFIT.toFixed(3)} (was ${tpClamped.takeProfitThreshold})`,
);

// Drop floor: 0.5 → MIN_SELL_DROP_THRESHOLD_PCT.
const dropClamped = clampScalpingSettings({ sellDropThreshold: 0.5 });
assert(
  dropClamped.sellDropThreshold === MIN_SELL_DROP_THRESHOLD_PCT,
  `clampSellDrop(0.5) → ${MIN_SELL_DROP_THRESHOLD_PCT} (was ${dropClamped.sellDropThreshold})`,
);

// Spike floor: 0.15 → MIN_SPIKE_THRESHOLD_PCT.
const spikeClamped = clampScalpingSettings({ spikeThreshold: 0.15 });
assert(
  spikeClamped.spikeThreshold === MIN_SPIKE_THRESHOLD_PCT,
  `clampSpikeThreshold(0.15) → ${MIN_SPIKE_THRESHOLD_PCT} (was ${spikeClamped.spikeThreshold})`,
);

// Cooldown floor: 3 → MIN_COOLDOWN_TICKS.
const cdClamped = clampScalpingSettings({ cooldownTicks: 3 });
assert(
  cdClamped.cooldownTicks === MIN_COOLDOWN_TICKS,
  `clampCooldownTicks(3) → ${MIN_COOLDOWN_TICKS} (was ${cdClamped.cooldownTicks})`,
);

// Floor window bounds.
const fwLow = clampScalpingSettings({ floorWindow: 5 });
assert(fwLow.floorWindow === MIN_FLOOR_WINDOW, `clampFloorWindow(5) → ${MIN_FLOOR_WINDOW}`);
const fwHigh = clampScalpingSettings({ floorWindow: 200 });
assert(fwHigh.floorWindow === 50, `clampFloorWindow(200) → 50 (capped)`);

// Ceilings are respected for in-range extremes.
const tpHigh = clampScalpingSettings({ takeProfitThreshold: 0.9 });
assert(tpHigh.takeProfitThreshold === 0.50, `TP ceiling clamps to 0.50`);
const cdHigh = clampScalpingSettings({ cooldownTicks: 100 });
assert(cdHigh.cooldownTicks === 30, `Cooldown ceiling clamps to 30`);

// Empty / undefined input is safe.
assert(
  Object.keys(clampScalpingSettings(undefined)).length === 0,
  'clampScalpingSettings(undefined) returns empty object',
);

// NaN / Infinity are dropped, not silently propagated.
const nanDropped = clampScalpingSettings({ spikeThreshold: Number.NaN, sellDropThreshold: Infinity });
assert(!('spikeThreshold' in nanDropped), 'NaN spikeThreshold is dropped');
assert(!('sellDropThreshold' in nanDropped), 'Infinity sellDropThreshold is dropped');

// In-bounds values pass through unchanged.
const okIn = clampScalpingSettings({
  floorWindow: 30,
  spikeThreshold: 2.0,
  sellDropThreshold: 4.0,
  cooldownTicks: 20,
  takeProfitThreshold: 0.08,
});
assert(okIn.floorWindow === 30 && okIn.spikeThreshold === 2.0 && okIn.takeProfitThreshold === 0.08,
  'in-bounds settings pass through unchanged');

// isScalpingSettingsDrifted detection.
assert(
  isScalpingSettingsDrifted({ takeProfitThreshold: 0.01 }),
  'takeProfit 0.01 (< 0.05) is drifted',
);
assert(
  !isScalpingSettingsDrifted({ takeProfitThreshold: 0.08, sellDropThreshold: 4, spikeThreshold: 2, cooldownTicks: 20 }),
  'default scalping-adaptive settings are NOT drifted',
);
assert(
  isScalpingSettingsDrifted({ sellDropThreshold: 1.0 }),
  'sellDrop 1.0 (< 2.0) is drifted',
);

console.log('\n[Test] scalpingSafetyBounds: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
else process.exit(0);
