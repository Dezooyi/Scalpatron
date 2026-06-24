import { decideOutcomeGate, type OutcomeGateConfig } from '../ollamaAgent.js';

console.log('[Test] ollamaAgentOutcomeGate: starting...');

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.error('  FAIL: ' + msg); }
}

const gate: OutcomeGateConfig = {
  minOutcomeTrades: 20,
  minOutcomeWinRate: 0.35,
  confidenceDecayFloor: 0.5,
};

// Case 1: no prior outcome → gate passes, no decay.
const r1 = decideOutcomeGate({
  adviceConfidence: 0.85,
  minConfidence: 0.4,
  autoApply: true,
  observeOnly: false,
  lastAppliedOutcome: null,
  gateConfig: gate,
});
assert(r1.applied === true, 'no prior outcome → applied (no gate-block)');
assert(Math.abs(r1.effectiveConfidence - 0.85) < 1e-9, 'no prior outcome → no decay (eff=0.85)');
assert(r1.blockedReason === null, 'no prior outcome → blockedReason=null');

// Case 2: 20 outcomes, 6 wins → 30% WR < 35% threshold → BLOCKED.
const r2 = decideOutcomeGate({
  adviceConfidence: 0.85,
  minConfidence: 0.4,
  autoApply: true,
  observeOnly: false,
  lastAppliedOutcome: { outcomeTradeCount: 20, outcomeWins: 6 },
  gateConfig: gate,
});
assert(r2.applied === false, '20 trades @ 30% WR → applied=false');
assert(r2.blockedReason !== null && r2.blockedReason.includes('outcome_gate_blocked'),
  'blockedReason mentions outcome_gate_blocked');
assert(r2.effectiveConfidence < 0.85, 'effectiveConfidence decayed below raw advice confidence');

// Case 3: 20 outcomes, 10 wins → 50% WR → gate passes, mild decay.
const r3 = decideOutcomeGate({
  adviceConfidence: 0.85,
  minConfidence: 0.4,
  autoApply: true,
  observeOnly: false,
  lastAppliedOutcome: { outcomeTradeCount: 20, outcomeWins: 10 },
  gateConfig: gate,
});
assert(r3.applied === true, '50% WR → gate passes → applied');
assert(Math.abs(r3.effectiveConfidence - 0.85) < 1e-9,
  '50% WR → observedWR/0.5 = 1.0 → no decay (eff=0.85)');

// Case 4: 19 outcomes, 6 wins → sample too small → no gate logic.
const r4 = decideOutcomeGate({
  adviceConfidence: 0.85,
  minConfidence: 0.4,
  autoApply: true,
  observeOnly: false,
  lastAppliedOutcome: { outcomeTradeCount: 19, outcomeWins: 6 },
  gateConfig: gate,
});
assert(r4.applied === true, '19 outcomes (< 20) → gate does NOT trigger');
assert(r4.blockedReason === null, 'small sample → no blockedReason');

// Case 5: observe-only short-circuits regardless of gate.
const r5 = decideOutcomeGate({
  adviceConfidence: 0.99,
  minConfidence: 0.4,
  autoApply: true,
  observeOnly: true,
  lastAppliedOutcome: { outcomeTradeCount: 50, outcomeWins: 25 },
  gateConfig: gate,
});
assert(r5.applied === false, 'observe-only overrides → applied=false');

// Case 6: low raw confidence below minConfidence → not applied.
const r6 = decideOutcomeGate({
  adviceConfidence: 0.20,
  minConfidence: 0.4,
  autoApply: true,
  observeOnly: false,
  lastAppliedOutcome: null,
  gateConfig: gate,
});
assert(r6.applied === false, 'conf 0.2 < minConf 0.4 → applied=false');

// Case 7: 20 outcomes, 4 wins → severe decay, gate-blocked.
const r7 = decideOutcomeGate({
  adviceConfidence: 0.85,
  minConfidence: 0.4,
  autoApply: true,
  observeOnly: false,
  lastAppliedOutcome: { outcomeTradeCount: 20, outcomeWins: 4 },
  gateConfig: gate,
});
assert(r7.applied === false, '20 trades @ 20% WR → applied=false (severe)');
// decay floor 0.5, observedWR=0.2, decay = min(1, 0.4) = 0.4
// effectiveConfidence = 0.85 * (0.5 + 0.5 * 0.4) = 0.85 * 0.7 = 0.595
assert(Math.abs(r7.effectiveConfidence - 0.595) < 1e-6,
  `20% WR: effectiveConfidence decayed to ${r7.effectiveConfidence.toFixed(3)} (expected 0.595)`);

console.log('\n[Test] ollamaAgentOutcomeGate: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
else process.exit(0);
