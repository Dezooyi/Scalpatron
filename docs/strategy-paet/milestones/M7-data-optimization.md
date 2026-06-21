# M7 — Daten-Pipeline & AI Feedback Loop

Status: DONE ✓ (2026-06-21)

## Ziel

Gesammelte Daten werden nutzbar: Redundanz eliminiert, Speicher begrenzt, AI-Agent erhält zwei neue Datenquellen, PAET-Fehlalarme erzeugen automatisch Lessons.

## Zu liefern

### 1. Daten-Retention (Cleanup)
- `src/priceRecorder.ts` → `pruneJSONL(olderThanMs): number`
- `src/index.ts` → Auto-Cleanup auf Startup + tägliches Interval

### 2. Strategy × Regime Matrix
- `src/db.ts` → `getStrategyRegimePerformance(botId?, minSamples): StrategyRegimePerformance[]`

### 3. Force-Multiplier-Effektivität
- `src/db.ts` → `getForceMultiplierTierStats(botId?, minSamples): ForceMultiplierTierStats[]`

### 4. PAET Fehlalarm-Lessons
- `src/botInstance.ts` → `indicatorSnapshot` in `paetPendingOutcome` (SELL-Zeitpunkt)
- `src/botInstance.ts` → `insertLesson()` bei Fehlalarm (Preis +2% nach EXIT)

### 5. AI-Agent Prompt-Integration
- `src/ollamaAgent.ts` → Import + Abruf beider neuer DB-Funktionen
- `src/ollamaAgent.ts` → 2 neue Prompt-Blöcke im User-Prompt

## Akzeptanzkriterien
- [x] `pruneJSONL(7d)` entfernt Zeilen < Cutoff-Timestamp, gibt Anzahl zurück
- [x] Startup-Cleanup läuft einmalig, dann tägliches `setInterval().unref()`
- [x] `getStrategyRegimePerformance()` gibt `{ strategyType, regime, winRate, avgPnl, totalTrades }`
- [x] `getForceMultiplierTierStats()` gibt `{ tier, rangeLabel, winRate, avgPnl, totalTrades, avgConfidence }`
- [x] `paetPendingOutcome.indicatorSnapshot` enthält PAET-Metriken zum EXIT-Zeitpunkt
- [x] Bei Fehlalarm (`postExitChange > 2%`): Lesson mit σ, period, ω als Evidence geschrieben
- [x] Prompt enthält Sektionen „STRATEGY × REGIME MATRIX" + „AI TRUST EFFECTIVENESS"
- [x] TypeScript kompiliert ohne Fehler

## Technische Details

### `pruneJSONL()` — Implementierung
```
Liest prices.jsonl vollständig
Filtert: keep where JSON.parse(line).timestamp >= Date.now() - olderThanMs
Schreibt Datei neu wenn removed > 0
Gibt removed count zurück
```

### `getStrategyRegimePerformance()` — SQL
```sql
SELECT json_extract(s.config, '$.strategy_type') AS strategy_type,
       ah.regime,
       ROUND(100.0 * SUM(CASE WHEN ah.outcome = 'win' THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate,
       ROUND(AVG(ah.pnl_pct), 4) AS avg_pnl,
       COUNT(*) AS total_trades
FROM agent_history ah
JOIN bots b ON b.id = ah.bot_id
JOIN strategies s ON s.id = b.strategy_id
WHERE (botId IS NULL OR ah.bot_id = botId)
GROUP BY strategy_type, regime
HAVING total_trades >= minSamples
```

### `getForceMultiplierTierStats()` — Tier-Einteilung
| Tier | Range | Label |
|---|---|---|
| `low` | 0–30 | `0–30%` |
| `medium` | 31–60 | `31–60%` |
| `high` | 61–100 | `61–100%` |

### PAET Fehlalarm-Lesson
Trigger: `postExitPriceChange > 0.02` (Preis +2% innerhalb 10 Ticks nach EXIT)
```
Kategorie: 'regime'
Lesson: "PAET false alarm — price recovered +X.X% post-exit (ω=Y, period=Zc, σ=0.000041)"
Evidence: { priceChange, omega, period, sigma }
Confidence: min(1.0, 0.3 + |priceChange| × 2)
```

### Neue Prompt-Sektionen
```
STRATEGY × REGIME MATRIX (which strategy works in which regime):
- scalping/RANGING: 48% WR, avg PnL -0.012% (n=23)
- mean_reversion/RANGING: 71% WR, avg PnL +0.041% (n=12)

AI TRUST EFFECTIVENESS (force-multiplier tiers):
- AI trust 0–30%: 52% WR, avg PnL -0.008%, avg conf 45% (n=18)
- AI trust 61–100%: 63% WR, avg PnL +0.027%, avg conf 72% (n=31)
```

## Nicht implementiert (bewusstes Out-of-Scope)
- `prices.jsonl` Mint-Isolation (→ ADR-013, Multi-Asset Phase 2)
- Persist der Adaptation-Werte in DB (→ Runtime-only per Design, PLAN.md § Adaptations-Persistenz)
- Aggregations-Dashboard im Frontend für Strategy×Regime (→ zukünftig via `/api/agent/regime-performance` Extension)
