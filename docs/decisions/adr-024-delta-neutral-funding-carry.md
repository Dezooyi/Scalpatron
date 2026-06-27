# ADR-024: Delta-neutraler BTC Funding-Carry-Bot

**Datum:** 27. Juni 2026
**Status:** Verworfen (nach Phase-0-Validierung — siehe unten)
**Bereich:** Strategie / Architektur / Externe Abhängigkeiten / Risk / Geld
**Ersetzt:** ADR-023 (Synthetische Cross-Asset-Hedge / netto-short Perp-Replikation)
**Vorgänger:** ADR-012 (Strategy-Forks), ADR-013 (Multi-Asset), ADR-019 (Safety Bounds & AI-Gate)

> **🛑 VERWORFEN (27. Juni 2026, User-Entscheidung).** Die verpflichtende Phase-0-Validierung
> (echte 2-Jahres-Binance-Funding-Daten, siehe §Validierung) hat das Vorhaben als **MARGINAL**
> entlarvt: Das adaptive Funding-Gate (der angenommene Edge) **verliert** durch Fee-Churn;
> die einzige profitable Variante (always-on) **repliziert nur sUSDe (~9 %)** bei mehr
> Betriebs- und Ausführungsrisiko. **Beschluss: passiv sUSDe halten statt einen eigenen Bot
> bauen.** Die Validierungs-Tooling bleibt als Beweis erhalten
> (`src/strategy/fundingCarry.ts`, `src/backtest/fundingDataLoader.ts`,
> `src/__tests__/fundingCarry.{backtest,test}.ts`).

---

## Kontext

ADR-023 schlug vor, die User-Strategie aus `docs/Synthetische_Cross_Asset-Optionsstrat.md`
als **netto-short** BTC-Position (Perp-Replikation) umzusetzen. Vor der Implementierung
wurde — auf User-Wunsch — die **Profitabilität validiert**. Ergebnis:

### Validierungs-Ergebnis (führt zum Pivot)

Der netto-short-Bot aus ADR-023 hat **kein Alpha-Signal** und neutralen bis negativen
Erwartungswert. P&L-Zerlegung ($100k, Netto-Short $25k):

| Komponente | Erwartung p.a. | Charakter |
|---|---|---|
| Collateral-Yield (~4,5 %) | +~$4,3k | bekommt man **auch ohne** den Short |
| Funding (netto short) | +$0…$1,5k | variabel, BTC-Funding 27.06.2026 ≈ 0,01 % |
| Direktionales BTC-Risiko | 0…−$7,5k, **σ ≈ ±$12,5k** | BTC-Langfrist-Drift aufwärts → Short negativ-EV |
| Fees / Whipsaw-Stops | −$0,5…$1,5k | sicher negativ |

→ Yield + Funding bekommt man **ohne** das direktionale Risiko. Der Short addiert nur
Varianz, keinen Erwartungswert. Zusätzlich ist die „Options"-Rahmung nicht replizierbar:
ein Stop-Loss ist **short Gamma** (Gegenteil eines Long-Straddle), und die profitable
Upside des V-Payoffs ist durch Zwangsliquidation abgeschnitten (siehe ADR-023).

### Die profitable Nachbar-Strategie (recherchiert, Stand Juni 2026)

Dieselben Primitive (Perp + Collateral) ergeben **delta-neutral** einen bewährten,
bot-tauglichen Trade — den **Basis- / Funding-Carry-Trade** (Cash-and-Carry):

- **long Spot-BTC (cbBTC) + short BTC-Perp = Delta ≈ 0.** Kursrichtung egal.
- Gewinn = **Funding** (longs zahlen shorts „die meiste Zeit") + Collateral-Yield.
- Belegte Performance: Profis 2025 ~**19 % p.a. bei 0,8 % max Drawdown**; Studien/Guides
  8–20 % APY; **Drift (Solana) settled Funding stündlich**.
- **Aber regime-abhängig:** Bei Funding ≈ 0 (aktueller Stand) verdient der Trade nach
  Fees fast nichts. Der **Edge ist das adaptive Gate**: nur deployen, wenn annualisiertes
  Funding die Roundtrip-Kosten + Puffer deckt; bei negativem Funding aussteigen.

**User-Entscheidung (27.06.2026):** Pivot zum delta-neutralen Funding-Carry-Bot,
**Backtest-First** (Profitabilität gegen historisches Funding beweisen, bevor gebaut wird).

---

## Problem

1. **P1 — Edge ist das Funding-Gate, nicht „immer an":** Ein statisch laufender
   Carry-Bot verliert in Niedrig-/Negativ-Funding-Phasen Geld (Fees + negatives Funding).
   Ohne adaptives Entry/Exit-Gate kein positiver Erwartungswert.
2. **P2 — Zwei-Bein-Ausführungsrisiko:** Spot-Long (Jupiter) und Perp-Short (Drift) müssen
   delta-neutral *bleiben*. Driftet ein Bein (Slippage, Teilfill, Preis-Move zwischen den
   Legs), entsteht ungewollte direktionale Exposure.
3. **P3 — Perp-/Margin-Pfad fehlt in Scalpatron:** `src/trader.ts` kann nur Spot;
   kein Perp-Adapter, kein Margin-/Funding-Konzept (wie ADR-023 §P4).
4. **P4 — BTC-Funding-/Preis-Feed fehlt:** DexScreener (`src/priceFeed`) liefert kein
   BTC-Perp-Funding; es braucht eine Funding-Quelle (Drift-Oracle) + BTC-Spot-Feed.

---

## Optionen

### Option 1 — netto-short (ADR-023, verworfen)
Negativ-EV, kein Signal. Begründung siehe oben + ADR-023.

### Option 2 — Delta-neutraler Funding-Carry, **statisch immer an** (verworfen)
Long cbBTC + short Perp, dauerhaft.
- ✅ Simpel
- ❌ Verliert in Funding≈0/negativ-Phasen (genau jetzt) → P1 ungelöst

### Option 3 — Delta-neutraler Funding-Carry, **adaptiv nach Funding-Gate** (gewählt) ⭐
Wie 2, aber Position nur offen, wenn `annualisiertes Funding > Entry-Schwelle`;
Wind-Down bei Unterschreiten/Vorzeichenwechsel. Delta-Rebalancing-Band gegen Bein-Drift.
- ✅ Adressiert den eigentlichen Edge (P1)
- ✅ Delta-neutral → kein BTC-Richtungsrisiko (Kern-Vorteil ggü. ADR-023)
- ✅ Spot-Bein nutzt bestehenden `src/trader.ts`; nur Perp-Adapter ist neu
- ✅ Backtest-First validierbar, Paper-First lauffähig
- ❌ Zwei-Bein-Komplexität (P2), neue Drift-Dependency (P3), neuer Feed (P4)

### Option 4 — Fertige delta-neutrale Yield-Produkte nutzen statt selbst bauen (offengehalten)
z. B. sUSDe (Ethena) o. ä. kapseln Funding-Carry bereits.
- ✅ Kein Bau, kein Ausführungsrisiko
- ❌ Kein „Bot", keine Kontrolle/Customizing, Smart-Contract-/Depeg-Risiko des Produkts
- → Als Benchmark im Backtest mitführen („schlägt mein Bot einfach sUSDe halten?")

---

## Entscheidung: Option 3 — mit verpflichtender Backtest-Phase 0

### Phase 0 (GATE, vor jeder Architektur-Implementierung)

Eigenständiges Analyse-Skript `src/__tests__/fundingCarry.backtest.ts`:
- Historische BTC-Perp-**Funding-Reihen** (Drift + CEX-Referenz) über ≥ 12–24 Monate.
- Simuliert das adaptive Gate (Entry/Exit), zieht **Fees, Slippage, Funding-Drag,
  Rebalance-Kosten** ab.
- **Akzeptanzkriterium:** Netto-Carry nach Kosten muss eine risk-free-Benchmark
  (USDC-Yield) **und** „einfach sUSDe halten" (Option 4) **deutlich** schlagen — sonst
  wird der Bot **nicht gebaut** und diese ADR auf `Verworfen` gesetzt.

> Erst wenn Phase 0 grün ist, folgen Phase 1 (Paper) und — per separater ADR-025 —
> Phase 2 (Live). Diese ADR beschreibt die Architektur, *konditioniert* auf Phase-0-Erfolg.

### A. Strategie-Typ & Config

`src/strategyTypes.ts:4-14` — Union erweitern (statt des in ADR-023 geplanten
`cross-asset-hedge`):
```typescript
export type StrategyType =
  | 'scalping' | 'scalping-adaptive' | 'trend' | 'mean_reversion'
  | 'breakout' | 'momentum' | 'grid' | 'dca' | 'ml' | 'paet'
  | 'funding-carry';   // ADR-024
```

`StrategyConfig` (`src/strategyTypes.ts:77`) — neue Sub-Struktur:
```typescript
// Funding-Carry config (strategy_type === 'funding-carry')
funding_carry?: {
  spotMint: string;          // cbBTC-Mint (Long-Bein via Jupiter)
  perpSymbol: string;        // 'BTC-PERP' (Short-Bein)
  perpVenue: 'paper' | 'drift';
  notionalUsd: number;       // Größe je Bein (delta-neutral → beide gleich)
  maxNotionalUsd: number;    // Hard-Cap
  // Adaptives Gate (der Edge):
  fundingEntryBps: number;   // annualisierte Funding-Schwelle zum Öffnen (z.B. 800 = 8 %)
  fundingExitBps: number;    // darunter → Wind-Down (Hysterese, < entry)
  negFundingMaxIntervals: number; // Vorzeichenwechsel-Toleranz vor Notausstieg
  // Delta-Neutralität:
  deltaRebalanceBand: number;     // 0.03 = re-hedge wenn |Spot−Perp| > 3 %
  // Perp-Sicherheit:
  perpMarginBuffer: number;       // Ziel-Margin-Ratio (z.B. 3.0 → konservativ)
};
```

### B. State Machine (`src/strategy/fundingCarry.ts`, Pure-Function-Kern)

```
[FLAT]
   │  Funding_annualized > fundingEntryBps  ──► [ENTERING]
   │     (long cbBTC notionalUsd  +  short Perp notionalUsd, möglichst zeitgleich)
   ▼
[CARRY]  (delta-neutral, kassiert Funding stündlich)
   │
   ├── |Δspot − Δperp| > deltaRebalanceBand  ──► [REHEDGE] → [CARRY]
   ├── Margin-Ratio < perpMarginBuffer        ──► [ADD_MARGIN] / Notional reduzieren
   ├── Funding < fundingExitBps               ──► [WIND-DOWN] (beide Beine schließen) → [FLAT]
   └── Funding < 0 für > negFundingMaxIntervals ──► [WIND-DOWN] → [FLAT]
```

`evaluateFundingCarry(state, snapshot, config): CarryAction` — rein, kein I/O. Actions:
`OPEN_BOTH | REHEDGE_SPOT | REHEDGE_PERP | ADD_MARGIN | CLOSE_BOTH | HOLD`.

### C. Ausführung — zwei Beine

- **Long-Bein (Spot):** bestehender `src/trader.ts` (Jupiter) — cbBTC kaufen/verkaufen.
- **Short-Bein (Perp):** neues Modul `src/execution/perpAdapter.ts`
  (`PaperPerpAdapter` für Phase 1; `DriftPerpAdapter` für Phase 2/ADR-025).
- **P2-Mitigation:** Beine werden so nah wie möglich zeitgleich ausgeführt; nach jedem
  Open/Close prüft die State Machine die realisierte Netto-Delta und triggert sofort
  `REHEDGE`, falls ein Bein abweicht. Idempotente, crash-sichere Persistenz beider Beine.

### D. Feed (P4)

Neuer `src/fundingFeed.ts` (gecachter Singleton, analog `src/geckoTerminalFeed.ts`):
liefert BTC-Spot-Preis + aktuelles/annualisiertes Perp-Funding. Phase 1: aus Drift-Oracle
bzw. CEX-API (read-only, kein Key).

### E. Persistenz

`src/db.ts` — neue Tabelle/Spalten für: offene Spot- + Perp-Position, kumuliertes
Funding (received/paid), aktueller State. Crash-Recovery (ADR-007-Pattern) **muss beide
Beine** wiederfinden, sonst entsteht beim Restart eine ungehedgte Position.

### F. Risiko-Mapping & Restrisiken

| Risiko | Mitigation |
|---|---|
| Funding kippt negativ | adaptives Exit-Gate + Vorzeichen-Toleranz |
| Basis-/Bein-Drift (P2) | `deltaRebalanceBand`, Sofort-Rehedge nach Fills |
| Perp-Liquidation | `perpMarginBuffer` (konservative Margin-Ratio), Notional-Cap |
| Venue/Oracle-Ausfall (Drift) | Stale-Guard analog ADR-010; bei Stale → kein neuer Entry, ggf. Wind-Down |
| cbBTC-Depeg / Spot-Liquidität | Slippage-Limit (ADR-009-Pattern), `maxNotionalUsd` |
| „Bot schlägt sUSDe nicht" | Phase-0-Benchmark als Akzeptanzkriterium |

---

## Konsequenzen

### Positiv
- ✅ **Positiver Erwartungswert ist überhaupt möglich** (delta-neutral + Funding-Edge),
  anders als ADR-023.
- ✅ Kein BTC-Richtungsrisiko → niedrige Drawdowns (belegt).
- ✅ Spot-Bein nutzt `trader.ts` → hohe Wiederverwendung; nur Perp-Adapter neu.
- ✅ Backtest-First → kein Code-Bau auf unbewiesener Annahme.

### Negativ
- ⚠️ Zwei-Bein-Ausführung ist operativ anspruchsvoll (P2) — Hauptquelle für Bugs/Verluste.
- ⚠️ Neue Drift-Dependency für Live (ADR-025).
- ⚠️ **Regime-Risiko:** In anhaltenden Funding≈0-Phasen (aktuell!) steht der Bot meist
  in `[FLAT]` und verdient nur den Collateral-Yield — der „Bot" ist dann oft inaktiv.

### Trade-offs
- **Selbst bauen vs. sUSDe halten (Option 4):** Wenn der Backtest zeigt, dass der
  Eigenbau das fertige Produkt nicht schlägt, ist „sUSDe halten" die rationale Wahl.
  Diese ADR akzeptiert dieses Ergebnis explizit als möglichen Ausgang.

---

## Validierung

### Phase-0-Ergebnis (empirisch, 27. Juni 2026) ⚠️

Implementiert: `src/strategy/fundingCarry.ts` (Pure-Core), `src/backtest/fundingDataLoader.ts`
(echte Binance-Funding-/Preis-Historie), `src/__tests__/fundingCarry.backtest.ts` (Gate),
`src/__tests__/fundingCarry.test.ts` (18 Unit-Tests, grün),
`src/scripts/createCarryWallet.ts` (dedizierte Wallet).

**Lauf über ~2 Jahre echte BTCUSDT-Funding-Daten (2160× 8h-Intervalle):**
- Ø Funding **482 bps annualisiert**, 80 % der Intervalle positiv.
- **Adaptives Gate (der vermeintliche Edge, P1): −2,77 % Alpha** — churnt 32× rein/raus,
  $3.206 Fees fressen den Carry. Bei *jeder* getesteten Schwelle (entry 100–800 bps)
  **verliert** das Gate (−2,8 % bis −7,3 %), weil Funding über die Schwelle oszilliert
  und Re-Entry-Fees dominieren.
- **Naive „immer delta-neutral" (1× Entry/Exit): +4,62 % Alpha → ~9,1 % Gesamt-APY.**
- **Benchmark sUSDe ~9 %.** → Der beste Eigenbau ≈ sUSDe, schlägt es **nicht** um die
  geforderte Marge.

**Befund:** Die zentrale These dieser ADR (das adaptive Funding-Gate sei der Edge) ist
**empirisch widerlegt** — Gating zerstört Wert durch Fee-Churn. Die einzige profitable
Variante (always-on, Exit nur bei anhaltend negativem Funding) **repliziert lediglich
sUSDe** bei zusätzlichem Betriebs-/Ausführungs-/Liquidationsrisiko. **Verdikt: MARGINAL —
Bau eines eigenen Bots lohnt sich gegenüber „sUSDe halten" nicht.** Reproduzierbar via
`npx tsx src/__tests__/fundingCarry.backtest.ts --refresh`.

> **Entscheidungsbedarf (User):** Angesichts dieses Ergebnisses → (a) sUSDe/passiv halten
> statt bauen, (b) Bot dennoch als always-on bauen (bewusst ≈ sUSDe, mehr Kontrolle),
> oder (c) Vorhaben verwerfen. Bis zur Klärung bleibt diese ADR `Vorgeschlagen`.

### Geplante weitere Validierung (nur falls trotzdem gebaut wird)

1. **Phase 0 (Gate):** `fundingCarry.backtest.ts` über ≥ 12–24 Monate Funding-Historie;
   Netto nach Kosten > USDC-Yield **und** > sUSDe-Benchmark. **Nur bei Erfolg geht es weiter.**
2. **Unit-Tests** `src/__tests__/fundingCarry.test.ts`: `evaluateFundingCarry` für alle
   Übergänge (Gate-Entry, Hysterese-Exit, Rehedge bei Delta-Drift, Margin-Defense,
   Negativ-Funding-Notausstieg), Edge-Cases (NaN-Funding, Feed-Stale).
3. **Paper-Run (Phase 1):** `perpVenue: 'paper'` ≥ 2 Wochen; Delta bleibt ~0 nachweisbar;
   Funding-Accrual-Log plausibel; Crash-Recovery mit beiden offenen Beinen.
4. `npx tsc --noEmit` → 0 Fehler.

---

## Beziehungen
- **Ersetzt:** ADR-023 (netto-short Variante; deren Ökonomie-Teardown + RWA-Recherche bleiben gültig).
- **Erweitert:** ADR-012 (Strategy-Forks) — neuer `strategy_type`, keine Breaking Changes.
- **Folgt Pattern:** ADR-007 (Pending-Trade-Persistenz, Crash-Recovery), ADR-009
  (Preflight/Slippage), ADR-010 (Stale-Feed-Guard).
- **Vorgeschlagene Folge:** **ADR-025 (geplant)** — Live-Pfad mit `DriftPerpAdapter`,
  Key-Handling (ADR-002/008), Live-Slippage/Preflight (ADR-009). Nur nach grüner Phase 0+1.

---

## Offene Fragen
1. **Funding-Datenquelle für den Backtest:** Drift-eigene Historie ausreichend tief, oder
   CEX-Funding (Binance/Bybit) als Proxy für die Phase-0-Reihe nutzen? → im Backtest beides
   gegenüberstellen.
2. **Spot-Bein-Asset:** cbBTC (Solana) vs. Halten von SOL-denominiert? → cbBTC, weil der
   Perp BTC ist (sonst Cross-Asset-Basisrisiko BTC/SOL).
3. **Soll der OllamaAgent das Funding-Gate tunen?** → Nein in Phase 1; reine Regel.
   AI-Lever erst nach Backtest (AI-Gate-Pattern ADR-019).
4. **Mindestgröße/Wirtschaftlichkeit:** Bei kleinem `notionalUsd` fressen Fixkosten
   (Gas, Mindest-Fees) den Carry. Phase 0 muss eine **Mindest-Notional** ermitteln,
   unter der sich der Bot nicht lohnt.
