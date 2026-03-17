# Betrieb

## Voraussetzungen

- Node.js v22+
- npm Dependencies installiert (`npm install`)
- `.env` vorhanden (wird beim ersten `wallet.ts`-Lauf automatisch mit Keypair befüllt)
- Ollama (optional, für KI-Agent): `ollama serve` oder Docker-Container auf Port 11434

## Starten

```bash
# Kompletter Bot mit Dashboard + Web-UI + KI-Agent
npx tsx src/index.ts

# Nur Wallet testen (Balance, Airdrop)
npx tsx src/wallet.ts

# Nur Preis-Feed testen (10 Ticks)
npx tsx src/priceFeed.ts
```

Beim Start passiert:
1. PriceFeed beginnt alle 2s DexScreener zu pollen
2. PriceRecorder schreibt jeden Tick in `data/prices.jsonl`
3. PatternDetector analysiert Preise (Floor + Spike)
4. Trader reagiert auf BUY/SELL-Signale (Paper-Modus)
5. BotServer startet HTTP-Server (Port 3000, auto-increment bei Konflikt)
6. OllamaAgent prüft Ollama-Verfügbarkeit und startet 21-Min-Zyklus
7. Terminal-Dashboard zeigt Live-Daten

## Terminal-Dashboard

### Anzeige-Bereiche

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  UGOR Range Spike Scalper  [PAPER]         ← Modus
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Preis    $0.01290000  03:51:28             ← Live-Preis
  Floor    $0.01289500                       ← Berechneter Boden
  Spike    0.039%                            ← Abweichung (grün wenn ≥ Threshold)
  Signal   HOLD                              ← BUY/SELL/HOLD (farbcodiert)

  Chart    ▁▁▂▃▅▇█▇▅▃▂▁▁▁▂▃▅▆▅▃▂          ← Sparkline (letzte 40 Ticks)

────────────────────────────────────────────────
  SOL      10.0000    UGOR  0                ← Balances
  Trades   0  W:0 L:0  PnL: 0.00%           ← Performance

────────────────────────────────────────────────
  Letzte Trades                              ← Trade-History (letzte 5)
  03:52:14 BUY  $0.01292000
  03:52:28 SELL $0.01295000 +0.23%

────────────────────────────────────────────────
  Settings  floor:20 spike:0.3% drop:0.15% cd:5
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [q]uit  [s]ettings  [r]eset  [p]aper/live
```

### Tastenkürzel

| Taste | Aktion | Beschreibung |
|-------|--------|-------------|
| `s` | Settings | Feed pausieren → interaktiver Dialog für alle 4 Parameter → Feed neu starten |
| `r` | Reset | PatternDetector auf Default-Settings zurücksetzen |
| `p` | Paper/Live | Paper-Modus umschalten (Paper = Simulation) |
| `q` | Quit | Feed stoppen, finale Statistik ausgeben, Programm beenden |
| `Ctrl+C` | Quit | Wie `q` |

### Settings-Dialog (Taste `s`)

```
Settings anpassen (Enter = beibehalten):
  Floor Window (Ticks) [20]: 15
  Spike Threshold (%) [0.3]: 0.5
  Sell Drop Threshold (%) [0.15]:      ← Enter = Wert beibehalten
  Cooldown (Ticks) [5]: 3
```

---

## Web-Dashboard

Erreichbar unter `http://localhost:3000` (automatisch nächster freier Port wenn belegt).

### Sektionen

Das Web-Dashboard hat 4 Bereiche, erreichbar über die Navigation oben:

#### 1. Live-Dashboard
- **Echtzeit-Daten** via Server-Sent Events (SSE) — aktualisiert alle ~2 Sekunden
- Preis, Floor, Spike%, Signal (farbcodiert)
- Sparkline-Chart der letzten 60 Preise
- Balances (SOL/UGOR), Trade-Statistiken (Wins/Losses/PnL)
- Letzte 10 Trades mit Zeitstempel und PnL

#### 2. Settings
- **Slider** für alle 4 Pattern-Settings: floorWindow, spikeThreshold, sellDropThreshold, cooldownTicks
- Änderungen werden sofort an den Live-Bot gesendet (`POST /api/settings`)
- Reset-Button setzt auf Defaults zurück (`POST /api/reset`)

#### 3. Backtesting
Siehe [Backtesting](#backtesting) weiter unten.

#### 4. KI Agent
Siehe [KI-Agent Betrieb](#ki-agent-betrieb) weiter unten.

### API-Endpoints

| Endpoint | Methode | Beschreibung |
|----------|---------|-------------|
| `/api/stream` | GET (SSE) | Live-Bot-State alle ~2s |
| `/api/state` | GET | Aktueller Bot-State als JSON |
| `/api/settings` | POST | Pattern-Settings ändern |
| `/api/reset` | POST | Settings auf Defaults zurücksetzen |
| `/api/backtest/data-range` | GET | Verfügbare Preisdaten-Zeitspanne |
| `/api/backtest/start` | POST | Backtest starten |
| `/api/backtest/stop` | POST | Laufenden Backtest stoppen |
| `/api/backtest/stream` | GET (SSE) | Backtest-State-Stream |
| `/api/backtest/report` | GET | Markdown-Report des letzten Backtests |
| `/api/backtest/import` | POST | Historische Daten von GeckoTerminal importieren |
| `/api/agent/status` | GET | Agent-Status + Config |
| `/api/agent/models` | GET | Verfügbare Ollama-Modelle |
| `/api/agent/config` | POST | Agent-Konfiguration ändern |
| `/api/agent/trigger` | POST | Manuelle Analyse auslösen |
| `/api/agent/start` | POST | Agent starten |
| `/api/agent/stop` | POST | Agent stoppen |
| `/api/agent/history` | GET | Alle bisherigen Empfehlungen |

---

## Backtesting

### Voraussetzungen

Preisdaten müssen vorhanden sein in `data/prices.jsonl`. Daten werden automatisch gesammelt, sobald der Bot läuft. Alternativ können historische Daten importiert werden.

### Historische Daten importieren

Im Backtesting-Tab des Web-Dashboards:
1. Stunden wählen (1–72h, max 72h durch GeckoTerminal-Limit)
2. "Import starten" klicken
3. Daten werden von GeckoTerminal OHLCV API geladen und in `data/prices.jsonl` eingefügt

Oder per API:
```bash
curl -X POST http://localhost:3000/api/backtest/import \
  -H 'Content-Type: application/json' \
  -d '{"hours": 24}'
```

### Backtest durchführen

1. **Web-Dashboard** öffnen → Tab "Backtesting"
2. **Datenbereich** wird automatisch angezeigt (frühester/spätester Zeitpunkt, Anzahl Ticks)
3. **Zeitraum** wählen (Von/Bis Datum+Uhrzeit)
4. **Geschwindigkeit** wählen: 1x, 5x, 10x, 50x, 100x, 200x, 500x oder Instant
5. **Settings** konfigurieren (unabhängig vom Live-Bot): floorWindow, spikeThreshold, sellDropThreshold, cooldownTicks
6. **Zusatz-Config**: initialSOL, tradeSize, Agent ein/aus
7. **"Backtest Starten"** klicken

### Während des Backtests

- **Fortschrittsbalken** zeigt Fortschritt 0–100%
- **Live-Dashboard** zeigt Backtest-Daten: Preis, Floor, Spike%, Signal, Sparkline, Balances, Trades
- Der Live-Bot wird **nicht** beeinflusst (eigene Instanzen)
- **"Backtest Stoppen"** bricht vorzeitig ab

### Ergebnis

Nach Abschluss erscheint eine Zusammenfassung:
- Trades, Wins, Losses, Win-Rate, PnL%
- SOL Final Balance, Preisbereich (Min/Max/Start/End)
- Dauer (Ticks, Datenzeit, Wandzeit)

### Markdown-Report

"Als Markdown speichern" generiert einen vollständigen Report mit:
- Konfiguration und Start-Settings
- Alle Trades tabellarisch
- Agent-Anpassungen (wenn Agent aktiv)
- Analyse-Fragen für LLM-Auswertung

```bash
# Report per API abrufen
curl http://localhost:3000/api/backtest/report > backtest-report.md
```

### Backtest per API

```bash
# Verfügbare Daten prüfen
curl http://localhost:3000/api/backtest/data-range

# Backtest starten (Instant, alle Daten)
curl -X POST http://localhost:3000/api/backtest/start \
  -H 'Content-Type: application/json' \
  -d '{
    "fromTimestamp": 0,
    "toTimestamp": 9999999999999,
    "speed": 0,
    "settings": {
      "floorWindow": 20,
      "spikeThreshold": 0.3,
      "sellDropThreshold": 0.15,
      "cooldownTicks": 5
    },
    "initialSOL": 10,
    "tradeSize": 1,
    "enableAgent": true
  }'

# Laufenden Backtest stoppen
curl -X POST http://localhost:3000/api/backtest/stop
```

---

## KI-Agent Betrieb

### Überblick

Der OllamaAgent nutzt ein lokales LLM (Standard: `qwen3.5:4b`) um alle 21 Minuten den Markt zu analysieren und die Pattern-Detection-Settings dynamisch anzupassen.

### Voraussetzungen

Ollama muss laufen:
```bash
# Direkt
ollama serve

# Oder via Docker
docker run -d -p 11434:11434 --name ollama ollama/ollama

# Modell laden
ollama pull qwen3.5:4b
```

Der Agent erkennt automatisch beim Bot-Start ob Ollama verfügbar ist.

### Funktionsweise

1. **Marktstatistik berechnen**: Volatilität, Spread, Spike-Frequenz/-Amplitude, Trend (lineare Regression)
2. **Kontext aufbauen**: Aktuelle Settings, Trade-History, Marktdaten → Prompt
3. **LLM befragen**: Ollama Chat API mit `think: false` (verhindert Thinking-Modus bei qwen3)
4. **Regime erkennen**: RANGING, TRENDING, DEAD, oder VOLATILE
5. **Settings anpassen**: Wenn Confidence ≥ minConfidence, werden alle 4 Settings aktualisiert
6. **Broadcast**: Empfehlung wird per SSE an alle Web-Clients gesendet

### Regime-Typen

| Regime | Beschreibung | Typische Anpassung |
|--------|-------------|-------------------|
| RANGING | Preis konsolidiert auf Stufe | Standard-Settings, niedrige Thresholds |
| TRENDING | Klarer Auf- oder Abwärtstrend | Höhere Thresholds, größeres floorWindow |
| DEAD | Minimale Volatilität | Sehr niedrige Thresholds um Micro-Moves zu fangen |
| VOLATILE | Starke Schwankungen | Höhere Thresholds, schnellerer Cooldown |

### Web-Dashboard Steuerung

Im Tab "KI Agent":

- **Status-Karten**: Zeigen Modell, Zykluszeit, letztes Regime, Confidence
- **Start/Stop**: Agent ein-/ausschalten
- **Manuelle Analyse**: Sofortige Analyse auslösen (unabhängig vom Zyklus)
- **Konfiguration ändern**:
  - Modell (Dropdown mit allen installierten Ollama-Modellen)
  - Zykluszeit (Minuten)
  - Temperatur (0.0–2.0)
  - Max Tokens
  - Min Confidence (0.0–1.0)
  - Auto-Apply (ob Empfehlungen automatisch übernommen werden)
- **System-Prompt**: Bearbeitbar — der vollständige Prompt der an das LLM geht
- **Empfehlungs-History**: Chronologische Liste aller bisherigen Analysen

### Agent per API steuern

```bash
# Status abfragen
curl http://localhost:3000/api/agent/status

# Verfügbare Modelle
curl http://localhost:3000/api/agent/models

# Konfiguration ändern
curl -X POST http://localhost:3000/api/agent/config \
  -H 'Content-Type: application/json' \
  -d '{"model": "qwen3.5:4b", "cycleLengthMin": 15, "temperature": 0.5}'

# Manuelle Analyse auslösen
curl -X POST http://localhost:3000/api/agent/trigger

# Agent starten/stoppen
curl -X POST http://localhost:3000/api/agent/start
curl -X POST http://localhost:3000/api/agent/stop

# Empfehlungs-History
curl http://localhost:3000/api/agent/history
```

---

## Logs & Daten

### Verzeichnisstruktur

```
data/
└── prices.jsonl       # Alle Live-Preisticks (+ importierte historische Daten)

logs/
├── paper-trades.jsonl  # Paper-Trading-Log
└── live-trades.jsonl   # Live-Trading-Log (wenn Live-Modus aktiv)
```

### Log-Format (JSONL)

Jede Zeile ist ein JSON-Objekt:

```json
{
  "timestamp": 1773544350000,
  "action": "BUY",
  "price": 0.01292,
  "floor": 0.01289,
  "spikePercent": 0.233,
  "peakPrice": 0.01292,
  "settings": { "floorWindow": 20, "spikeThreshold": 0.3, "sellDropThreshold": 0.15, "cooldownTicks": 5 }
}
```

Bei SELL zusätzlich:
```json
{
  "action": "SELL",
  "pnlPercent": 0.23
}
```

### Preisdaten-Format

```json
{"timestamp": 1773544350000, "price": 0.01292}
```

### Logs auswerten

```bash
# Anzahl gesammelte Preisticks
wc -l data/prices.jsonl

# Alle Sells anzeigen
cat logs/paper-trades.jsonl | grep '"SELL"' | python3 -m json.tool

# Win-Rate berechnen
cat logs/paper-trades.jsonl | grep '"SELL"' | \
  python3 -c "import sys,json; sells=[json.loads(l) for l in sys.stdin]; \
  wins=[s for s in sells if s.get('pnlPercent',0)>0]; \
  print(f'Sells: {len(sells)} Wins: {len(wins)} Rate: {len(wins)/len(sells)*100:.0f}%')"

# Durchschnittlicher PnL
cat logs/paper-trades.jsonl | grep '"SELL"' | \
  python3 -c "import sys,json; sells=[json.loads(l) for l in sys.stdin]; \
  pnls=[s['pnlPercent'] for s in sells]; \
  print(f'Avg PnL: {sum(pnls)/len(pnls):.3f}%') if pnls else print('Keine Sells')"
```

---

## Troubleshooting

| Problem | Ursache | Lösung |
|---------|---------|--------|
| `[PriceFeed] Fehler: fetch failed` | Netzwerkproblem oder DexScreener down | Internetverbindung prüfen, kurz warten |
| `SAMMLE DATEN` bleibt stehen | Zu wenig Ticks für `floorWindow` | Warten oder `floorWindow` verringern via `[s]` |
| Keine Trades trotz Preisbewegung | `spikeThreshold` zu hoch | Via `[s]` reduzieren (z.B. 0.1%) |
| Zu viele Verlust-Trades | `spikeThreshold` zu niedrig | Via `[s]` erhöhen, oder Agent abwarten |
| Devnet Airdrop schlägt fehl | Rate-Limit (2 Requests/8h) | Manuell: https://faucet.solana.com |
| UGOR Balance 0 auf Devnet | UGOR existiert nur auf Mainnet | Normal — Paper-Trading braucht kein echtes UGOR |
| Web-Dashboard nicht erreichbar | Port belegt | Nächster freier Port wird automatisch gewählt, Konsole prüfen |
| Agent gibt `null` zurück | Zu wenig Daten (< 20 Preise) | Bot länger laufen lassen, mindestens 40s |
| Agent-Analyse dauert lange | LLM generiert viel | Kleineres Modell wählen oder maxTokens reduzieren |
| Ollama nicht erreichbar | Ollama nicht gestartet | `ollama serve` oder Docker-Container starten |
| `think: false` ignoriert | Falsches Ollama-Modell | Nur qwen3/qwen3.5 brauchen `think: false`, andere ignorieren es |
| Backtest zeigt keine Trades | Settings zu restriktiv | spikeThreshold senken, Zeitraum mit mehr Volatilität wählen |
| Historischer Import fehlschlägt | GeckoTerminal Rate-Limit (30 req/min) | Weniger Stunden importieren, später erneut versuchen |

---

## Mainnet-Umstellung

Wenn Paper-Trading-Ergebnisse zufriedenstellend sind:

1. **Neues Bot-Wallet in Phantom erstellen** (dediziert, nicht die Haupt-Wallet)
2. **Kleinen Betrag SOL + UGOR** auf Bot-Wallet transferieren
3. **Private Key exportieren** (Phantom → Einstellungen → Private Key anzeigen)
4. **`.env` anpassen:**
   ```env
   SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
   WALLET_PRIVATE_KEY=<mainnet-bot-wallet-key>
   ```
5. **Im Dashboard `[p]`** drücken um Live-Modus zu aktivieren
6. **Jupiter Ultra Integration** implementieren (Phase 4 erweitern)
