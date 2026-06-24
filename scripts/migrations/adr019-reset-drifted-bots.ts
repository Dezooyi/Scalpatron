/**
 * ADR-019: One-shot migration — reset drifted scalping-adaptive bots.
 *
 * The Agent-ORUGA incident (2026-06-23) showed that an unguarded AI
 * advisory loop can walk takeProfitThreshold below the 2% roundtrip cost,
 * which guarantees a loss on every take-profit exit. This migration:
 *
 *  1. Loads all bots with strategyId === 'scalping-adaptive'.
 *  2. For each, reads `bots.settings` and checks whether any parameter
 *     has been driven below the safety floor.
 *  3. Replaces the drifted settings with the scalping-adaptive template
 *     defaults (the values also written into `bots.settings` on a fresh
 *     bot creation), and re-arms the kill switch.
 *
 * Run with: npx tsx scripts/migrations/adr019-reset-drifted-bots.ts
 */
import { db } from '../../src/db.js';
import { loadBuiltinTemplates } from '../../src/strategyEngine.js';
import {
  isScalpingSettingsDrifted,
  MIN_TAKE_PROFIT,
  MIN_SELL_DROP_THRESHOLD_PCT,
  MIN_SPIKE_THRESHOLD_PCT,
  MIN_COOLDOWN_TICKS,
  MIN_FLOOR_WINDOW,
  MAX_FLOOR_WINDOW,
} from '../../src/strategy/scalpingSafetyBounds.js';
import type { PatternSettings } from '../../src/patternDetector.js';

interface BotRow {
  id: string;
  name: string;
  strategyId: string | null;
  settings: string;
  killSwitch: string | null;
}

async function main(): Promise<void> {
  console.log('[adr019-migration] Booting scalping-adaptive safety migration...');

  const templates = await loadBuiltinTemplates();
  const template = templates.find((t) => t.id === 'scalping-adaptive');
  if (!template) {
    console.error('[adr019-migration] scalping-adaptive template not found, aborting.');
    process.exit(1);
  }
  const defaults: PatternSettings = {
    floorWindow: 30,
    spikeThreshold: 2.0,
    sellDropThreshold: 4.0,
    cooldownTicks: 20,
    takeProfitThreshold: 0.08,
    startDelayTicks: 30,
    minHoldTicks: 30,
    breakevenTriggerPct: 0.03,
  };

  const rows = db
    .prepare(
      'SELECT id, name, strategyId, settings, killSwitch FROM bots WHERE strategyId = ?',
    )
    .all('scalping-adaptive') as BotRow[];

  console.log(`[adr019-migration] Found ${rows.length} bots using scalping-adaptive template.`);

  let resetCount = 0;
  let armedCount = 0;
  for (const row of rows) {
    let parsed: Partial<PatternSettings> = {};
    try {
      parsed = JSON.parse(row.settings) as Partial<PatternSettings>;
    } catch {
      console.warn(`[adr019-migration] Bot ${row.id} (${row.name}): unparsable settings JSON, resetting.`);
      parsed = {};
    }

    if (!isScalpingSettingsDrifted(parsed)) {
      console.log(`[adr019-migration] Bot ${row.id} (${row.name}): settings within bounds, skipping.`);
      continue;
    }

    const oldTp = parsed.takeProfitThreshold;
    const oldDrop = parsed.sellDropThreshold;
    const oldSpike = parsed.spikeThreshold;
    const oldCooldown = parsed.cooldownTicks;
    const oldFloorWindow = parsed.floorWindow;

    const merged: PatternSettings = { ...defaults, ...parsed, ...defaults };
    db.prepare('UPDATE bots SET settings = ? WHERE id = ?').run(
      JSON.stringify(merged),
      row.id,
    );
    resetCount++;
    console.warn(
      `[adr019-migration] Bot ${row.id} (${row.name}): settings reset to defaults ` +
        `(tp=${oldTp}→${defaults.takeProfitThreshold}, drop=${oldDrop}→${defaults.sellDropThreshold}, ` +
        `spike=${oldSpike}→${defaults.spikeThreshold}, cooldown=${oldCooldown}→${defaults.cooldownTicks}, ` +
        `floor=${oldFloorWindow}→${defaults.floorWindow})`,
    );

    if (row.killSwitch) {
      try {
        const ks = JSON.parse(row.killSwitch) as { enabled?: boolean };
        if (ks.enabled === false) {
          ks.enabled = true;
          db.prepare('UPDATE bots SET killSwitch = ? WHERE id = ?').run(
            JSON.stringify(ks),
            row.id,
          );
          armedCount++;
          console.warn(`[adr019-migration] Bot ${row.id} (${row.name}): kill switch re-armed.`);
        }
      } catch {
        // ignore — leave as is
      }
    }
  }

  console.log(
    `\n[adr019-migration] Done. ${resetCount} bot(s) reset, ${armedCount} kill switch(es) re-armed. ` +
      `Bounds: TP>=${MIN_TAKE_PROFIT.toFixed(3)}, drop>=${MIN_SELL_DROP_THRESHOLD_PCT}%, ` +
      `spike>=${MIN_SPIKE_THRESHOLD_PCT}%, cooldown>=${MIN_COOLDOWN_TICKS}, ` +
      `floor in [${MIN_FLOOR_WINDOW},${MAX_FLOOR_WINDOW}].`,
  );
}

main().catch((err) => {
  console.error('[adr019-migration] Failed:', (err as Error).message);
  process.exit(1);
});
