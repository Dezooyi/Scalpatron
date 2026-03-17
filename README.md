# Solana BotTrader01 — Range Spike Scalper

Automatisierter Trading-Bot für den UGOR-Token auf Solana. Erkennt Preis-Spikes über dem Stufenboden und handelt den Zyklus: Kauf am Spike-Beginn, Verkauf am Scheitelpunkt.

```
     Spike Peak (SELL)
        ╱╲
       ╱  ╲
      ╱    ╲──── Drop → Sell
     ╱      ╲
────╱────────╲────────── Floor (Median)
   ▲                 ▲
  BUY               BUY
```

## Features

- **Live-Preisdaten** via DexScreener API (kostenlos, kein Key)
- **Pattern Detection** mit Floor-Median + Spike-Erkennung + State-Machine
- **Paper-Trading** mit simuliertem SOL/UGOR-Portfolio
- **KI-Agent** (Ollama) analysiert den Markt zyklisch und passt Settings dynamisch an
- **Rule-based Agent** als Fallback (Correction Agent mit 4 Optimierungsregeln)
- **Web-Dashboard** mit Live-Streaming (SSE), Settings-Panel, Backtesting, Agent-UI
- **Terminal-Dashboard** mit ANSI-Farben, Sparkline-Chart, interaktiven Settings
- **Backtesting** mit historischem Replay, Speed-Control, Markdown-Reports
- **Historischer Import** via GeckoTerminal OHLCV API (kostenlos)
- **Trade-Logging** persistent in JSONL-Format

## Voraussetzungen

| Software | Version | Hinweis |
|----------|---------|---------|
| **Node.js** | v22+ | `node --version` |
| **npm** | 10+ | kommt mit Node.js |
| **Ollama** | beliebig | Optional — für KI-Agent. Docker oder nativ. |

### Ollama (optional, für KI-Agent)

Der KI-Agent benötigt eine laufende Ollama-Instanz mit mindestens einem Modell:

```bash
# Ollama installieren (falls nicht vorhanden)
curl -fsSL https://ollama.ai/install.sh | sh

# Empfohlenes Modell laden
ollama pull qwen3.5:4b

# Oder via Docker
docker run -d -p 11434:11434 --name ollama ollama/ollama
docker exec ollama ollama pull qwen3.5:4b
```

Empfohlene Modelle (nach Eignung):

| Modell | RAM | Stärke |
|--------|-----|--------|
| `qwen3.5:4b` | ~3.4 GB | Bestes Preis-Leistungs-Verhältnis, gute JSON-Ausgabe |
| `gemma3:4b` | ~3.3 GB | Schnell, kein Thinking-Overhead |
| `qwen3:4b` | ~2.5 GB | Kleiner, schnell |
| `llama3.2:3b` | ~2 GB | Am kleinsten, für schwache Hardware |

## Installation

```bash
# Repository klonen / entpacken
cd Solana_BotTrader01

# Dependencies installieren
npm install
```

### Server STart
npx tsx src/index.ts 
npm run dev

## Konfiguration

### .env erstellen

```bash
cp .env.example .env
# oder manuell erstellen:
```

```env
# Solana RPC Endpoint
SOLANA_RPC_URL=https://api.devnet.solana.com

# Bot-Wallet Private Key (Base58)
# Wird beim ersten Start automatisch generiert wenn leer
WALLET_PRIVATE_KEY=

# Token Mint Addresses
UGOR_MINT=UGoRwdj9SK78V6Pq9YMz9BvmNuJTLNqPZyS5WnGd8uW
SOL_MINT=So11111111111111111111111111111111111111112

# Jupiter Ultra API (für Live-Trading)
JUPITER_ULTRA_URL=https://lite.jup.ag/ultra/v1/

# Price Feed Konfiguration (Anbieter & Tickrate)
PRICE_FEED_PROVIDER=dexscreener       # 'dexscreener', 'jupiter', 'birdeye', 'custom'
PRICE_FEED_TICKRATE_MS=2000           # Polling-Intervall pro Token (ms)
PRICE_FEED_REQUEST_INTERVAL_MS=5000   # Mindestabstand zwischen API-Calls (Rate Limiting)
PRICE_FEED_MAX_RETRIES=4              # Maximale Retries bei 429/Netzwerk-Fehlern
# PRICE_FEED_CUSTOM_URL=...           # Nur bei PRICE_FEED_PROVIDER=custom
```

### Anbieter-Vergleich

| Provider | Kosten | Rate Limit | Stärke | Schwäche |
|----------|--------|------------|--------|----------|
| **DexScreener** | Kostenlos | ~10-30/min | Gut für Small/Mid-Caps, Devnet-fähig, keine API-Key nötig | Kann bei vielen Requests 429 returned |
| **Jupiter** | Kostenlos | 100/min | Beste Preise, aggregiert alle DEXes, stabil | ❗ Nur Mainnet-Tokens, keine Devnet-Unterstützung |
| **Birdeye** | Freemium | 50/min (Free) | Echtzeit-Daten, viele Token | API-Key erforderlich |
| **Custom** | - | - | Eigene Price-Source | Selbst zu betreiben |

**Empfehlung:**
- **Testing/Devnet:** DexScreener (kostenlos, Devnet-fähig)
- **Production/Mainnet:** Jupiter (stabiler, höhere Limits, bessere Preise)
- **Rate Limiting anpassen:** Bei 429 Fehlern `PRICE_FEED_REQUEST_INTERVAL_MS` erhöhen (z.B. auf 5000ms)

# Ollama (optional)
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen3.5:4b
```

### Trading-Parameter (PatternSettings)

Können zur Laufzeit im Dashboard oder Web-UI angepasst werden:

| Parameter | Default | Bereich | Beschreibung |
|-----------|---------|---------|-------------|
| `floorWindow` | 20 | 5–100 | Ticks für Floor-Berechnung (Median) |
| `spikeThreshold` | 0.3% | 0.05–5.0% | Mindest-% über Floor für Spike-Erkennung (→ BUY) |
| `sellDropThreshold` | 0.15% | 0.03–2.0% | Rückgang vom Peak in % (→ SELL) |
| `cooldownTicks` | 5 | 0–50 | Pause nach Trade (verhindert Overtrading) |

```
Preis
  │         Peak ─────┐
  │        ╱           │ ← sellDropThreshold (0.15%)
  │       ╱            ▼
  │      ╱ Spike   Sell-Signal
  │     ╱
  │────╱───── spikeThreshold (0.3%) ── BUY-Signal
  │
  │═══════════════ Floor (Median)
  │
  └────────────────────────────── Zeit
        ◀──────────▶
         floorWindow
```

## Starten

### Bot starten

```bash
npx tsx src/index.ts
```

Das startet:
1. **Terminal-Dashboard** mit Live-Preisen, Signalen, Trades
2. **Web-Server** auf `http://localhost:3000` (auto-increment bei Portkonflikt)
3. **KI-Agent** (wenn Ollama erreichbar) — erste Analyse nach 60 Sekunden

### Tastenkürzel (Terminal)

| Taste | Aktion |
|-------|--------|
| `s` | Settings live anpassen (interaktiver Dialog) |
| `r` | Settings auf Default zurücksetzen |
| `p` | Paper/Live-Modus umschalten |
| `q` | Bot beenden mit finaler Statistik |

### Standalone-Module testen

```bash
# Wallet testen (Balance, Airdrop)
npx tsx src/wallet.ts

# Preis-Feed testen (10 Ticks, dann Statistik)
npx tsx src/priceFeed.ts
```

## Web-Dashboard

Öffne `http://localhost:3000` im Browser (Port wird beim Start angezeigt).

### Bereiche

| Tab | Funktion |
|-----|----------|
| **Dashboard UI** | Live-Preis, Floor, Spike%, Signal, Chart, Trades, Performance |
| **Settings Panel** | Sliders für alle PatternSettings, Apply/Reset |
| **Backtesting** | Historisches Replay mit Speed-Control und MD-Report |
| **KI Agent** | Ollama-Modellwahl, Prompt-Editor, Analyse-History, manuelle Trigger |

### API-Endpoints

| Endpoint | Methode | Beschreibung |
|----------|---------|-------------|
| `/api/stream` | GET (SSE) | Live-Daten alle ~2s + Agent-Events |
| `/api/state` | GET | Aktueller Bot-State als JSON |
| `/api/settings` | POST | Trading-Settings ändern |
| `/api/reset` | POST | Settings auf Default zurücksetzen |
| `/api/backtest/data-range` | GET | Verfügbarer Preisdaten-Zeitraum |
| `/api/backtest/import` | POST | Historische Daten von GeckoTerminal importieren |
| `/api/backtest/start` | POST | Backtest starten |
| `/api/backtest/stop` | POST | Laufenden Backtest abbrechen |
| `/api/backtest/stream` | GET (SSE) | Backtest-Ergebnisse live streamen |
| `/api/backtest/report` | GET | Markdown-Report des letzten Backtests |
| `/api/agent/status` | GET | Agent-Status + Config |
| `/api/agent/models` | GET | Verfügbare Ollama-Modelle |
| `/api/agent/config` | POST | Agent-Konfiguration ändern |
| `/api/agent/trigger` | POST | Manuelle Analyse auslösen |
| `/api/agent/start` | POST | Agent starten |
| `/api/agent/stop` | POST | Agent stoppen |
| `/api/agent/history` | GET | Alle bisherigen Analysen |

## Backtesting

### Daten sammeln

Der Bot zeichnet automatisch alle Preisdaten in `data/prices.jsonl` auf. Zusätzlich können historische Daten importiert werden:

```bash
# Via Web-Dashboard: Backtesting Tab → "Historische Daten laden"
# Via API:
curl -X POST http://localhost:3000/api/backtest/import \
  -H 'Content-Type: application/json' \
  -d '{"hours": 24}'
```

Quelle: [GeckoTerminal OHLCV API](https://api.geckoterminal.com) — kostenlos, kein Key, 1-Minuten-Candles.

### Backtest starten

Im Web-Dashboard unter "Backtesting":
1. **Zeitraum** wählen (Von/Bis)
2. **Geschwindigkeit** setzen (1x, 5x, 10x, 50x, 100x, 200x, 500x, Instant)
3. **Pattern Settings** für den Test definieren (unabhängig vom Live-Bot)
4. **Start** klicken
5. Nach Abschluss: **Protokoll als Markdown speichern** für LLM-Analyse

### Backtest via API

```bash
curl -X POST http://localhost:3000/api/backtest/start \
  -H 'Content-Type: application/json' \
  -d '{
    "fromTimestamp": 1773580000000,
    "toTimestamp": 1773590000000,
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
```

## KI-Agent (Ollama)

Der Agent analysiert den Markt zyklisch (Standard: alle 21 Minuten) und erkennt das aktuelle Markt-Regime:

| Regime | Bedeutung | Agent-Reaktion |
|--------|-----------|----------------|
| **RANGING** | Seitwärtsbewegung mit Spikes | Normale Settings, ideal für Scalping |
| **TRENDING** | Klarer Auf-/Abwärtstrend | Erhöht spikeThreshold (>1.5%) |
| **DEAD** | Extrem niedrige Volatilität | Senkt spikeThreshold (<0.15%) |
| **VOLATILE** | Hohe schnelle Schwankungen | Erhöht sellDropThreshold |

### Agent konfigurieren

Im Web-Dashboard unter "KI Agent":
- **Modell** aus allen installierten Ollama-Modellen wählen
- **Zyklus** (Minuten) — wie oft analysiert wird
- **Temperature** — Kreativität des LLM (0.0–1.0)
- **Min. Confidence** — Mindest-Confidence zum automatischen Anwenden
- **Auto-Apply** — Settings automatisch anwenden oder nur empfehlen
- **System Prompt** — Anweisungen für das LLM editieren
- **"Jetzt Analysieren"** — Analyse sofort auslösen

### Agent via API

```bash
# Status prüfen
curl http://localhost:3000/api/agent/status

# Modell wechseln
curl -X POST http://localhost:3000/api/agent/config \
  -H 'Content-Type: application/json' \
  -d '{"model": "gemma3:4b", "cycleMinutes": 10}'

# Manuelle Analyse
curl -X POST http://localhost:3000/api/agent/trigger
```

## Projektstruktur

```
Solana_BotTrader01/
├── src/
│   ├── index.ts            # App-Einstieg, Event-Loop, Modul-Orchestrierung
│   ├── config.ts           # Zentrale Konfiguration aus .env
│   ├── wallet.ts           # Keypair-Verwaltung, Devnet-Airdrop
│   ├── priceFeed.ts        # DexScreener UGOR-Preis (Polling alle 2s)
│   ├── patternDetector.ts  # Floor-Median + Spike-Erkennung (State-Machine)
│   ├── trader.ts           # Paper/Live-Trading mit PnL-Tracking
│   ├── agent.ts            # Rule-based Correction Agent (4 Regeln)
│   ├── ollamaAgent.ts      # KI-Agent (Ollama LLM, zyklische Marktanalyse)
│   ├── dashboard.ts        # Terminal-UI mit ANSI-Farben + Sparkline
│   ├── server.ts           # HTTP-Server + SSE + REST API für Web-Dashboard
│   ├── logger.ts           # Trade-Log (JSONL-Persistenz)
│   ├── priceRecorder.ts    # Preisdaten aufzeichnen + GeckoTerminal-Import
│   └── backtester.ts       # Backtest-Engine (Replay, Speed-Control, Report)
├── docs/
│   ├── index.html          # Web-Dashboard (Live-UI + Settings + Backtesting + Agent)
│   ├── README.md           # Dokumentations-Index
│   ├── architecture.md     # System-Design, Datenfluss
│   ├── modules.md          # Modul-Referenz
│   ├── configuration.md    # Konfiguration (.env, Settings)
│   ├── strategy.md         # Trading-Strategie erklärt
│   └── operations.md       # Betrieb, Troubleshooting
├── logs/                   # Trade-Logs (paper-trades.jsonl, backtest-*.jsonl)
├── data/                   # Aufgezeichnete Preisdaten (prices.jsonl)
├── .env                    # Laufzeit-Konfiguration (NICHT committen!)
├── tsconfig.json           # TypeScript-Konfiguration
├── package.json            # Dependencies
├── CLAUDE.md               # Claude Code Projektkontext
└── README.md               # Diese Datei
```

## Architektur

```
┌──────────────────────────────────────────────────────────────────┐
│                          index.ts                                │
│                        (Event-Loop)                              │
│                                                                  │
│  ┌──────────────┐  tick()   ┌──────────────────┐                 │
│  │  PriceFeed   │──────────▶│ PatternDetector  │                 │
│  │  (polling)   │ PricePoint│ (Floor + Spike)  │                 │
│  └──────┬───────┘           └────────┬─────────┘                 │
│         │                           │ PatternResult              │
│         │                           ▼                            │
│         │  ┌──────────────┐  ┌──────────────┐                    │
│         │  │PriceRecorder │  │    Trader     │                    │
│         │  │(prices.jsonl)│  │ (Paper/Live)  │                    │
│         │  └──────────────┘  └──────┬───────┘                    │
│         │                          │ TradeLogEntry               │
│         │                    ┌─────┴──────┐                      │
│         │                    ▼            ▼                      │
│         │           ┌────────────┐ ┌──────────────┐              │
│         │           │Rule Agent  │ │ OllamaAgent  │              │
│         │           │(4 Regeln)  │ │(LLM, 21 Min) │              │
│         │           └─────┬──────┘ └──────┬───────┘              │
│         │                 │ AgentAdvice    │ OllamaAdvice         │
│         │                 └───────┬───────┘                      │
│         │                         ▼                              │
│         │                PatternDetector.updateSettings()         │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────────────┐   │
│  │Dashboard │  │  Logger  │  │        BotServer             │   │
│  │(Terminal)│  │ (JSONL)  │  │  HTTP + SSE + REST API       │   │
│  └──────────┘  └──────────┘  │  → docs/index.html (Web-UI) │   │
│                               │  → Backtester               │   │
│  [q]uit [s]ettings [r]eset   └──────────────────────────────┘   │
│  [p]aper/live                                                    │
└──────────────────────────────────────────────────────────────────┘
```

## Datenfluss

1. **PriceFeed** pollt DexScreener alle 2s → `PricePoint { timestamp, price }`
2. **PriceRecorder** speichert jeden Tick in `data/prices.jsonl`
3. **PatternDetector** berechnet Floor (Median) + Spike% → `BUY/SELL/HOLD`
4. **Trader** führt Trades aus (Paper oder Live), berechnet PnL
5. **CorrectionAgent** prüft nach jedem Trade die Win-Rate → passt Settings an
6. **OllamaAgent** analysiert alle 21 Min den Markt via LLM → Regime + Settings
7. **Dashboard** rendert im Terminal (ANSI) und via **BotServer** (SSE) im Browser
8. **Backtester** kann aufgezeichnete Daten mit beliebigen Settings durchspielen

## Logs & Daten

```bash
# Trade-Logs anzeigen
cat logs/paper-trades.jsonl | python3 -m json.tool

# Nur SELLs mit PnL
grep '"SELL"' logs/paper-trades.jsonl | python3 -m json.tool

# Win-Rate berechnen
grep '"SELL"' logs/paper-trades.jsonl | \
  python3 -c "import sys,json; sells=[json.loads(l) for l in sys.stdin]; \
  wins=[s for s in sells if s.get('pnlPercent',0)>0]; \
  print(f'Sells: {len(sells)} Wins: {len(wins)} Rate: {len(wins)/len(sells)*100:.0f}%')"

# Aufgezeichnete Preisdaten
wc -l data/prices.jsonl        # Anzahl Datenpunkte
head -1 data/prices.jsonl      # Erster Eintrag
tail -1 data/prices.jsonl      # Letzter Eintrag
```

## Troubleshooting

| Problem | Ursache | Lösung |
|---------|---------|--------|
| `[PriceFeed] Fehler: fetch failed` | Netzwerk oder DexScreener down | Internetverbindung prüfen |
| `SAMMLE DATEN` bleibt stehen | Zu wenig Ticks für floorWindow | Warten oder floorWindow via `[s]` senken |
| Keine Trades trotz Preisbewegung | spikeThreshold zu hoch | Via Settings senken (z.B. 0.1%) |
| Zu viele Verlust-Trades | spikeThreshold zu niedrig | Erhöhen, oder Agent Settings optimieren lassen |
| `[OllamaAgent] Ollama nicht erreichbar` | Ollama nicht gestartet | `ollama serve` oder Docker starten |
| Agent gibt leere Antwort | Thinking-Modus bei qwen3/3.5 | Wird automatisch mit `think: false` behandelt |
| Port bereits belegt | Andere Bot-Instanz läuft | Port wird automatisch erhöht (3000→3001→...) |
| Backtest: "Keine Preisdaten" | Keine Daten im Zeitraum | Erst Daten importieren (GeckoTerminal) |
| Devnet Airdrop schlägt fehl | Rate-Limit | https://faucet.solana.com nutzen |

## Tech-Stack

| Komponente | Technologie |
|------------|-------------|
| Runtime | Node.js v22, TypeScript, `npx tsx` |
| Blockchain | Solana (`@solana/web3.js`) |
| DEX | Jupiter Ultra API |
| Preis-Daten (Live) | DexScreener API (kostenlos, kein Key) |
| Preis-Daten (Historisch) | GeckoTerminal OHLCV API (kostenlos, kein Key) |
| KI-Agent | Ollama (lokal, qwen3.5:4b) |
| Web-Dashboard | Vanilla HTML/JS + SSE |
| OS | Linux (Nobara), sollte auf macOS/Windows laufen |
| Netzwerk | Devnet (Testnet), Mainnet-ready |

## Mainnet-Umstellung

Wenn Paper-Trading-Ergebnisse zufriedenstellend:

1. **Neues Bot-Wallet** erstellen (dediziert, nicht Haupt-Wallet)
2. **Kleinen Betrag SOL** auf Bot-Wallet transferieren
3. **`.env` anpassen:**
   ```env
   SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
   WALLET_PRIVATE_KEY=<mainnet-bot-wallet-key>
   ```
4. **Im Dashboard `[p]`** drücken für Live-Modus
5. **Jupiter Ultra** Integration nutzen (Swap-Endpoint)

## Lizenz

Privates Projekt — nicht zur öffentlichen Nutzung bestimmt.
