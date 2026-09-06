# TimesFM-Integration: Architektur und Implementierungsplan

## 1. Ziel

TimesFM soll lokal als numerisches Zeitreihenmodell für die Strategieoptimierung
verwendet werden. Es prognostiziert aus der persistierten Preisreihe eines Tokens
einen kurzen Horizont. Diese Prognose ergänzt die vorhandene Advisor- und Ollama-
Logik, ersetzt sie aber nicht.

Der aktuelle Scope ist bewusst begrenzt:

- TimesFM 2.5 lokal über PyTorch (Paket `timesfm==3.0.1`, 2.5-Checkpoint)
- separater Python-Worker mit HTTP-Schnittstelle
- TypeScript-Adapter im Node.js-Backend
- Nutzung im Smart Advisor als kleines Ranking-Signal
- geprüfter Signalvektor für spätere Entscheider-Kontexte
- keine direkte Orderausführung aus einer Prognose
- automatischer Fallback, wenn Worker, Daten oder Modell nicht verfügbar sind

## 2. Warum eine isolierte Integration

Das Kernsystem ist TypeScript/Node.js, TimesFM ist ein Python/PyTorch-Modell.
Ein separater Prozess hält diese Laufzeiten sauber getrennt und verhindert, dass
Modellinitialisierung, Python-Abhängigkeiten oder ein GPU-Fehler den Trading-Bot
beeinträchtigen.

```text
SQLite live_feed
      |
      v
src/timesFmForecast.ts --HTTP POST--> scripts/timesfm_service.py
      |                                      |
      |                                      v
      |                              TimesFM 2.5 / PyTorch
      v                                      |
Advisor confidence/ranking <----- forecast prices
      |
      v
REST /api/advisor/suggestions
```

## 3. Bereits implementierte Komponenten

### Python-Worker

Datei: `scripts/timesfm_service.py`

- lädt den Checkpoint einmal beim Start
- bindet standardmäßig nur an `127.0.0.1:8001`
- akzeptiert `POST /forecast`
- beantwortet `GET /health` für den Betriebs- und Startcheck
- prüft eine endliche eindimensionale Preisreihe mit mindestens 32 Werten
- begrenzt Kontext und Forecast-Horizont über Umgebungsvariablen
- liefert Punktprognosen als JSON zurück

Request:

```json
{
  "series": [1.0, 1.01, 1.02],
  "horizon": 12
}
```

Response:

```json
{
  "forecast": [1.03, 1.04],
  "contextLength": 128
}
```

### Node.js-Adapter

Datei: `src/timesFmForecast.ts`

Der Adapter:

1. liest die letzten Preise aus `live_feed` für einen Mint,
2. sortiert sie chronologisch,
3. verwirft Reihen mit weniger als 32 Punkten,
4. prüft die Zeitstempel auf grobe Lücken und verwirft unzuverlässige Reihen,
5. ruft den lokalen Worker mit Timeout auf,
6. berechnet Brutto- und Netto-Return bis zum letzten Forecast-Punkt,
7. berechnet einen Signalvektor aus Richtung, Konsistenz, Forecast-Volatilität
  und Datenqualität,
8. gibt bei jedem Fehler `null` zurück.

Damit ist TimesFM ein optionales Advisor-Signal und keine Laufzeitabhängigkeit für
Preisfeed, Trading oder Orderausführung.

### Advisor-Anbindung

Datei: `src/advisorEngine.ts`

Für jeden Kandidaten wird der Forecast optional geladen. Der Einfluss auf die
berechnete Confidence ist absichtlich begrenzt:

```text
forecastAdjustment = clamp(netExpectedReturnPct / 20, -0.08, +0.08)
```

Der Adjustment-Faktor wird zusätzlich mit `slopeConsistency` multipliziert und
erst ab mindestens 50% konsistenten Richtungsschritten aktiviert. Der aktuelle
Signalvektor besteht aus:

- `directionScore`: normalisierte Richtung von -1 bis +1
- `slopeConsistency`: Anteil der Forecast-Schritte in der dominanten Richtung
- `forecastVolatilityPct`: Streuung der Schritt-Renditen
- `dataQualityScore`: Qualität der Zeitabstände zwischen den Eingangsdaten

Die bestehenden Regime-, Liquiditäts- und historischen Performance-Gates bleiben
maßgeblich. Forecast-Metadaten werden in `diagnostics` der Advisor-Antwort
mitgeliefert:

- erwartete Änderung in Prozent
- erwartete Änderung nach geschätzten Roundtrip-Kosten
- verwendete Kontextlänge
- Forecast-Horizont
- medianer Tick-Abstand und größte erkannte Zeitlücke
- der vollständige TimesFM-Signalvektor

### Abhängigkeiten und Start

Dateien:

- `requirements-timesfm.txt`
- `package.json` mit `npm run timesfm:setup` und `npm run timesfm`
- `.env.example`
- `docs/configuration.md`

Installation:

```bash
npm run timesfm:setup
```

Der Setup-Schritt ist absichtlich optional und getrennt von `npm install`, weil
PyTorch eine große plattformspezifische Abhängigkeit ist. Ohne ihn bleibt
TimesFM deaktiviert; der normale Node-/Advisor-Betrieb funktioniert weiter.

Worker starten:

```bash
npm run timesfm
```

### Automatischer Start mit der App

Für den normalen Backend-Start ist kein zweites Terminal nötig. Wenn in `.env`
`TIMESFM_ENABLED=true` gesetzt ist, startet `src/index.ts` den Worker automatisch
als Child-Prozess:

```bash
npm start
```

Der Start verwendet bevorzugt `.venv-timesfm/bin/python`, fällt andernfalls auf
`python3` zurück und schreibt Worker-Ausgaben mit dem Prefix `[TimesFM]` in das
Backend-Log. Bei `SIGINT` oder `SIGTERM` werden Backend und Worker gemeinsam
beendet. Bei fehlendem Worker bleibt der Advisor-Fallback aktiv.

Vor `npm start` müssen die bestehenden App-Voraussetzungen erfüllt sein: eine
lokale `.env` muss existieren und die SQLite-Datenbank muss über den normalen
Initialisierungsweg angelegt worden sein. Ein fehlendes `.env` oder eine
nicht initialisierte `bots`-Tabelle ist kein TimesFM-Fehler und verhindert den
gesamten Backend-Start bereits vorher.

Backend aktivieren:

```env
TIMESFM_ENABLED=true
TIMESFM_URL=http://127.0.0.1:8001/forecast
TIMESFM_CONTEXT_LENGTH=128
TIMESFM_HORIZON=12
TIMESFM_TIMEOUT_MS=2500
```

Standardmäßig bleibt `TIMESFM_ENABLED` deaktiviert. Der erste Worker-Start lädt
den Modell-Checkpoint von Hugging Face und kann daher einige Zeit sowie mehrere
hundert MB Speicher benötigen. Die getestete Paketversion ist `timesfm==3.0.1`;
der Worker lädt trotzdem ausdrücklich nur den TimesFM-2.5-Checkpoint.

## 4. Daten- und Betriebsannahmen

- `live_feed` muss für einen Mint mindestens 32 valide Preiswerte enthalten.
- Der aktuelle Feed persistiert maximal die vorhandene Feed-Historie; TimesFM
  bekommt höchstens `TIMESFM_CONTEXT_LENGTH` Werte.
- Ein Forecast wird beim Advisor-Workflow erstellt, nicht bei jedem Price-Tick.
- Der Advisor-Cache reduziert die Aufrufhäufigkeit normalerweise auf einen Lauf
  pro fünf Minuten.
- Bei mehreren Kandidaten werden die Worker-Aufrufe aktuell nacheinander gemacht.
- Das Signal ist Evidenz für Ranking und Analyse, niemals eine Orderanweisung.
- Der lokale Worker darf nicht aus dem Netzwerk erreichbar sein.
- Paper-Trading bleibt der sichere Validierungsmodus.

Wenn OpenCode als Entscheider verwendet wird, bleibt `OLLAMA_MODEL` leer. Dadurch
entscheidet OpenCode selbst anhand seiner lokalen Konfiguration; TimesFM liefert
weiterhin nur numerische Evidenz und überschreibt kein LLM-Modell.

## 5. Bewusste Grenzen

TimesFM ist ein allgemeines Zeitreihenmodell und kennt weder Solana-Liquidität,
Slippage, Wallet-Zustand noch Handelskosten. Eine Preisprognose ist deshalb kein
BUY- oder SELL-Signal. Besonders bei sehr kurzen, verrauschten oder durch
Outages unterbrochenen Reihen muss das Signal als unsicher gelten.

TimesFM 3.0 wird in dieser Integration nicht eingesetzt: Laut dem aktuellen
TimesFM-Repository stehen die vortrainierten 3.0-Gewichte unter einer separaten
Non-Commercial-Lizenz. TimesFM 2.5 ist für diesen Plan die konservativere Wahl.

## 6. Validierung

Bereits durchgeführt:

- `npx tsc --noEmit`
- `python3 -m py_compile scripts/timesfm_service.py`
- TypeScript-Editor-Diagnostik für Adapter und Advisor
- deaktivierter Fallback ohne laufenden Worker
- `git diff --check`

Noch erforderlich für eine echte Modellvalidierung:

- TimesFM-Abhängigkeiten installieren
- Worker starten und `POST /forecast` mit Testreihe ausführen
- Forecast-Latenz und Speichernutzung messen
- Walk-forward-Backtest gegen eine Naive-Baseline durchführen
- Advisor-Ranking mit und ohne TimesFM vergleichen

Der technische Healthcheck ist kein Qualitätsnachweis für die Prognose. Er zeigt
nur, dass der Worker geladen ist und Requests annimmt; Prognosequalität muss
weiterhin mit Walk-forward-Daten gemessen werden.

## 7. Isolierter Implementierungsplan

### Phase 0: Umgebung und Baseline

- Python-Version, CPU/GPU und PyTorch-Verfügbarkeit festhalten.
- TimesFM-2.5-Checkpoint laden.
- Eine reproduzierbare Testreihe forecasten.
- Naive Baselines definieren: letzter Preis und Drift.

Abnahmekriterium: Der Worker liefert für eine gültige Testreihe eine valide JSON-
Antwort und beendet den Node-Bot bei einem Worker-Ausfall nicht.

### Phase 1: Adapter- und API-Tests

- Request-/Response-Schema testen.
- Ungültige Reihen, fehlende Felder und zu kurze Reihen testen.
- Timeout, HTTP 500 und nicht erreichbaren Worker testen.
- Preisreihen mit SQLite-Testdaten verwenden.

Abnahmekriterium: Alle Fehlerpfade liefern deterministisch `null`; keine Order-
oder Strategieausführung hängt vom Worker ab.

### Phase 2: Prognosequalität messen

- Historische `live_feed`-Reihen zeitlich in Kontext und Zukunft teilen.
- Walk-forward-Prognosen erzeugen.
- MAE, MAPE und Richtungstrefferquote messen.
- Gegen Last-Value- und Drift-Baseline vergleichen.
- Nach Token, Regime und Horizont getrennt auswerten.

Abnahmekriterium: TimesFM wird nur als Zusatzsignal aktiviert, wenn es die
Baseline nachweisbar verbessert. Eine hohe Genauigkeit allein genügt nicht,
wenn Gebühren und Slippage den erwarteten Vorteil aufzehren.

### Phase 3: Advisor-Kalibrierung

- Forecast-Einfluss zunächst bei maximal +/- 8 Prozentpunkten belassen.
- Ranking ohne Forecast als Kontrollgruppe speichern.
- Unterschiede in Top-3-Auswahl, Confidence und Regime getrennt protokollieren.
- Mindestanforderungen für Datenmenge und Forecast-Stabilität definieren.

Abnahmekriterium: Keine Strategie-Gate- oder Sicherheitsregel wird durch TimesFM
umgangen; der Forecast verbessert die Auswahl messbar oder bleibt neutral.

### Phase 3a: Mehrperspektivischer Entscheider-Kontext

Nach der Ranking-Kalibrierung kann der Signalvektor kompakt an den vorhandenen
Ollama-Agenten übergeben werden. Nicht die komplette Forecast-Serie, sondern nur
ein versionierter Evidenzblock wird verwendet:

```text
TIMESFM_EVIDENCE
- direction_score: -1..1
- net_expected_return_pct: after estimated costs
- slope_consistency: 0..1
- forecast_volatility_pct: percentage points
- data_quality_score: 0..1
- context_length / horizon
```

Der LLM-Agent darf daraus eine begründete Parameterempfehlung ableiten, aber
nicht:

- Liquiditäts-, Stale-Price-, Kill-Switch- oder Positionslimits umgehen,
- aus einem einzelnen Forecast automatisch einen Strategy-Switch auslösen,
- ein positives Signal ohne Netto-Kostenprüfung als profitabel bewerten.

Die weiteren Perspektiven bleiben getrennt und werden nicht in einen undurch-
schaubaren Gesamtwert verschmolzen:

1. Marktstruktur: Regime, Trend und Volatilität,
2. TimesFM: gerichtete numerische Forecast-Evidenz,
3. technische Indikatoren: EMA, RSI, MACD, Bollinger und ATR,
4. Ausführung: Liquidität, Slippage, Staleness und Kosten,
5. Erfahrung: Outcome-, Regime-, Zeitfenster- und Drift-Performance.

Abnahmekriterium: Das LLM erhält nachvollziehbare, begrenzte Evidenz und jede
automatische Änderung bleibt durch bestehende Clamp- und Confidence-Gates
kontrolliert.

### Phase 4: Strategieparameter optimieren

Erst nach Phase 2 und 3 darf TimesFM in die eigentliche Parameteroptimierung
eingehen. Dafür werden Forecast-Merkmale wie erwartete Richtung, Stärke und
Unsicherheit als Kontext an den bestehenden Ollama-Agenten gegeben. Der Agent
bleibt für erklärbare Parameteränderungen zuständig; TimesFM liefert nur
numerische Evidenz.

Abnahmekriterium:

- Änderungen werden weiterhin durch bestehende Sicherheitsgrenzen geklemmt.
- Jede automatische Änderung ist in `agent_history` nachvollziehbar.
- Neue Parameter werden zuerst im Paper-Modus und Backtest geprüft.
- Kein Live-Rollout ohne stabile Out-of-Sample-Ergebnisse.

Für ein belastbares Training oder Fine-Tuning des Entscheiders dürfen TimesFM-
Features erst nach einer zeitlich sauberen Outcome-Zuordnung verwendet werden:
Forecast-Zeitpunkt, tatsächlicher Zukunftshorizont, Gebühren, Slippage und
Regime müssen gemeinsam gespeichert werden. Zufällige Train/Test-Splits sind
wegen Leakage ungeeignet; verwendet werden Walk-forward-Splits.

### Phase 5: Betrieb und Rollout

- Worker als eigener systemd- oder Container-Service betreiben.
- Healthcheck und Modell-Ladezustand sichtbar machen.
- Latenz, Fehlerquote und Forecast-Alter messen.
- Worker-Restart ohne Backend-Restart ermöglichen.
- Feature-Flag zunächst nur für Paper-Bots aktivieren.

Abnahmekriterium: Worker-Ausfall, Modell-Download-Probleme und Neustarts führen
zu einem kontrollierten Rückfall auf den bisherigen Advisor.

## 9. Validierte Erweiterungspotenziale

### Hoher Nutzen, zuerst umsetzen

- Resampling auf feste 1m-/5m-Kerzen statt unregelmäßiger Provider-Ticks.
- Baseline-Vergleich gegen Last-Value und Drift.
- Netto-PnL-Simulation inklusive Slippage je Token und Strategie.
- Speicherung von Forecast, Signalvektor und späterem Outcome.
- Kontrollgruppe im Advisor: Ranking mit und ohne TimesFM.
- begrenzter Evidence-Block im Ollama-Prompt nach erfolgreicher Prognoseprüfung.

### Mittlerer Nutzen, erst nach Messung

- Forecasts für mehrere Horizonte passend zum Strategie-Timeframe.
- Quantil-/Unsicherheitsmerkmale statt nur Punktprognose.
- getrennte Kalibrierung nach Token-Liquidität und Marktregime.
- begrenzte Parallelisierung und per-Mint-Cache für den Worker.
- Healthcheck, Latenz- und Fehlertelemetrie im Dashboard.

### Nicht als erste Ausbaustufe

- TimesFM direkt im PriceFeed- oder Order-Hotpath,
- automatisches Fine-Tuning auf kleinen oder überlappenden Datensätzen,
- autonome Strategy-Switches allein aufgrund des Forecasts,
- ein ungewichtetes Ensemble, das alle Perspektiven in eine Zahl presst.

Diese Punkte erhöhen Komplexität oder Leakage-/Overfitting-Risiko, bevor eine
stabile Daten- und Outcome-Basis vorhanden ist.

## 10. Offene Entscheidungen

1. Soll die Forecast-Reihe künftig Tickdaten oder aggregierte OHLC-Kerzen nutzen?
2. Welcher Horizont entspricht dem jeweiligen Strategie-Timeframe?
3. Soll TimesFM pro Token oder pro Strategie-/Regime-Kombination kalibriert werden?
4. Welche Metrik entscheidet über Aktivierung: Richtung, erwarteter Netto-PnL oder
   Ranking-Qualität?
5. Soll der Worker langfristig als Prozess oder als Container laufen?
6. Welche Hardware steht für Dauerbetrieb zur Verfügung?

Diese Entscheidungen sollten anhand eines Walk-forward-Backtests beantwortet
werden, nicht anhand einzelner erfolgreicher Forecasts.
