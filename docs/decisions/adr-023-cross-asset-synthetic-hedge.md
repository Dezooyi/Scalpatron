# ADR-023: Synthetische Cross-Asset-Hedge-Strategie (Perp-Replikation)

**Datum:** 27. Juni 2026
**Status:** Ersetzt durch ADR-024
**Bereich:** Strategie / Architektur / Externe Abhängigkeiten / Risk / Geld
**Vorgänger:** ADR-012 (Strategy-Forks), ADR-013 (Multi-Asset), ADR-019 (Safety Bounds)
**Anlass:** `docs/Synthetische_Cross_Asset-Optionsstrat.md` (User-Konzept: Treasury-besicherter BTC-Kredit mit Strategic Default)

> **⚠️ ERSETZT DURCH [ADR-024](adr-024-delta-neutral-funding-carry.md) (27. Juni 2026).**
> Eine Profitabilitäts-Validierung (siehe ADR-024 §Kontext) ergab: Die hier gewählte
> **netto-short**-Variante hat **kein Alpha-Signal** und neutralen bis negativen
> Erwartungswert — Yield + Funding-Carry sind zu klein, um das direktionale BTC-Risiko
> zu rechtfertigen. Der User hat daraufhin zum **delta-neutralen Funding-Carry-Trade**
> gepivotet (ADR-024). Die hier dokumentierte ökonomische Zerlegung und die
> RWA-Machbarkeits-Recherche bleiben als Begründung gültig und werden in ADR-024
> referenziert.

---

## Kontext

Der User möchte die in `docs/Synthetische_Cross_Asset-Optionsstrat.md` beschriebene
Strategie als Bot mit einer Wallet betreiben. Das Konzept: tokenisierte US-Treasuries
als Kollateral hinterlegen → BTC-Kredit (LTV 50 %) aufnehmen → 50 % BTC halten,
50 % in Stablecoins → bei steigendem BTC „Strategic Default", bei fallendem BTC
günstig zurückkaufen.

Vor der Umsetzung wurde die **Ökonomie sauber durchgerechnet** und die **Machbarkeit
recherchiert**. Beides verändert die Entscheidung fundamental und ist hier dokumentiert,
weil es das „Warum" der gewählten Architektur trägt.

### Ökonomische Zerlegung (mit den Zahlen des Konzepts)

Setup: $100k Treasuries, $50k BTC geliehen, davon $25k BTC gehalten + $25k Stable.

**Tatsächliche Markt-Exposure = netto short $25k BTC** (geliehen $50k short − gehalten
$25k long) auf $100k Kapitalbasis → eine **0,25x-Short-Position**.

Equity beim normalen Schließen, `m` = BTC-Kursfaktor (m=1 am Start):

```
Equity = 100 (Treasuries) + 25·m (BTC) + 25 (Stable) − 50·m (Schuld) = 125 − 25·m  [in $k]
```

| BTC | m | Equity | Ergebnis |
|---|---|---|---|
| −50 % | 0,5 | $112,5k | **+12,5k** ✅ |
| Start | 1,0 | $100k | 0 |
| +50 % | 1,5 | $87,5k | **−12,5k** ❌ |
| +100 % | 2,0 | $75k | **−25k** ❌ |

Strategic-Default-Walk-away = `25·m + 25`. Lohnt erst ab **m > 2**, Break-even erst bei
**m ≈ 3 (BTC verdreifacht)**, echter Gewinn erst ab m > 3. **Erreichbar ist das nie**,
weil bei Liquidation-Threshold 80 % gilt `50m/100 = 0,8 → m = 1,6` → Zwangsliquidation
(inkl. Penalty), und externe Liquidations-Bots front-runnen bei HF < 1,0 sofort.

> **Kernbefund:** Das Konzept ist **keine Win-Win-Wette**. Realistisch ist es ein
> **gedeckelter BTC-Short, finanziert durch Yield** — profitabel wenn BTC fällt,
> gedeckelter Verlust wenn BTC steigt. Der vom Konzept behauptete „Bull-Case-Gewinn"
> ist ein Rechenfehler (entsteht erst > 3x BTC, lange nach der Zwangsliquidation).
> Das idealisierte Payoff ist Long-Vol/Strangle-artig; in der Praxis bleibt nur die
> Short-Hälfte. Als „synthetischer Put" verteidigbar, aber die „Prämie" = BTC-Leihzins
> minus Treasury-Yield **plus** Liquidationsstrafe.

### Machbarkeit der „reinen" RWA-Variante (recherchiert, Stand Juni 2026)

| Baustein | Realität | Bot-tauglich? |
|---|---|---|
| **OUSG** (Ondo) | Permissioned, KYC *beider* Transferparteien, $100k Min., nur Qualified Purchasers | ❌ nicht für selbstverwahrende Wallet |
| **USDY** (Ondo) | KYC zum Minten, 40-Tage-Lockup, danach frei handelbar (Sekundär), **nur Non-US**, auf Solana/ETH/Sui (~4,65 % APY) | ⚠️ nutzbar via Sekundärmarkt |
| **BUIDL** (BlackRock) | Permissioned, institutionell | ❌ |
| **BTC leihen *gegen* RWA-Collateral** | Morpho Blue isolierte Märkte theoretisch möglich, kein tiefer WBTC/Treasury-Markt belegt; Aave listet OUSG/USDY nicht breit als Collateral | ❌/⚠️ dünn |
| Institutionell (FalconX, Maple/Kraken OTC, Hidden Road, Hashi) | KYC-Prime-Broker, **keine Wallet-Bots** | ❌ |

→ Die „reine" Treasury→BTC-Kredit-Variante ist für einen selbstverwahrenden Wallet-Bot
**heute praktisch nicht realisierbar** (KYC/Permissioning der RWA-Token, dünne
BTC-Borrow-gegen-RWA-Märkte).

### Architektur-Konflikt mit Scalpatron

Scalpatron ist **Solana/SPL, Spot-only**: DexScreener-Feed, Jupiter-Ultra-Swaps
(`src/trader.ts`), `better-sqlite3`. Das Konzept-Papier ist **EVM** (Aave V3, Uniswap,
WBTC, OUSG, Solidity) und braucht **Leverage/Short + Lending**, was die bestehende
`RiskManagement.leverage`-Annahme (`src/strategyTypes.ts:68`, `leverage: 1 = no leverage`)
und der Spot-Trader nicht abdecken.

---

## Problem

1. **P1 — Ökonomie missverstanden:** Ohne Korrektur würde ein Bot gebaut, der im
   Bull-Case Verlust macht, während der User „Gewinn" erwartet → negativer
   Erwartungswert bei falscher Mental-Map.
2. **P2 — Reine RWA-Variante nicht wallet-tauglich:** KYC/Permissioning blockiert die
   1:1-Umsetzung des Papiers.
3. **P3 — Kapital-Ineffizienz:** $100k Kapital für $25k Netto-Exposure + volles
   Liquidations-Penalty-Risiko auf das gesamte Collateral.
4. **P4 — Kein Short/Leverage/Perp-Pfad in Scalpatron:** `src/trader.ts` kann nur Spot-Swaps;
   es gibt keinen Perp-Adapter, kein Margin-/Health-Factor-Konzept, keinen State-Machine-Strategietyp.

---

## Optionen

### Option A — EVM-DeFi nah am Papier (verworfen)
USDY (Sekundär) → WBTC auf Morpho/Aave leihen → 50/50 via Uniswap; Custom Solidity-Executor
+ Off-Chain-Monitor.
- ✅ Am dichtesten am Original
- ❌ Neues, separates EVM-Projekt (Hardhat/Foundry), kaum Wiederverwendung von Scalpatron
- ❌ USDY-40-Tage-Lockup, Non-US, unsichere WBTC/USDY-Marktliquidität, eigener Smart-Contract-Audit nötig

### Option B — Solana-nativ RWA-Lending (verworfen für Phase 1)
USDY-Collateral → cbBTC auf **Kamino** leihen → 50 % cbBTC, 50 % via Jupiter in USDC.
- ✅ Bleibt im Solana/Jupiter-Stack
- ✅ Echtes Lending-Default-Narrativ
- ❌ cbBTC-Borrow-gegen-USDY-Markt mit Tiefe **nicht verifiziert**; USDY-Lockup/Non-US-Restriktion
- ❌ Realer Liquidations-Penalty auf gesamtes Collateral bleibt (P3)
- → Als **Phase-2-Option** offengehalten, falls echtes RWA-Narrativ gewünscht (siehe Offene Fragen)

### Option C — Perp-Replikation (gewählt) ⭐
Ökonomische Essenz (netto short BTC + Yield, gedeckeltes Risiko) **synthetisch** über
permissionlose Solana-Primitive:
- **Yield-Collateral** (USDC in Kamino-Lend bzw. optional USDY) ersetzt den „Treasury"-Teil.
- **BTC-Perp-Short** auf **Drift** (Solana) ersetzt die „BTC-Schuld" — sauber, mit
  programmierbarem Stop statt Liquidations-Penalty auf das gesamte Collateral.
- **„Strategic Default"** wird zum **harten Stop-Loss / Position-Reduce** — kontrollierbar,
  kein Front-Running-Risiko.
- ✅ Gleiches Payoff-Profil zu **geringeren Kosten** und höherer Kapitaleffizienz (P3 gelöst)
- ✅ Voll programmierbar + **paper-tradebar** → fügt sich in Scalpatrons Paper-First-Modell
- ✅ Integrierbar als neuer `strategy_type` neben `scalping`/`paet`
- ❌ Kein „echtes" RWA-Default-Narrativ (nur das Payoff, nicht die TradFi-Mechanik)
- ❌ Neuer externer Dependency (Drift) + Perp-/Margin-Konzept im Trader nötig (P4)

---

## Entscheidung: Option C

Neuer `strategy_type: 'cross-asset-hedge'` als **State-Machine-Strategie** (kein
Tick-Scalper). Phase 1 ausschließlich **Paper/Sim**; Live erst nach Backtest-Validierung
und separatem ADR für den Live-Perp-Pfad (Key-Handling analog ADR-002/008).

### A. Strategie-Typ & Config

`src/strategyTypes.ts:4-14` — Union erweitern:
```typescript
export type StrategyType =
  | 'scalping' | 'scalping-adaptive' | 'trend' | 'mean_reversion'
  | 'breakout' | 'momentum' | 'grid' | 'dca' | 'ml' | 'paet'
  | 'cross-asset-hedge';   // ADR-023
```

`StrategyConfig` (`src/strategyTypes.ts:77`) — neue Sub-Struktur (analog `paet_settings`):
```typescript
// Cross-Asset-Hedge config (strategy_type === 'cross-asset-hedge')
cross_asset_hedge?: {
  hedgeAsset: string;          // 'BTC' (Perp-Markt-Symbol auf Drift)
  yieldCollateralMint: string; // USDC- oder USDY-Mint
  targetNetShortUsd: number;   // gewünschte Netto-Short-Notional ($)
  perpVenue: 'drift' | 'paper';// Phase 1: 'paper'
  // Risiko-Ersatz für die "Default"-Mechanik:
  marginRatioFloor: number;    // analog Health-Factor; z.B. 1.5 → defensiv
  hardStopMarginRatio: number; // z.B. 1.1 → Notausstieg VOR Venue-Liquidation
  // Carry-Guard:
  maxNegCarryBpsPerDay: number;// schließt Position bei zu teurer Funding/Leihrate
  rebalanceBand: number;       // 0.10 = re-hedge wenn Netto-Exposure ±10 % driftet
};
```

### B. State Machine (der „verschachtelte Trade-Workflow")

Neues Modul `src/strategy/crossAssetHedge.ts` (Pure-Function-Kern, testbar):

```
[FLAT] --setup--> [ACTIVE]
   │   (Yield-Collateral deponiert, Perp-Short eröffnet = targetNetShortUsd)
   │
   ├── BTC fällt / marginRatio steigt ──► [HARVEST]
   │        Teilgewinn realisieren ODER Short ausbauen (innerhalb targetNetShortUsd-Band)
   │        → zurück zu [ACTIVE] oder [FLAT] (Take-Profit) ✅
   │
   ├── BTC steigt / marginRatio sinkt ──► [DEFENSE]
   │        ├─ marginRatio > marginRatioFloor : nachbesichern ODER Short reduzieren
   │        ├─ floor ≥ marginRatio > hardStop : Deleverage (Short verkleinern, Verlust begrenzen)
   │        └─ marginRatio ≤ hardStop          : NOTAUSSTIEG (= "Strategic Default"-Ersatz) ❌-cap
   │
   ├── |Netto-Exposure − target| > rebalanceBand ──► [REHEDGE] → [ACTIVE]
   │
   └── Carry < −maxNegCarryBpsPerDay (Funding zu teuer) ──► [WIND-DOWN] → [FLAT]
```

`evaluateHedge(state, marketSnapshot, config): HedgeAction` — reine Funktion, gibt
deterministisch die nächste Aktion (`OPEN_SHORT` | `REDUCE` | `ADD_COLLATERAL` |
`CLOSE` | `REHEDGE` | `HOLD`) + Begründung zurück. Kein I/O.

### C. Perp-/Margin-Adapter

Neues Modul `src/execution/perpAdapter.ts` mit Interface:
```typescript
interface PerpAdapter {
  openShort(symbol: string, notionalUsd: number): Promise<PerpFill>;
  reduce(symbol: string, notionalUsd: number): Promise<PerpFill>;
  closeAll(symbol: string): Promise<PerpFill>;
  getPosition(symbol: string): Promise<PerpPosition>; // size, entry, marginRatio, fundingPaid
}
```
- `PaperPerpAdapter` (Phase 1): simuliert Fills gegen den vorhandenen Preis-Feed,
  modelliert Funding + Fees + Margin-Ratio. **Keine externe Dependency.**
- `DriftPerpAdapter` (Phase 2, eigenes ADR): echte Drift-SDK-Anbindung.

Der bestehende `src/trader.ts` (Spot/Jupiter) bleibt **unangetastet**; der Hedge-Pfad
nutzt den Perp-Adapter, nicht `trader.buy/sell`.

### D. Integration in BotInstance

`src/botInstance.ts` — analog zum PAET-/Scalping-Branch: bei
`strategy_type === 'cross-asset-hedge'` läuft statt PatternDetector der
`crossAssetHedge`-Evaluator auf jedem Tick (bzw. reduziertem Intervall — State-Machine,
kein HF-Scan pro Tick nötig). Aktionen gehen an den `PerpAdapter` + ggf. einen
`YieldCollateralManager` (Phase 2: Kamino-Lend-Deposit).

### E. Persistenz

- Hedge-State (`FLAT`/`ACTIVE`/…), offene Perp-Position, kumuliertes Funding →
  neue Spalten/Tabelle in `src/db.ts` (analog Pending-Trade-Persistenz ADR-007,
  Crash-Recovery muss die offene Short-Position wiederfinden).
- `cross_asset_hedge`-Config reist in `strategyConfig` mit (wie `paet_settings`,
  persistiert via `PUT /api/bots/:id/strategy`).

### F. Risiko-Mapping (Konzept → Bot)

| Konzept-Papier | Bot-Äquivalent (Option C) |
|---|---|
| US-Treasuries Collateral | Yield-Collateral (USDC/USDY in Lend) |
| BTC-Schuld (short) | BTC-Perp-Short |
| 50 % BTC halten | reduzierte Short-Notional (Netto-Exposure-Steuerung) |
| 50 % Stablecoins | freie Margin/Cash-Reserve |
| Health Factor / LTV | `marginRatio` |
| Strategic Default | `hardStopMarginRatio`-Notausstieg |
| Zinsrisiko (BTC-Leihzins) | Funding-Rate-Guard (`maxNegCarryBpsPerDay`) |
| Liquidations-Penalty | entfällt (kontrollierter Stop statt Zwangsliquidation) |

---

## Konsequenzen

### Positiv
- ✅ Korrektes Mental-Model: User baut bewusst einen **gedeckelten BTC-Short + Carry**,
  kein illusorisches Win-Win (P1 gelöst).
- ✅ Kapitaleffizient, kein Penalty-Risiko auf Gesamt-Collateral (P3 gelöst).
- ✅ Paper-First, deterministischer Pure-Function-Kern → voll unit-testbar.
- ✅ Spot-Trader (`trader.ts`) bleibt unberührt; sauberer neuer Adapter-Layer.

### Negativ
- ⚠️ Neuer externer Dependency (Drift) für den Live-Pfad → eigenes ADR (P4 teilweise).
- ⚠️ Verliert das „echte" RWA/TradFi-Narrativ des Papiers (nur Payoff repliziert).
- ⚠️ Perp-Funding kann den Carry-Edge auffressen (gleiches Zinsrisiko wie im Papier §57).

### Trade-offs
- **Replikation vs. Authentizität:** Option C bildet das *Auszahlungsprofil* ab, nicht
  die TradFi-Mechanik. Wer das echte RWA-Lending will → Option B (Phase 2).
- **Netto-Short ist klein:** Bei target-Exposure muss der User bewusst die Größe wählen;
  Default bleibt konservativ (kleiner Short).

---

## Validierung

1. **Backtest-Modell** (`src/__tests__/crossAssetHedge.backtest.ts`): historische BTC-Pfade
   durch die State Machine; prüft Equity-Kurve gegen die analytische `125 − 25m`-Formel,
   Liquidations-/Stop-Trigger, Funding-Drag. **Muss zeigen:** Bull-Case = gedeckelter
   Verlust, Bear-Case = Gewinn (kein illusorischer Bull-Gewinn).
2. **Unit-Tests** (`src/__tests__/crossAssetHedge.test.ts`): `evaluateHedge` für alle
   State-Übergänge (FLAT→ACTIVE, ACTIVE→DEFENSE→Notausstieg, REHEDGE, Carry-Wind-Down),
   Edge-Cases (NaN-Preis, marginRatio-Boundaries).
3. **Paper-Run:** Bot mit `perpVenue: 'paper'` über ≥ 1 Woche; Equity + Funding-Log
   plausibilisieren; Crash-Recovery (Restart mit offener Short-Position).
4. `npx tsc --noEmit` → 0 Fehler.

---

## Beziehungen
- **Erweitert:** ADR-012 (Strategy-Forks) — neuer `strategy_type`, keine Breaking Changes.
- **Bezieht sich auf:** ADR-013 (Multi-Asset) — Hedge-Asset BTC via Perp statt SPL-Spot.
- **Folgt Pattern:** ADR-007 (Pending-Trade-Persistenz) — offene Perp-Position Crash-sicher.
- **Vorgeschlagene Folge-ADRs:**
  - **ADR-024 (geplant):** Live-Perp-Pfad (Drift-SDK, Key-Handling à la ADR-002/008, Slippage/Preflight à la ADR-009).
  - **ADR-025 (optional):** Phase-2 echtes RWA-Lending (Option B, Kamino + USDY) falls TradFi-Narrativ gewünscht.

---

## Offene Fragen
1. **Netto-Short-Größe als User-Slider oder fix?** Vorschlag: konservativer Default
   (z. B. 0,25x), User-Override via `targetNetShortUsd`.
2. **Yield-Collateral in Phase 1 simulieren oder real (Kamino-Lend) bereits anbinden?**
   Vorschlag: Phase 1 simuliert (USDC-Yield als Konstante), reale Lend-Anbindung mit Drift zusammen in ADR-024.
3. **Soll der OllamaAgent die Hedge-Parameter beeinflussen?** Vorschlag: zunächst **nein**
   — reine regelbasierte State Machine; AI-Lever erst nach validiertem Backtest (analog
   AI-Gate ADR-019).
4. **BTC-Preis-Feed:** DexScreener deckt BTC/Solana-Perp nicht ab — Phase 1 nutzt
   GeckoTerminal/Drift-Oracle als Quelle (neuer Feed-Adapter, siehe `src/geckoTerminalFeed.ts`).
