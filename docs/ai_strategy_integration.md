# Künstliche Intelligenz - Handelsstrategien & Logik-Handout

Dieses Dokument fasst die wichtigsten Architekturverbesserungen, behobenen Logikfehler und Sicherheitsmechanismen zusammen, die bei der Integration des Ollama KI-Agenten in die dynamische Strategie-Engine (`StrategyEngine`) umgesetzt wurden.
Diese Dokumentation dient als Leitfaden für die künftige Weiterentwicklung und Wartung der Bot-Logik.

## 1. Das Positionsgrößen-Problem (Trade Reject Bug)
### Ausgangssituation
Der KI-Agent optimiert in regelmäßigen Zyklen die Aggressivität (`risk_management.position_size`). Der System-Prompt bittet dabei explizit um einen Prozentwert der Balance (z.B. `20` für 20%). Die `Trader`-Klasse (`trader.ts`) erwartete jedoch historisch bedingt einen Dezimalbruch (z.B. `0.2`). 
Dadurch interpretierte das Handelssystem den KI-Wert `20` als den 20-fachen Multiplikator der verfügbaren Balance. Dies löste durchgehend die Wallet-Sicherheitschecks (`effectiveTradeSize > this.balanceSOL - 0.01`) aus und **lehnte lautlos sämtliche Kauf-Signale (BUY) ab**, wodurch die Bots nach einem KI-Update handlungsunfähig wurden.

### Die Lösung
Der `Trader` validiert nun den `positionSizePct` Wert. Ist er größer als 1 (z.B. durch eine KI-Ganzzahl-Prozentangabe), wird dieser durch 100 geteilt (`pct = positionSizePct / 100`). Ist er <= 1, wird der Dezimalwert nativ übernommen. Dies garantiert, dass die KI jede Schreibart nutzen kann, ohne die Positionsgrößen zu sprengen.

---

## 2. Der Indikator-Update-Bug (Erblindung der ENTRY_CONDITIONS)
### Ausgangssituation
In den Strategie-Templates (z.B. `ema_trend.json`, `momentum.json`) bedienen sich die Auslöseregeln (`entry_conditions`) starrer String-Referenzen für ihre Signale. Die EMA-Trend-Strategie lauschte beispielsweise zwingend auf ein Signal namens `EMA_12 crossover EMA_26`.

Wenn die Künstliche Intelligenz jedoch zu dem Schluss kam, den Markt mit anderen Perioden (z.B. `20` und `50`) zu analysieren, generierte die `computeAll`-Methode der `indicatorEngine.ts` neue Indikatoren mit dem Namen `EMA_20` und `EMA_50`. Da die Einstiegsregeln jedoch weiterhin nach dem nicht mehr existierenden `EMA_12` fragten, evaluierten alle Konditionen als `NaN` (Not a Number). Dies machte **sämtliche Indikator-basierten Strategien blind**, wodurch sie sofort das Handeln einstellten.

### Die Lösung: Rank-Based Fallback
Die Lösung ist in die `StrategyEngine` (`strategyEngine.ts`) implementiert, genauer gesagt in den Methoden `resolveValue` und der zugehörigen Crossover-Fallbacks (`getSeries`):
Die Engine sortiert automatisch alle alten, durch das JSON-Template verlangten Indikatornamen (z.B. `EMA_12` und `EMA_26`) nach ihrer mathematischen Periode und bestimmt ihren "Rang" als Schneller- oder Langsamer-Indikator. 
Anschließend vergleicht und mappt sie diese Ränge 1:1 auf die neu von der KI erstellten Indikatoren (z.B. `EMA_20` und `EMA_50`). 

* **Ergebnis:** `EMA_12` (schnell, Rank 0) sucht sich automatisch den neuen `EMA_20` (schnell, Rank 0). `EMA_26` (langsam, Rank 1) mappt stetig auf den neuen `EMA_50` (langsam, Rank 1). 
Diese Methode macht das Logik-Konstrukt komplett unverwüstlich gegen willkürliche Indikatorwechsel durch das LLM.

---

## 3. Tickraten, Aggregation und die Umgebung (.env)
Das Ökosystem verhält sich auf intelligente Weise unabhängig von der gewählten `.env`-Tickrate (`PRICE_FEED_TICKRATE_MS`):

1. **Indikator-basierte Strategien (Trend, Mean Reversion, Breakout):**
   Unabhängig davon, ob Ticks alle 2 Sekunden oder alle 10 Sekunden durch das Polling generiert werden, baut der `candleAggregator` diese zeitlich akkurat in reale 1-Minuten-Kerzen zusammen. Ein `EMA_20` wird so immer korrekte 20 Minuten Zeitgeschichte repräsentieren. Die KI-Empfehlungen sind somit entkoppelt von der Netzwerk-/Pollinggeschwindigkeit der Solana-Screener.

2. **Die Scalping-Strategie:**
   Der "Range Spike Scalper" (`PatternDetector`) misst den Boden direkt über ein rohes `floorWindow` von X *Ticks* (anstatt Minuten).
   Um eine Verfälschung der Umgebung zu vermeiden, übergibt der System-Prompt (`ollamaAgent.ts`) der KI vor der Analyse genau das Verhältnis von Zyklen-Zeitraum (z.B. 21 Minuten) zu den dabei gesammelten Ticks. Dadurch kann die KI korrekte Rückschlüsse auf die herrschende `.env`-Auflösung ziehen und ihre Scalping-Parameter präzise an das Datenmuster anpassen.

---
**Fazit:** Das System toleriert nun fließend das LLM-Output-Chaos. Strategien können modifiziert, Indikator-Perioden verändert und Hardware-Raten angepasst werden, ohne dass die Handelsschlaufen jemals wieder abreißen.
