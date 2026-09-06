import { getTimesFmSettings, updateTimesFmSettings, _setTimesFmSettingsForTest } from '../timesFmSettings.js';

let failures = 0;

function check(name: string, condition: boolean): void {
  console.log(`[TimesFmSettings Test] ${name}: ${condition ? 'PASS' : 'FAIL'}`);
  if (!condition) failures++;
}

_setTimesFmSettingsForTest({
  enabled: true,
  tradeGate: true,
  selfOptGate: true,
  minTrades: 20,
  minWinRate: 0.35,
});

// ── Defaults & Update ────────────────────────────────────────────────────────
const initial = getTimesFmSettings();
check('default enabled', initial.enabled === true);
check('default tradeGate', initial.tradeGate === true);
check('default selfOptGate', initial.selfOptGate === true);

const updated = updateTimesFmSettings({ tradeGate: false, minTrades: 3 });
check('update merges fields', getTimesFmSettings().tradeGate === false);
check('update keeps other fields', getTimesFmSettings().enabled === true);
check('minTrades clamped to ≥ 5', updated.minTrades === 5);

updateTimesFmSettings({ enabled: false, selfOptGate: false, minWinRate: 1.5 });
check('enabled persisted', getTimesFmSettings().enabled === false);
check('minWinRate clamped to ≤ 0.9', getTimesFmSettings().minWinRate === 0.9);

// Zustand für andere Tests nicht verfälschen: zurück auf Defaults.
updateTimesFmSettings({ enabled: true, tradeGate: true, selfOptGate: true, minTrades: 20, minWinRate: 0.35 });

process.exit(failures === 0 ? 0 : 1);
