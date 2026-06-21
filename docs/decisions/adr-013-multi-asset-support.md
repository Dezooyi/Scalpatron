# ADR-013: Multi-Asset Support via Token-Presets & Per-Bot-Mint-Konfiguration

**Datum:** 21. Juni 2026
**Status:** Vorgeschlagen (nach Code-Validierung überarbeitet)
**Bereich:** Architektur / Provider / Strategie

---

## Kontext (nach Code-Validierung)

Beim Re-Reading der Codebasis zeigt sich, dass **viel mehr Multi-Asset-Infrastruktur bereits existiert** als ursprünglich angenommen:

- `src/config.ts:19-20` definiert bereits **separate Mints**:
  ```ts
  UGOR_MINT: process.env.UGOR_MINT ?? 'UGoRwdj9SK78V6Pq9YMz9BvmNuJTLNqPZyS5WnGd8uW',
  SOL_MINT:  process.env.SOL_MINT  ?? 'So11111111111111111111111111111111111111112',
  ```
- `PriceFeed` (`src/priceFeed.ts:103-202`) ist **bereits multi-mint-fähig** via `subscribe(mintAddress)` und einem **Stagger-Scheduler**, der unabhängig von der Anzahl der Mints **exakt 55 req/min** hält (Slot-Logik Z.39-40, Stagger Z.179-215).
- `BotInstance` (`src/botInstance.ts:21-637`) hat bereits ein `mintAddress`-Feld pro Instanz; subscribe/unsubscribe, history, recorder, DB-Anbindung sind alle **per-Mint isoliert**.
- `PriceRecorder.record(point, mintAddress?)` (`src/priceRecorder.ts:36`) schreibt **bereits in die DB pro Mint** über `saveLiveFeedEntry()`; **nur die Legacy-JSONL-Datei `prices.jsonl` ist global** (Z.9, 38).
- `trader.ts:76` nutzt `targetMint = opts.targetMint ?? CONFIG.UGOR_MINT` — also bereits pro-Instanz konfigurierbar.
- `macroFeed.ts:14-15` pollt bereits **BTC & SOL von Binance** für den AI-Agent-Kontext (kostenlos, public).

**Was heute bereits funktioniert (zero-cost, latent vorhanden):**

1. Zwei Bot-Instanzen mit unterschiedlichen Mints parallel starten → PriceFeed routet korrekt, Bot-Logik ist mint-agnostisch.
2. DexScreener liefert Preise für SOL/USDC, WBTC/USDC, WETH/USDC als normaler SPL-Token (siehe TokenService.ts).
3. AI-Agent (`src/ollamaAgent.ts:690-777`) analysiert **pro Bot** über `botId`/`state.mintAddress`; jede Mint hat eigene Regime-Performance, eigene Trade-History.

**Was heute nicht funktioniert (echte Lücken):**

1. **WBTC/WETH-Mints fehlen in `CONFIG`** — sind nicht vorbereitet wie `SOL_MINT`.
2. **`PRICE_FEED_PROVIDER='jupiter'` ist DEPRECATED** (`config.ts:7`) — der Endpoint ist seit Februar 2026 abgeschaltet. Für Majors bleibt nur DexScreener (kostenlos, aber mit Pool-Volumen-Heuristik statt Mid-Price).
3. **`priceRecorder.loadAll()` / `loadRange()`** mischen alle Mints in der globalen `prices.jsonl` — bei Multi-Asset kaputt.
4. **`priceRecorder.importHistorical()`** ist hartcodiert auf `GECKO_POOL` (UGOR-Meteora-Pool, Z.18).
5. **Strategie-Templates** sind auf UGOR kalibriert (1 % spikeThreshold); SOL/WBTC brauchen eigene Schwellen.
6. **Frontend** hat keinen Token-Picker; nur manuelles Setzen der Mint in der Bot-Config.
7. **`strategy.ts:6` und `strategyTypes.ts:27`** haben `symbol` als „UGOR/SOL" hartcodiert in Templates.

**Externe Realität (Validierung 21.06.2026):**

- WBTC-SPL auf Solana: `3NZ9JMVBmGAqocybic2cEjLtuT8wxvF9KWahi982CUBE` (Mercurial/Wormhole, dünnes Volumen ~$50k/Tag).
- WETH-SPL auf Solana: `7vfCXYUXe1pb7avtM5Y7q2Lz1nZ54B3KhfEudR5M1CTG` (Wormhole, Volumen stark schwankend).
- Wrapped SOL: nativ als `So111...11112`, hohes Volumen auf Raydium/Orca.
- Jupiter Price API v6 wurde abgeschaltet — Empfehlung „Jupiter für Majors" aus dem Erstentwurf ist **nicht mehr haltbar**.

## Problem

Die Multi-Asset-Fähigkeit ist **größtenteils latent vorhanden**, aber:

1. **Konfiguration ist fragmentiert** — Mints sind in `CONFIG.UGOR_MINT`/`CONFIG.SOL_MINT` verteilt, neue Tokens erfordern Code-Änderung in `config.ts`.
2. **Globale `prices.jsonl`** verhindert, dass mehrere Mints dieselbe Recorder-Instanz nutzen.
3. **Historischer Gecko-Import** ist nur für UGOR-Pool implementiert.
4. **PatternDetector-Templates** sind nicht token-klassenspezifisch — 1 %-Spike passt nicht auf SOL/WBTC.
5. **Frontend** zeigt keinen Multi-Token-Workflow.
6. **Keine Preset-UX** — User müssen Mint-Adressen manuell recherchieren.

## Ziele

- **G1:** SOL, WBTC, WETH als neue Trade-Objekte ohne Code-Änderung pro Token ermöglichen.
- **G2:** Bestehende Architektur (Multi-Instance `BotManager`) wiederverwenden.
- **G3:** Pro-Mint-Isolation in Price-Recording und DB sicherstellen.
- **G4:** Provider-Eignung pro Token klar machen (DexScreener vs. Jupiter).
- **G5:** Null laufende API-Kosten (alle Public APIs).

## Nicht-Ziele (Out of Scope)

- **Cross-Chain-Bridges** (Wormhole, deBridge): zu langsam (Minuten Latenz) für 2-Sekunden-Scalping, nicht kostenlos sinnvoll.
- **Live-Trading auf SOL/BTC/ETH**: Risiko zu hoch, PatternDetector-Logik nicht geeignet für Majors. Erst Paper-Modus validieren.
- **Spot-Order-Book-Daten** (CLOB, OpenBook): DexScreener-Pool-Daten reichen für Pattern-Erkennung.
- **Perp/Futures**: Erfordert andere Margin-Mechanik, separater ADR.

## Optionen

### Option 1: Mint-Liste in Config, Pro-Mint-Bot-Instanz (gewählt)

`CONFIG.TOKEN_MINTS: string[]` (Default `['<UGOR-MINT>']`). Jeder Eintrag wird beim `BotManager`-Start als eigene Bot-Instanz mit eindeutiger `botId` (z.B. `sol-bot`, `wbtc-bot`) angelegt. PriceFeed pollt alle Mints sequentiell im 1.09s-Slot (`src/priceFeed.ts:40`), isoliert per `backoffUntil`-Map.

- ✅ **Kostenlos:** keine neue API, Jupiter/DexScreener sind frei.
- ✅ **Architektur-konform:** `BotManager` ist bereits multi-instance; wir nutzen nur die schon vorhandene Schleife.
- ✅ **Pro-Mint-Isolation:** `priceRecorder.ts` schreibt `${mint}.jsonl` statt eine globale Datei.
- ✅ **Keine Breaking Changes:** `CONFIG.TOKEN_MINT` (Singular) bleibt als Default für `TOKEN_MINTS[0]` bestehen.
- ✅ **Erweiterbar:** weitere Mints hinzufügen = Config-Eintrag, kein Code.
- ❌ DexScreener-Rate-Limit (55 req/min) limitiert auf ~50 parallele Mints — ausreichend.
- ❌ PatternDetector-Parameter müssen pro Token konfigurierbar werden (siehe G4-Impl.).

### Option 2: Dynamische Mint-Registrierung zur Laufzeit (verworfen)

Bots werden über WebSocket/SSE mit neuen Mints versorgt, ohne Neustart.

- ❌ Erfordert Persistenz der laufenden Detector-State pro Mint — komplex, fehleranfällig.
- ❌ Race Conditions bei Hot-Reload von PatternDetector-Settings.
- ❌ YAGNI — wir brauchen nicht mehr als ~5 Mints gleichzeitig.

### Option 3: Komplett neuer Multi-Provider-Service (verworfen)

Eigener `multiAssetFeed.ts` mit Load-Balancing über Raydium/Jupiter/DexScreener-Endpoints pro Token.

- ❌ Over-Engineering für den Use-Case.
- ❌ Kostenlos nur, wenn wir die Public-APIs nicht überlasten.
- ❌ Neue Fehlerklasse (Provider-Auswahl pro Token), neuer ADR nötig.

## Entscheidung

Wir führen **Option 1** um — minimale Erweiterung der bestehenden Multi-Instance-Architektur.

Konkret:

1. **Neue Datei `src/tokenPresets.ts`** — Mapping `name → { mint, decimals, symbol, kind }` für `UGOR`, `SOL`, `WBTC`, `WETH`. Single Source of Truth.
2. **Erweiterung `src/config.ts`** — `WBTС_MINT` und `WETH_MINT` ergänzen, sowie Liste `TOKEN_PRESETS` (Defaults: alle vier).
3. **`src/priceRecorder.ts` Refactor** — `loadAll(mint?)`, `loadRange(mint?, from, to)`, `record(point, mint)`; pro Mint eigene Datei `data/prices-${mintShort}.jsonl`. Migration-Skript für Legacy-File.
4. **`src/priceRecorder.ts` `importHistorical(mint?)`** — Gecko-Pool pro Mint (SOL/USDC, WBTC/USDC haben keine eigenen Pools; nur SOL/USDC via Raydium verfügbar; WBTC/WETH fallen zurück auf `loadFromDatabase()` ohne Gecko-History).
5. **Neue Templates** in `src/strategyTemplates/`:
   - `scalping-major.json` — `spikeThreshold: 2.5`, `floorWindow: 45`, `sellDropThreshold: 1.5` (SOL/WBTC/WETH).
   - `scalping-meme.json` — Refactor aus bestehender `scalping.json` (UGOR-Defaults bleiben).
6. **`src/botManager.ts`** — Optional Auto-Spawn pro Token-Preset via `BOT_AUTO_SPAWN_PRESETS` (Default leer, aus = Single-Bot-Setup bleibt unverändert).
7. **Frontend** — Dropdown im `CreateBotDialog` mit Token-Presets (Symbol + Mint gekürzt); Multi-Chart optional Phase 3.
8. **Provider** bleibt DexScreener (Jupiter ist deprecated). DexScreener ist für Majors ausreichend — SOL/USDC hat dort mehrere Pools (Raydium, Orca), WBTC/WETH nur Wormhole-Pool mit dünnem Volumen (Risiko siehe Konsequenzen).

### Begründung

- **Wiederverwendung statt Neuaufbau:** `BotManager` ist bereits multi-instance — wir nutzen die bereits vorhandene Schleife, statt eine neue Orchestrierung zu schreiben.
- **Provider-Trennung:** Jupiter Price API ist für Majors genauer und konsistenter (ADR-001 erlaubt bereits den Wechsel); DexScreener bleibt Default für Meme-Coins.
- **Kein Cross-Chain:** SOL/WBTC/WETH als gewrappte SPL-Token sind nativ auf Solana handelbar — keine Bridge, keine zusätzlichen Kosten, keine zusätzliche Latenz.
- **YAGNI:** Multi-Instance-Architektur ist da; wir aktivieren sie nur.

## Konsequenzen

### Positiv

- ✅ SOL/BTC/ETH-Trading **kostenlos** und ohne Code-Änderung pro Token möglich.
- ✅ Multi-Asset-Dashboard out-of-the-box (jeder Bot = ein Token).
- ✅ PatternDetector-Parameter pro Token konfigurierbar (verhindert Overtrading auf Majors).
- ✅ Pro-Mint-Isolation in `prices-*.jsonl` und DB — keine Cross-Contamination.
- ✅ Backwards-compatible: bestehende Single-Token-Setups funktionieren unverändert.

### Negativ / Risiken

- ⚠️ **WBTC/WETH-Liquidität auf Solana ist gering** (Wormhole-Pool, ~$50k/Tag Volumen) — Scalping-Spreads können Slippage verursachen. SOL/USDC auf Raydium ist deutlich liquider und sicherer.
- ⚠️ **DexScreener wählt bei mehreren Pools den volumenstärksten** — kann bei Majors gelegentlich einen illiquiden Pool erwischen, wenn der Hauptpool kurzfristig leerer ist. Akzeptabel für Paper, problematisch für Live.
- ⚠️ **Provider-Deprecation:** Jupiter Price API v6 ist seit 2026 abgeschaltet. DexScreener ist einziger kostenloser Provider ohne API-Key — Single Point of Failure.
- ⚠️ **PatternDetector-Tuning pro Token-Klasse nötig:** 1 % Spike ist auf SOL normal, auf UGOR ein Event. Pro Token separate `scalping-*.json`-Templates, sonst zu viele Fehlsignale.
- ⚠️ **DexScreener-Rate-Limit:** 55 req/min geteilt durch N Mints → bei N=4 nur alle 4.4 s ein Update pro Mint. Für 2s-Tickrate zu langsam — `CONFIG.PRICE_FEED_TICKRATE_MS` muss auf 4000-5000 ms angehoben werden.
- ⚠️ **DB-Schema-Migration:** bestehende `trades`/`live_feed` brauchen `mint_address`-Spalte oder Konsistenz-Check via `botId` (bereits vorhanden).
- ⚠️ **Frontend-Komplexität:** Asset-Auswahl ist klein (Phase 1 OK), Multi-Chart ist Phase 3.
- ⚠️ **Gecko-Historical-Import** funktioniert nur für Mints mit Gecko-Pool (UGOR via Meteora, SOL via Raydium). WBTC/WETH haben keine Gecko-Coverage → Backtesting dort eingeschränkt.

### Trade-offs

- **Komplexität vs. Flexibilität:** Mehr Tokens = mehr Config + Templates + DB-Indizes, aber ohne neuen Code-Pfad.
- **Liquidity vs. Volatility:** Majors haben hohe Liquidität, aber für Range-Spike-Scalper zu „glatt" — Risiko zu wenigen Signalen.

## Validierung

1. **Unit-Test:** `src/__tests__/tokenPresets.test.ts` prüft Base58-Validation aller vier Mints und korrekte Auflösung `preset → mintAddress`.
2. **Unit-Test:** `src/__tests__/priceRecorderMultiMint.test.ts` prüft `record(point, mint)` → korrekte Datei, `loadAll(mint)` → nur diese Datei, Backwards-Compat ohne Mint → Legacy-File mit Warnung.
3. **Migration-Smoke:** `npx tsx src/migrate-prices-jsonl.ts` läuft idempotent, produziert `data/prices-<UGOR>.jsonl`, löscht Legacy-File (mit `--dry-run`).
4. **BotManager-Test:** Manueller Start mit zwei Bots (`UGOR`, `SOL`) → beide erhalten Ticks, kein Cross-Talk im History-Map.
5. **Paper-Vergleich (24 h):** UGOR-Bot vs. SOL-Bot parallel — SOL-Bot sollte < 20 % der Trade-Frequenz auslösen (Validierung der Major-Threshold).
6. **DB-Check:** `SELECT botId, COUNT(*) FROM live_feed GROUP BY botId` — pro Bot eigene Reihe, keine Cross-Contamination.
7. **Frontend-Smoke:** Token-Dropdown im `CreateBotDialog` → vier Presets wählbar, manuelle Mint-Eingabe weiterhin möglich.

## Implementierungs-Notizen

### Betroffene Dateien

- `src/tokenPresets.ts` (neu, ~30 Zeilen) — `PRESETS: Record<PresetName, TokenPreset>`, Validation der Mint-Adresse (Base58 32-44 Zeichen, siehe `tokenService.ts:79`).
- `src/config.ts` — `WBTC_MINT`, `WETH_MINT` ergänzen, `DEFAULT_PRESETS: PresetName[]` hinzufügen.
- `src/priceRecorder.ts` — `loadAll(mint?)`, `loadRange(mint?, from, to)`; Pro-Mint-Datei; Migration-Script `migrate-prices-jsonl.ts` (einmalig).
- `src/botManager.ts` — Optional `BOT_AUTO_SPAWN_PRESETS` Env-Var (CSV), default leer.
- `src/strategyTemplates/scalping-major.json` (neu) — siehe Parameter-Tabelle.
- `src/strategyTemplates/scalping-meme.json` (neu, Inhalt aus bestehender `scalping.json` kopiert) — Refactor für Klarheit.
- `src/strategyTypes.ts` — `symbol` aus Template-JSON lesen statt hartcodiert.
- `src/strategy.ts` — `mintAddress` aus TokenPreset ableiten statt manuelles Eintippen.
- `src/db.ts` — kein Schema-Change nötig (Filterung läuft über `botId`, der mit Mint verknüpft ist).
- `frontend/src/components/CreateBotDialog.tsx` — Token-Preset-Dropdown statt freier Mint-Eingabe.
- `frontend/src/lib/botUtils.tsx` — Token-Icon pro Preset (`Coins` für SOL, `Bitcoin` für WBTC, `Ethereum`-ähnlich für WETH — Lucide hat keine Native-Icons, daher Initial-Badge).

### Migration / Breaking Changes

- **Kein Breaking Change:** bestehende `UGOR_MINT`/`SOL_MINT`-Logik bleibt erhalten; `TOKEN_PRESETS` ist additiv.
- **Legacy-JSONL:** einmaliges Migrations-Script verschiebt `data/prices.jsonl` → `data/prices-${UGOR_MINT_SHORT}.jsonl`.
- **Backwards-Kompatibilität:** `PriceRecorder.loadAll()` ohne Mint-Argument gibt Legacy-Datei zurück (deprecated, mit Warn-Log).
- **DB:** kein Schema-Change; bestehende `botId`-Filter sind ausreichend.

### Token-Presets (validiert 21.06.2026)

| Preset | Mint                                              | Symbol  | Decimals | Liquidität   | Provider        |
|--------|---------------------------------------------------|---------|---------:|--------------|-----------------|
| UGOR   | `UGoRwdj9SK78V6Pq9YMz9BvmNuJTLNqPZyS5WnGd8uW`    | UGOR    | 9        | Mittel       | dex_screener    |
| SOL    | `So11111111111111111111111111111111111111112`    | wSOL    | 9        | Hoch (Rayd.) | dex_screener    |
| WBTC   | `3NZ9JMVBmGAqocybic2cEjLtuT8wxvF9KWahi982CUBE`   | wBTC    | 8        | Gering       | dex_screener    |
| WETH   | `7vfCXYUXe1pb7avtM5Y7q2Lz1nZ54B3KhfEudR5M1CTG`   | wETH    | 8        | Gering       | dex_screener    |

(Jupiter-Provider entfernt — Endpoint seit Feb 2026 abgeschaltet, siehe `config.ts:7`.)

### Vorgeschlagene PatternDetector-Parameter pro Asset-Klasse

| Asset-Klasse | spikeThreshold | floorWindow | sellDrop | takeProfit | cooldownTicks |
|--------------|---------------:|------------:|---------:|-----------:|--------------:|
| meme (UGOR)  |           1.0 |          20 |      5.0 |       2.5  | 5             |
| major (SOL)  |           3.0 |          30 |      2.0 |       1.2  | 8             |
| major (WBTC) |           2.0 |          60 |      1.0 |       1.05 | 12            |
| major (WETH) |           2.5 |          45 |      1.5 |       1.08 | 10            |

(Begründung: Majors bewegen sich in größeren, glatteren Wellen → höhere Spike-Schwelle, längerer Lookback, kleinerer Take-Profit, längere Cooldown gegen Noise-Trades.)

### Tickrate-Anpassung

Aktuell `PRICE_FEED_TICKRATE_MS=2000` (alle 2 s). Bei 4 Mints im Stagger-Scheduler (Slot 1091 ms) ergibt sich effektiver Zyklus = **4.4 s pro Mint**. Empfehlung:
- Default auf `PRICE_FEED_TICKRATE_MS=5000` setzen (effektiv alle 4 s pro Mint bei N=4, weiterhin 55 req/min).
- Pro Bot konfigurierbar machen, falls einzelner Bot höhere Frequenz braucht (in `BotInstance.config.tickrateMs`).

### Phase-Plan

1. **Phase 1 (dieser ADR):** Token-Presets-Datei + WBTC/WETH-Mint-Config + `priceRecorder` Per-Mint-Datei + Scalping-Major-Template. SOL als zweite aktive Mint parallel zu UGOR. ~2-3 h.
2. **Phase 2:** Frontend-Token-Dropdown im `CreateBotDialog`, Migration-Script für Legacy-JSONL, Paper-Vergleich UGOR vs. SOL über 24 h.
3. **Phase 3 (nach Backtest-Validierung, getrennter ADR):** Live-Trading für Majors optional freischaltbar — vorher Slippage-Messung auf WBTC/WETH.

### Kosten

- **Setup:** 0 € (Refactor + Templates).
- **Runtime:** 0 € (DexScreener Public API, Binance Public API für Macro-Feed).
- **Risiko-Kosten:** potentieller Slippage-Verlust bei WBTC/WETH-Live-Trading (siehe Konsequenzen) — deshalb Phase 3 separat.

## Beziehungen

- Vorgänger: [ADR-001: Price-Feed-Provider](adr-001-price-feed-provider.md) — Jupiter ist deprecated; Empfehlung muss auf DexScreener-only angepasst werden.
- Vorgänger: [ADR-010: Stale Price Isolation](adr-010-stale-price-isolation.md) — Pattern der Price-Feed-Isolation wiederverwendet.
- Siehe auch: [ADR-012: Scalping Fork Adaptive Cycles](adr-012-scalping-fork-adaptive-cycles.md) — Strategie-Forks könnten später pro Asset-Klasse eigene Anpassungen liefern.
- Betroffene Dateien (Korrektur zur ursprünglichen ADR-Fassung): `src/config.ts`, `src/tokenPresets.ts` (neu), `src/priceRecorder.ts`, `src/botManager.ts`, `src/strategyTemplates/*`, `frontend/src/components/CreateBotDialog.tsx`.
