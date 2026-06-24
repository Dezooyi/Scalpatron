import { BookOpen, Network, Puzzle, TrendingUp, Settings, Server } from 'lucide-react';
import { PageHeader } from './PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function Documentation() {
  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      {/* Einheitlicher Header */}
      <PageHeader
        icon={BookOpen}
        title="Documentation"
        description="Multi-Bot Trading Platform for Solana SPL Tokens — Technical Documentation"
      />

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-3 lg:grid-cols-6">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="architecture">Architecture</TabsTrigger>
          <TabsTrigger value="modules">Modules</TabsTrigger>
          <TabsTrigger value="strategy">Strategy</TabsTrigger>
          <TabsTrigger value="configuration">Configuration</TabsTrigger>
          <TabsTrigger value="operations">Operations</TabsTrigger>
        </TabsList>

        {/* OVERVIEW */}
        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" /> Project Overview
              </CardTitle>
              <CardDescription>
                Multi-Bot Trading Platform for Solana SPL Tokens
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                Scalpatron is a modular trading platform for Solana SPL tokens. Each bot detects regular price spikes after consolidation phases
                and trades the cycle automatically: buy at the range floor, sell at the spike peak.
              </p>
              <p className="text-muted-foreground">
                The platform supports <strong>multiple independent bots in parallel</strong> — each bot can be configured for a different token
                and operates with its own strategy, settings, and trade history.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Architecture</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-primary">Multi-Bot</div>
                    <p className="text-xs text-muted-foreground mt-1">Parallel bots for any tokens</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Strategy</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-500">Range Spike Scalper</div>
                    <p className="text-xs text-muted-foreground mt-1">Floor-Median + Spike Detection</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Trading Modes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-yellow-500">Paper / Live</div>
                    <p className="text-xs text-muted-foreground mt-1">Simulation or Jupiter Ultra</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Price Feed</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-purple-500">DexScreener API</div>
                    <p className="text-xs text-muted-foreground mt-1">Polling 2s, highest volume pair</p>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Quick Start</h3>
                <pre className="bg-muted p-3 rounded-lg font-mono text-sm overflow-x-auto">
                  <code>npx tsx src/index.ts</code>
                </pre>
                <p className="text-sm text-muted-foreground">
                  Start backend → open Web-UI at <code className="bg-muted px-1 rounded">http://localhost:3000</code> → create bot → start
                </p>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Project Structure</h3>
                <pre className="bg-muted p-3 rounded-lg font-mono text-xs overflow-x-auto">
{`Solana_BotTrader00/
├── src/
│   ├── index.ts            # App entry point, event loop
│   ├── config.ts           # Central configuration from .env
│   ├── wallet.ts           # Keypair management, Devnet airdrop
│   ├── priceFeed.ts        # DexScreener price feed (multi-token)
│   ├── patternDetector.ts  # Floor-Median + spike detection
│   ├── trader.ts           # Paper/live trading with PnL tracking
│   ├── agent.ts            # Correction Agent (auto-optimization)
│   ├── ollamaAgent.ts      # AI Agent (LLM, 21-min cycle)
│   ├── botManager.ts       # Multi-bot management (SQLite)
│   ├── botInstance.ts      # Single bot instance
│   ├── dashboard.ts        # Terminal UI with ANSI colors
│   ├── server.ts           # HTTP + SSE + REST API
│   ├── db.ts               # SQLite database
│   └── logger.ts           # Trade log (JSONL persistence)
├── frontend/               # React 19 + Vite + Tailwind v4
│   └── src/
│       ├── App.tsx         # Main UI with multi-bot dashboard
│       └── components/     # Documentation, UI components
├── logs/                   # Trade logs (trades-<botId>.jsonl)
├── data/                   # Price data (prices.jsonl)
├── docs/                   # Documentation (MD + HTML)
├── .env                    # Private keys (do not commit!)
├── tsconfig.json
└── package.json`}
                </pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ARCHITECTURE */}
        <TabsContent value="architecture" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Network className="h-5 w-5" /> System Architecture
              </CardTitle>
              <CardDescription>Data flow and module dependencies</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-3">System Overview</h3>
                <pre className="bg-muted p-4 rounded-lg font-mono text-xs overflow-x-auto leading-relaxed">
{`┌──────────────────────────────────────────────────────────────────────┐
│                           index.ts                                   │
│                         (Event Loop)                                 │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                      BotManager                              │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │    │
│  │  │ BotInstance │  │ BotInstance │  │ BotInstance │  ...     │    │
│  │  │ (Token A)   │  │ (Token B)   │  │ (Token C)   │          │    │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘          │    │
│  └─────────┼────────────────┼────────────────┼─────────────────┘    │
│            │                │                │                      │
│            ▼                ▼                ▼                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    PriceFeed (Singleton)                     │    │
│  │  historyMap: Map<mintAddress, PricePoint[]>                  │    │
│  │  polling per token separately (2s interval)                  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  Per bot instance:                                                   │
│  PriceFeed ──▶ PatternDetector ──▶ Trader ──▶ Logger               │
│     │              │                   │                             │
│     │              │                   ▼                             │
│     │              │            TradeLogEntry                        │
│     │              │            (JSONL per bot)                      │
│     │              ▼                                                 │
│     │         OllamaAgent (global, 21-min cycle)                     │
│     │         CorrectionAgent (after each trade)                     │
│     ▼                                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────────┐    │
│  │ BotServer    │  │   SQLite     │  │  Frontend (React)       │    │
│  │ SSE + REST   │  │  BotManager  │  │  http://localhost:3000  │    │
│  └──────────────┘  └──────────────┘  └─────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘`}
                </pre>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3">Data Flow</h3>
                <div className="space-y-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">1. Bot Creation (Web UI)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="bg-muted p-2 rounded font-mono text-xs">
{`Web-UI -POST /api/bots-&gt; BotManager.createBot()
                              |
                              v
                        Create BotInstance
                              |
                              v
                        SQLite: INSERT INTO bots`}
                      </pre>
                      <p className="text-sm text-muted-foreground mt-2">
                        Each bot receives a unique ID, token mint address, starting capital, and settings.
                        Bot configuration is persisted in SQLite.
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">2. Bot Start (per token)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="bg-muted p-2 rounded font-mono text-xs">
{`BotInstance.start() -&gt; PriceFeed.subscribe(mintAddress)
                          |
                          v
                    Start polling (2s interval)
                          |
                          v
                    historyMap.set(mintAddress, [])`}
                      </pre>
                      <p className="text-sm text-muted-foreground mt-2">
                        A separate polling process is started per bot for the respective token.
                        PriceFeed manages a Map&lt;mintAddress, PricePoint[]&gt; for all tokens.
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">3. Price Tick (every 2 seconds per bot)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="bg-muted p-2 rounded font-mono text-xs">
{`DexScreener API -GET-&gt; fetchTokenPrice(mintAddress)
                              |
                              v
                        PricePoint { timestamp, price }
                              |
                              v
                        history.push(point) // max 1000 per token
                              |
                              v
                        emit price:mintAddress`}
                      </pre>
                      <p className="text-sm text-muted-foreground mt-2">
                        HTTP GET to <code className="bg-muted px-1 rounded">https://api.dexscreener.com/latest/dex/tokens/&lt;MINT_ADDRESS&gt;</code>.
                        Selects the pair with the highest 24h volume.
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">4. Pattern Analysis (per tick, per bot)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="bg-muted p-2 rounded font-mono text-xs">
                        <code>history[] -&gt; PatternDetector.analyze() -&gt; PatternResult</code>
                      </pre>
                      <ul className="text-sm text-muted-foreground mt-2 space-y-1 list-disc list-inside">
                        <li><strong>Floor:</strong> Median of the last N prices (<code>floorWindow</code>, default: 20)</li>
                        <li><strong>Spike%:</strong> <code>(currentPrice - floor) / floor * 100</code></li>
                        <li><strong>State Machine:</strong> WAITING → BUY → TRACKING → SELL → COOLDOWN</li>
                      </ul>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">5. Trade Execution (per bot)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="bg-muted p-2 rounded font-mono text-xs">
                        <code>PatternResult -&gt; Trader.handleSignal() -&gt; TradeLogEntry | null</code>
                      </pre>
                      <ul className="text-sm text-muted-foreground mt-2 space-y-1 list-disc list-inside">
                        <li><strong>BUY:</strong> <code>tradeSize</code> SOL → Token at current price</li>
                        <li><strong>SELL:</strong> Entire position → SOL, calculate PnL%</li>
                        <li>Persisted in <code>logs/trades-&lt;botId&gt;.jsonl</code></li>
                      </ul>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">6. AI Agent (global, every 21 minutes)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="bg-muted p-2 rounded font-mono text-xs">
{`OllamaAgent.runCycle() -&gt; for each active bot:
                              |
                              v
                        Read PriceHistory + TradeLog
                              |
                              v
                        calcMarketStats() -&gt; Prompt
                              |
                              v
                        Ollama Chat API -&gt; parse JSON
                              |
                              v
                        PatternDetector.updateSettings()
                        BotServer.broadcastAgentAdvice()`}
                      </pre>
                      <ul className="text-sm text-muted-foreground mt-2 space-y-1 list-disc list-inside">
                        <li>Detects regime: RANGING / TRENDING / DEAD / VOLATILE</li>
                        <li>Adjusts settings per bot when confidence &ge; minConfidence</li>
                        <li>Model: <code>qwen3.5:4b</code>, Temperature: 0.3</li>
                      </ul>
                    </CardContent>
                  </Card>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3">Module Dependencies</h3>
                <pre className="bg-muted p-3 rounded-lg font-mono text-xs overflow-x-auto">
{`config.ts ◀─── priceFeed.ts
               priceRecorder.ts

patternDetector.ts (no deps)
trader.ts ◀─── logger.ts
agent.ts (no deps except types)
ollamaAgent.ts (no deps except types)
dashboard.ts (no deps except types)

server.ts ◀─── backtester.ts
               priceRecorder.ts (type)
               ollamaAgent.ts (type)

index.ts ◀─── priceFeed.ts, priceRecorder.ts
               patternDetector.ts, trader.ts
               agent.ts, ollamaAgent.ts
               dashboard.ts, server.ts`}
                </pre>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3">State Management</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  The bot has <strong>no global state store</strong>. State is held within the respective modules:
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>State</TableHead>
                      <TableHead>Held By</TableHead>
                      <TableHead>Persisted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-mono text-xs">Price History</TableCell>
                      <TableCell className="font-mono text-xs">PriceFeed.history[]</TableCell>
                      <TableCell className="text-xs">Yes (data/prices.jsonl)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">Spike Tracking</TableCell>
                      <TableCell className="font-mono text-xs">PatternDetector</TableCell>
                      <TableCell className="text-xs">No</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">Position</TableCell>
                      <TableCell className="font-mono text-xs">Trader.position</TableCell>
                      <TableCell className="text-xs">No</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">Balances</TableCell>
                      <TableCell className="font-mono text-xs">Trader.balanceSOL/balanceToken</TableCell>
                      <TableCell className="text-xs">No</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">Trade Log</TableCell>
                      <TableCell className="font-mono text-xs">Logger.entries[]</TableCell>
                      <TableCell className="text-xs">Yes (logs/*.jsonl)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">Settings</TableCell>
                      <TableCell className="font-mono text-xs">PatternDetector.settings</TableCell>
                      <TableCell className="text-xs">No (Default + Agent)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">Agent Config</TableCell>
                      <TableCell className="font-mono text-xs">OllamaAgent.config</TableCell>
                      <TableCell className="text-xs">No (Runtime)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">Backtest Summary</TableCell>
                      <TableCell className="font-mono text-xs">BotServer.lastBacktestSummary</TableCell>
                      <TableCell className="text-xs">No (Runtime)</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3">External APIs</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>API</TableHead>
                      <TableHead>Purpose</TableHead>
                      <TableHead>Auth</TableHead>
                      <TableHead>Rate Limit</TableHead>
                    </TableRow>
                  </TableHeader>
                   <TableBody>
                     <TableRow>
                       <TableCell className="font-mono text-xs">DexScreener</TableCell>
                       <TableCell className="text-xs">Live prices (any tokens)</TableCell>
                       <TableCell className="text-xs">No key</TableCell>
                       <TableCell className="text-xs">~300 req/min</TableCell>
                     </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">GeckoTerminal</TableCell>
                      <TableCell className="text-xs">Historical OHLCV</TableCell>
                      <TableCell className="text-xs">No key</TableCell>
                      <TableCell className="text-xs">30 req/min</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">Ollama (local)</TableCell>
                      <TableCell className="text-xs">AI agent analysis</TableCell>
                      <TableCell className="text-xs">No key</TableCell>
                      <TableCell className="text-xs">Unlimited</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">Solana RPC</TableCell>
                      <TableCell className="text-xs">Wallet balance, airdrop</TableCell>
                      <TableCell className="text-xs">No key</TableCell>
                      <TableCell className="text-xs">Varies</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">Jupiter Ultra</TableCell>
                      <TableCell className="text-xs">Live swaps (mainnet)</TableCell>
                      <TableCell className="text-xs">No key</TableCell>
                      <TableCell className="text-xs">Varies</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* MODULES */}
        <TabsContent value="modules" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Puzzle className="h-5 w-5" /> Modules — Detailed Reference
              </CardTitle>
              <CardDescription>All backend modules at a glance</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* config.ts */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-mono">src/config.ts</CardTitle>
                  <CardDescription>Central configuration</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Reads <code className="bg-muted px-1 rounded">.env</code> via <code className="bg-muted px-1 rounded">dotenv</code> and exports a typed <code className="bg-muted px-1 rounded">CONFIG</code> object.
                  </p>
                   <pre className="bg-muted p-3 rounded-lg font-mono text-xs overflow-x-auto">
{`export const CONFIG = {
  RPC_URL: string,              // Solana RPC endpoint
  WALLET_PRIVATE_KEY: string,   // Base58-encoded secret key
  SOL_MINT: string,             // Native SOL mint
  JUPITER_ULTRA_URL: string,    // Jupiter Ultra API (for live trades)
  DEXSCREENER_URL: string,      // DexScreener price API
  POLL_INTERVAL_MS: number,     // Polling interval in ms (default: 2000)
} as const;`}
                   </pre>
                </CardContent>
              </Card>

              {/* wallet.ts */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-mono">src/wallet.ts</CardTitle>
                  <CardDescription>Keypair management and Devnet connection</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Standalone executable: <code className="bg-muted px-1 rounded">npx tsx src/wallet.ts</code>
                  </p>
                   <ul className="text-sm space-y-1 list-disc list-inside">
                     <li><code className="font-mono">loadOrCreateKeypair()</code> — Reads <code>WALLET_PRIVATE_KEY</code> from .env. If empty: generates a new keypair.</li>
                     <li><code className="font-mono">getTokenBalance(mintAddress)</code> — Queries token balance for any mint address.</li>
                     <li><code className="font-mono">main()</code> — Shows public key, SOL balance. Requests Devnet airdrop if SOL &lt; 0.5.</li>
                   </ul>
                  <p className="text-xs text-muted-foreground font-mono bg-muted p-2 rounded">
                    Bot Wallet (Devnet): 5AiQFtjk2U6EzvqzUxX1MQghTQZTWU1rkZ6oxx2eCBPg
                  </p>
                </CardContent>
              </Card>

              {/* priceFeed.ts */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-mono">src/priceFeed.ts</CardTitle>
                  <CardDescription>Polling-based price feed via DexScreener API</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground mb-2">
                    <strong>Class: <code>PriceFeed</code></strong>
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Method</TableHead>
                        <TableHead>Description</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-mono text-xs">start(onPrice)</TableCell>
                        <TableCell className="text-xs">Starts polling, calls callback per tick</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">stop()</TableCell>
                        <TableCell className="text-xs">Stops polling</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">getHistory()</TableCell>
                        <TableCell className="text-xs">Returns all collected <code>PricePoint[]</code></TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                  <pre className="bg-muted p-2 rounded font-mono text-xs">
{`interface PricePoint {
  timestamp: number,
  price: number
}`}
                  </pre>
                   <p className="text-xs text-muted-foreground">
                     API: <code>GET https://api.dexscreener.com/latest/dex/tokens/&lt;MINT_ADDRESS&gt;</code>
                   </p>
                </CardContent>
              </Card>

              {/* patternDetector.ts */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-mono">src/patternDetector.ts</CardTitle>
                  <CardDescription>Core logic: floor calculation + spike detection</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground mb-2">
                    <strong>Class: <code>PatternDetector</code></strong>
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Method</TableHead>
                        <TableHead>Description</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-mono text-xs">analyze(history)</TableCell>
                        <TableCell className="text-xs">Analyzes price history, returns <code>PatternResult</code></TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">updateSettings(partial)</TableCell>
                        <TableCell className="text-xs">Changes settings at runtime</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">reset()</TableCell>
                        <TableCell className="text-xs">Resets internal state</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                  <pre className="bg-muted p-3 rounded-lg font-mono text-xs overflow-x-auto">
{`interface PatternSettings {
  floorWindow: number,        // Ticks for median (default: 20)
  spikeThreshold: number,     // % above floor = spike (default: 0.3)
  sellDropThreshold: number,  // % drop from peak = sell (default: 0.15)
  cooldownTicks: number,      // Ticks pause after trade (default: 5)
}

interface PatternResult {
  signal: 'BUY' | 'SELL' | 'HOLD',
  floor: number,
  currentPrice: number,
  spikePercent: number,
  peakPrice: number,
  dropFromPeak: number,
}`}
                  </pre>
                  <p className="text-sm text-muted-foreground">
                    <strong>Algorithm:</strong> Floor = Median of last <code>floorWindow</code> prices → Spike% = (price - floor) / floor * 100 → State machine: WAITING → BUY → TRACKING → SELL → COOLDOWN
                  </p>
                </CardContent>
              </Card>

              {/* trader.ts */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-mono">src/trader.ts</CardTitle>
                  <CardDescription>Paper trading engine with simulated balances</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground mb-2">
                    <strong>Class: <code>Trader</code></strong>
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Method</TableHead>
                        <TableHead>Description</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-mono text-xs">handleSignal(result, settings)</TableCell>
                        <TableCell className="text-xs">Processes PatternResult, executes trade</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">getStats()</TableCell>
                        <TableCell className="text-xs">Returns <code>TraderStats</code> (balances, PnL, W/L)</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">getLogger()</TableCell>
                        <TableCell className="text-xs">Access to trade logger</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                   <pre className="bg-muted p-2 rounded font-mono text-xs">
{`// Constructor options
{ initialSOL?: 10, tradeSize?: 1, paperMode?: true, botId?: string }`}
                   </pre>
                   <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                     <li><strong>BUY:</strong> <code>tradeSize</code> SOL → Token</li>
                     <li><strong>SELL:</strong> Entire token position → SOL (calculate PnL%)</li>
                     <li>Only one position at a time per bot</li>
                   </ul>
                </CardContent>
              </Card>

              {/* agent.ts */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-mono">src/agent.ts</CardTitle>
                  <CardDescription>Correction Agent — automatic optimization</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground mb-2">
                    <strong>Class: <code>CorrectionAgent</code></strong>
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Method</TableHead>
                        <TableHead>Description</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-mono text-xs">analyze(trades, settings)</TableCell>
                        <TableCell className="text-xs">Checks trade log, returns <code>AgentAdvice</code> or <code>null</code></TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                  <p className="text-sm text-muted-foreground mt-2">Optimization rules:</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Condition</TableHead>
                        <TableHead>Adjustment</TableHead>
                        <TableHead>Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                       <TableRow>
                        <TableCell className="text-xs">Win rate &lt; 40%</TableCell>
                        <TableCell className="font-mono text-xs">spikeThreshold × 1.3</TableCell>
                        <TableCell className="text-xs">Tighten filter</TableCell>
                      </TableRow>
                       <TableRow>
                        <TableCell className="text-xs">Win rate &gt; 60%, PnL &lt; 0.5%</TableCell>
                        <TableCell className="font-mono text-xs">sellDropThreshold × 0.8</TableCell>
                        <TableCell className="text-xs">Sell earlier</TableCell>
                      </TableRow>
                       <TableRow>
                        <TableCell className="text-xs">Avg spike &gt; 3× threshold</TableCell>
                        <TableCell className="font-mono text-xs">sellDropThreshold × 0.7</TableCell>
                        <TableCell className="text-xs">Selling too late</TableCell>
                      </TableRow>
                       <TableRow>
                        <TableCell className="text-xs">Win rate &gt; 80% (&ge;5 sells)</TableCell>
                        <TableCell className="font-mono text-xs">spikeThreshold × 0.85</TableCell>
                        <TableCell className="text-xs">Enter more aggressively</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* ollamaAgent.ts */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-mono">src/ollamaAgent.ts</CardTitle>
                  <CardDescription>LLM-based agent for market analysis</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground mb-2">
                    <strong>Class: <code>OllamaAgent</code></strong>
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Method</TableHead>
                        <TableHead>Description</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-mono text-xs">connect(...)</TableCell>
                        <TableCell className="text-xs">Connect data sources</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">start() / stop()</TableCell>
                        <TableCell className="text-xs">Start/stop cyclic analysis</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">updateConfig(updates)</TableCell>
                        <TableCell className="text-xs">Change configuration at runtime</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">triggerAnalysis()</TableCell>
                        <TableCell className="text-xs">Trigger manual analysis</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">getStatus()</TableCell>
                        <TableCell className="text-xs">Status + config</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">listModels()</TableCell>
                        <TableCell className="text-xs">Available Ollama models</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                  <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                    <li>Regime detection: RANGING, TRENDING, DEAD, VOLATILE</li>
                    <li>Default: model <code>qwen3.5:4b</code>, cycle 21 min, temperature 0.3, min confidence 0.4</li>
                  </ul>
                </CardContent>
              </Card>

              {/* server.ts */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-mono">src/server.ts</CardTitle>
                  <CardDescription>HTTP server with SSE and REST API</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground mb-2">
                    <strong>Class: <code>BotServer</code></strong>
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Method</TableHead>
                        <TableHead>Description</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-mono text-xs">broadcast(state)</TableCell>
                        <TableCell className="text-xs">Sends BotState to all SSE clients</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">broadcastAgentAdvice(advice)</TableCell>
                        <TableCell className="text-xs">Sends agent event to SSE clients</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">setHandlers(...)</TableCell>
                        <TableCell className="text-xs">Registers settings/reset handlers</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">setRecorder(...)</TableCell>
                        <TableCell className="text-xs">Connects PriceRecorder</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">setOllamaAgent(...)</TableCell>
                        <TableCell className="text-xs">Connects OllamaAgent</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                  <p className="text-sm text-muted-foreground">
                    Port: Starts at 3000, automatically increments on port conflict (up to +10).
                  </p>
                </CardContent>
              </Card>

              {/* backtester.ts */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-mono">src/backtester.ts</CardTitle>
                  <CardDescription>Backtest engine for historical data</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground mb-2">
                    <strong>Class: <code>Backtester</code></strong>
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Method</TableHead>
                        <TableHead>Description</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-mono text-xs">start(onTick, onComplete)</TableCell>
                        <TableCell className="text-xs">Starts backtest with callbacks</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">stop()</TableCell>
                        <TableCell className="text-xs">Aborts running backtest</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">static generateReport(summary)</TableCell>
                        <TableCell className="text-xs">Generates markdown report</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                  <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                    <li>Speed modes: 1x, 5x, 10x, 50x, 100x, 200x, 500x, 0 (Instant)</li>
                    <li>Isolation: Separate instances per backtest</li>
                     <li>Log file: <code>logs/backtest-&lt;timestamp&gt;.jsonl</code></li>
                  </ul>
                </CardContent>
              </Card>
            </CardContent>
          </Card>
        </TabsContent>

        {/* STRATEGY */}
        <TabsContent value="strategy" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" /> Trading Strategy
              </CardTitle>
              <CardDescription>Range Spike Scalper — Algorithm and Signals</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-3">Core Concept</h3>
                <p className="text-muted-foreground mb-4">
                  The token price consolidates at a stable level (range floor) and makes regular short spikes upward (0.3%–3.7%).
                  The bot detects these spikes and trades the cycle:
                </p>
                <pre className="bg-muted p-4 rounded-lg font-mono text-xs overflow-x-auto leading-relaxed">
{`     Spike Peak (SELL)
        ╱╲
       ╱  ╲
      ╱    ╲──── Drop → Sell Signal
     ╱      ╲
────╱────────╲────────── Range Floor
   ▲                 ▲
  BUY               BUY`}
                </pre>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3">Signals</h3>
                <div className="space-y-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-green-500">BUY Signal</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground mb-2">Triggered when:</p>
                      <ol className="text-sm space-y-1 list-decimal list-inside">
                        <li>No active spike is running (<code>!inSpike</code>)</li>
                        <li><code>spikePercent &ge; spikeThreshold</code> (price deviates at least X% from floor)</li>
                        <li>No cooldown phase active</li>
                      </ol>
                      <p className="text-sm text-muted-foreground mt-2">
                        <strong>Action:</strong> Buy UGOR with <code>tradeSize</code> SOL
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-red-500">SELL Signal</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground mb-2">Triggered when:</p>
                      <ol className="text-sm space-y-1 list-decimal list-inside">
                        <li>A spike is active (<code>inSpike === true</code>)</li>
                        <li>Price has fallen from peak by <code>sellDropThreshold</code>%</li>
                      </ol>
                      <p className="text-sm text-muted-foreground mt-2">
                        <strong>Action:</strong> Sell entire UGOR position back to SOL. Then: <code>cooldownTicks</code> ticks pause.
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-muted-foreground">HOLD</CardTitle>
                    </CardHeader>
                    <CardContent>
                       <p className="text-sm text-muted-foreground">
                        All other situations, during data collection (&lt; <code>floorWindow</code> ticks), during cooldown after a sell.
                      </p>
                    </CardContent>
                  </Card>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3">Floor Calculation</h3>
                <p className="text-muted-foreground mb-3">
                  The floor is calculated as the <strong>median</strong> of the last <code>floorWindow</code> prices.
                </p>
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-sm font-semibold mb-2">Why median instead of average?</p>
                    <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                      <li>Median is robust against individual outliers/spikes</li>
                      <li>A single high spike skews the average, but not the median</li>
                      <li>The floor remains stable even when spikes occur</li>
                    </ul>
                    <pre className="bg-muted p-3 rounded-lg font-mono text-xs mt-3">
{`Example with floorWindow=5:
  Prices: [0.0129, 0.0129, 0.0135, 0.0129, 0.0129]
  Sorted: [0.0129, 0.0129, 0.0129, 0.0129, 0.0135]
  Median: 0.0129 ← correct, spike ignored
  Average: 0.01302 ← skewed by spike`}
                    </pre>
                  </CardContent>
                </Card>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3">State Machine</h3>
                <pre className="bg-muted p-4 rounded-lg font-mono text-xs overflow-x-auto leading-relaxed">
{`                Spike% ≥ Threshold
    ┌──────────┐ ──────────────────────▶ ┌──────────────┐
    │ WAITING  │                         │  IN SPIKE    │
    │(no pos.) │ ◀─────────────────────  │(track peak)  │
    └──────────┘   Drop ≥ sellDrop       └──────────────┘
         ▲              │
         │              ▼
    ┌──────────┐
    │ COOLDOWN │  (wait cooldownTicks ticks)
    └──────────┘`}
                </pre>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3">Risks and Limitations</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Current (Paper Mode)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                        <li>No slippage model</li>
                        <li>No orderbook impact</li>
                        <li>Polling latency (2s interval)</li>
                        <li>DexScreener delay</li>
                      </ul>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">For Live Trading</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                        <li>Slippage (Jupiter Ultra Dynamic)</li>
                        <li>Gas costs (~0.000005 SOL)</li>
                        <li>Rate limits (DexScreener)</li>
                        <li>MEV/Frontrunning</li>
                        <li>Limited liquidity</li>
                      </ul>
                    </CardContent>
                  </Card>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3">Optimization Opportunities</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Area</TableHead>
                      <TableHead>Improvement</TableHead>
                      <TableHead>Effort</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="text-xs">Price Feed</TableCell>
                      <TableCell className="text-xs">WebSocket instead of polling</TableCell>
                      <TableCell className="text-xs">Medium</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-xs">Floor</TableCell>
                      <TableCell className="text-xs">Weighted median / EMA</TableCell>
                      <TableCell className="text-xs">Low</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-xs">Signal</TableCell>
                      <TableCell className="text-xs">RSI/Volume confirmation</TableCell>
                      <TableCell className="text-xs">Medium</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-xs">Position</TableCell>
                      <TableCell className="text-xs">Partial sells (50% at peak)</TableCell>
                      <TableCell className="text-xs">Low</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-xs">Risk</TableCell>
                      <TableCell className="text-xs">Stop-loss at floor break</TableCell>
                      <TableCell className="text-xs">Low</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-xs">Backtesting</TableCell>
                      <TableCell className="text-xs">Historical data</TableCell>
                      <TableCell className="text-xs">High</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* CONFIGURATION */}
        <TabsContent value="configuration" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" /> Configuration
              </CardTitle>
              <CardDescription>Environment variables and trading parameters</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
               <div>
                 <h3 className="text-lg font-semibold mb-3">.env — Environment Variables</h3>
                 <pre className="bg-muted p-3 rounded-lg font-mono text-xs overflow-x-auto mb-3">
{`SOLANA_RPC_URL=https://api.devnet.solana.com
WALLET_PRIVATE_KEY=<base58-encoded-secret-key>
SOL_MINT=So11111111111111111111111111111111111111112
JUPITER_ULTRA_URL=https://lite.jup.ag/ultra/v1/
POLL_INTERVAL_MS=2000`}
                 </pre>
                 <Table>
                   <TableHeader>
                     <TableRow>
                       <TableHead>Variable</TableHead>
                       <TableHead>Description</TableHead>
                       <TableHead>Default</TableHead>
                     </TableRow>
                   </TableHeader>
                   <TableBody>
                     <TableRow>
                       <TableCell className="font-mono text-xs">SOLANA_RPC_URL</TableCell>
                       <TableCell className="text-xs">Solana RPC endpoint</TableCell>
                       <TableCell className="font-mono text-xs">https://api.devnet.solana.com</TableCell>
                     </TableRow>
                     <TableRow>
                       <TableCell className="font-mono text-xs">WALLET_PRIVATE_KEY</TableCell>
                       <TableCell className="text-xs">Bot wallet secret key (Base58)</TableCell>
                       <TableCell className="text-xs">—</TableCell>
                     </TableRow>
                     <TableRow>
                       <TableCell className="font-mono text-xs">SOL_MINT</TableCell>
                       <TableCell className="text-xs">Native SOL mint</TableCell>
                       <TableCell className="font-mono text-xs">So1111...</TableCell>
                     </TableRow>
                     <TableRow>
                       <TableCell className="font-mono text-xs">JUPITER_ULTRA_URL</TableCell>
                       <TableCell className="text-xs">Jupiter Ultra API endpoint</TableCell>
                       <TableCell className="font-mono text-xs">https://lite.jup.ag/ultra/v1/</TableCell>
                     </TableRow>
                     <TableRow>
                       <TableCell className="font-mono text-xs">POLL_INTERVAL_MS</TableCell>
                       <TableCell className="text-xs">Price polling interval</TableCell>
                       <TableCell className="font-mono text-xs">2000</TableCell>
                     </TableRow>
                   </TableBody>
                 </Table>
                <p className="text-xs text-red-400 mt-3">
                  <strong>Important:</strong> <code>.env</code> contains the private key and must <strong>never</strong> be committed.
                </p>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3">PatternSettings — Trading Parameters</h3>
                <p className="text-muted-foreground mb-3">
                  These parameters control spike detection and can be adjusted at runtime via <code>[s]</code> in the dashboard.
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Parameter</TableHead>
                      <TableHead>Default</TableHead>
                      <TableHead>Range</TableHead>
                      <TableHead>Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-mono text-xs">floorWindow</TableCell>
                      <TableCell className="text-xs">20</TableCell>
                      <TableCell className="font-mono text-xs">5–100</TableCell>
                      <TableCell className="text-xs">Number of ticks for floor calculation. Larger values = more stable floor.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">spikeThreshold</TableCell>
                      <TableCell className="text-xs">0.3%</TableCell>
                      <TableCell className="font-mono text-xs">0.1–5.0%</TableCell>
                      <TableCell className="text-xs">Minimum deviation from floor. Higher = fewer trades.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">sellDropThreshold</TableCell>
                      <TableCell className="text-xs">0.15%</TableCell>
                      <TableCell className="font-mono text-xs">0.05–1.0%</TableCell>
                      <TableCell className="text-xs">Drop from peak for sell. Smaller = sell earlier.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">cooldownTicks</TableCell>
                      <TableCell className="text-xs">5</TableCell>
                      <TableCell className="font-mono text-xs">0–50</TableCell>
                      <TableCell className="text-xs">Ticks pause after sell. Prevents overtrading.</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>

                <div className="mt-4">
                  <h4 className="text-sm font-semibold mb-2">Parameter Interaction</h4>
                  <pre className="bg-muted p-4 rounded-lg font-mono text-xs overflow-x-auto leading-relaxed">
{`Price
  │
  │         Peak ─────┐
  │        ╱           │ ← sellDropThreshold (0.15%)
  │       ╱            ▼
  │      ╱ Spike   Sell Signal
  │     ╱
  │────╱───── spikeThreshold (0.3%) ── BUY Signal
  │
  │═══════════════ Floor (Median)
  │
  └────────────────────────────── Time
        ◀──────────▶
         floorWindow`}
                  </pre>
                </div>

                <div className="mt-4">
                  <h4 className="text-sm font-semibold mb-2">Tuning Recommendations</h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Market Phase</TableHead>
                        <TableHead>floorWindow</TableHead>
                        <TableHead>spikeThreshold</TableHead>
                        <TableHead>sellDropThreshold</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="text-xs">High volatility</TableCell>
                        <TableCell className="font-mono text-xs">10–15</TableCell>
                        <TableCell className="font-mono text-xs">0.5–1.0%</TableCell>
                        <TableCell className="font-mono text-xs">0.2–0.3%</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-xs">Low volatility</TableCell>
                        <TableCell className="font-mono text-xs">25–40</TableCell>
                        <TableCell className="font-mono text-xs">0.2–0.3%</TableCell>
                        <TableCell className="font-mono text-xs">0.1–0.15%</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-xs">Sideways (range)</TableCell>
                        <TableCell className="font-mono text-xs">20</TableCell>
                        <TableCell className="font-mono text-xs">0.3%</TableCell>
                        <TableCell className="font-mono text-xs">0.15%</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-xs">Strong trend</TableCell>
                        <TableCell className="font-mono text-xs">30–50</TableCell>
                        <TableCell className="font-mono text-xs">1.0–2.0%</TableCell>
                        <TableCell className="font-mono text-xs">0.3–0.5%</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3">Trader Options</h3>
                <p className="text-muted-foreground mb-3">
                  Set in <code>src/index.ts</code> at startup:
                </p>
                <pre className="bg-muted p-3 rounded-lg font-mono text-xs overflow-x-auto">
{`const trader = new Trader({
  initialSOL: 10,     // Simulated starting capital
  tradeSize: 1,       // SOL per trade
  paperMode: true,    // Paper trading (no real money)
});`}
                </pre>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Option</TableHead>
                      <TableHead>Default</TableHead>
                      <TableHead>Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-mono text-xs">initialSOL</TableCell>
                      <TableCell className="text-xs">10</TableCell>
                      <TableCell className="text-xs">Starting capital in SOL (paper mode)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">tradeSize</TableCell>
                      <TableCell className="text-xs">1</TableCell>
                      <TableCell className="text-xs">SOL amount per trade</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">paperMode</TableCell>
                      <TableCell className="text-xs">true</TableCell>
                      <TableCell className="text-xs"><code>true</code> = simulation, <code>false</code> = real trades</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3">Correction Agent — Automatic Optimization</h3>
                <p className="text-muted-foreground mb-3">
                  The agent intervenes <strong>after each completed trade</strong> and analyzes the last 20 trades.
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Trigger</TableHead>
                      <TableHead>Change</TableHead>
                      <TableHead>Limits</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                     <TableRow>
                      <TableCell className="text-xs">Win rate &lt; 40%</TableCell>
                      <TableCell className="font-mono text-xs">spikeThreshold +30%</TableCell>
                      <TableCell className="font-mono text-xs">Max 5.0%</TableCell>
                    </TableRow>
                     <TableRow>
                      <TableCell className="text-xs">Win rate &gt; 60%, PnL &lt; 0.5%</TableCell>
                      <TableCell className="font-mono text-xs">sellDropThreshold -20%</TableCell>
                      <TableCell className="font-mono text-xs">Min 0.05%</TableCell>
                    </TableRow>
                     <TableRow>
                      <TableCell className="text-xs">Avg spike &gt; 3× threshold</TableCell>
                      <TableCell className="font-mono text-xs">sellDropThreshold -30%</TableCell>
                      <TableCell className="font-mono text-xs">Min 0.05%</TableCell>
                    </TableRow>
                     <TableRow>
                      <TableCell className="text-xs">Win rate &gt; 80% (&ge;5 sells)</TableCell>
                      <TableCell className="font-mono text-xs">spikeThreshold -15%</TableCell>
                      <TableCell className="font-mono text-xs">Min 0.1%</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                <p className="text-sm text-muted-foreground mt-3">
                  The agent starts only after at least <strong>5 trades</strong> and <strong>3 sells</strong>.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* OPERATIONS */}
        <TabsContent value="operations" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" /> Operations
              </CardTitle>
              <CardDescription>Starting, dashboard, backtesting, AI agent</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-3">Prerequisites</h3>
                <ul className="text-muted-foreground space-y-1 list-disc list-inside">
                  <li>Node.js v22+</li>
                  <li>npm dependencies installed (<code>npm install</code>)</li>
                  <li>.env present (auto-populated on first <code>wallet.ts</code> run)</li>
                  <li>Ollama (optional, for AI agent): <code>ollama serve</code> or Docker container on port 11434</li>
                </ul>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3">Starting</h3>
                <pre className="bg-muted p-3 rounded-lg font-mono text-xs overflow-x-auto mb-3">
{`# Full bot with dashboard + Web UI + AI agent
npx tsx src/index.ts

# Test wallet only (balance, airdrop)
npx tsx src/wallet.ts

# Test price feed only (10 ticks)
npx tsx src/priceFeed.ts`}
                </pre>
                <p className="text-muted-foreground">
                  On start: PriceFeed polls every 2s, PriceRecorder writes to <code>data/prices.jsonl</code>,
                  PatternDetector analyzes, Trader reacts, BotServer starts HTTP server (port 3000),
                  OllamaAgent checks availability and starts 21-min cycle.
                </p>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3">Terminal Dashboard</h3>
                <pre className="bg-muted p-4 rounded-lg font-mono text-xs overflow-x-auto leading-relaxed mb-4">
{`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Scalpatron Multi-Bot Trading  [PAPER]       ← Mode
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Price    $0.01290000  03:51:28             ← Live price
  Floor    $0.01289500                       ← Calculated floor
  Spike    0.039%                            ← Deviation (green ≥ threshold)
  Signal   HOLD                              ← BUY/SELL/HOLD (color coded)

  Chart    ▁▁▂▃▅▇█▇▅▃▂▁▁▁▂▃▅▆▅▃▂          ← Sparkline (last 40 ticks)

────────────────────────────────────────────────
  SOL      10.0000    Token  0              ← Balances
  Trades   0  W:0 L:0  PnL: 0.00%           ← Performance

────────────────────────────────────────────────
  Recent Trades                              ← Trade history
  03:52:14 BUY  $0.01292000
  03:52:28 SELL $0.01295000 +0.23%

────────────────────────────────────────────────
  Settings  floor:20 spike:0.3% drop:0.15% cd:5
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [q]uit  [s]ettings  [r]eset  [p]aper/live`}
                </pre>

                <h4 className="text-sm font-semibold mb-2">Keyboard Shortcuts</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Key</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-mono text-xs">s</TableCell>
                      <TableCell className="text-xs">Settings</TableCell>
                      <TableCell className="text-xs">Pause feed → parameter dialog → restart feed</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">r</TableCell>
                      <TableCell className="text-xs">Reset</TableCell>
                      <TableCell className="text-xs">PatternDetector to default settings</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">p</TableCell>
                      <TableCell className="text-xs">Paper/Live</TableCell>
                      <TableCell className="text-xs">Toggle paper mode</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">q</TableCell>
                      <TableCell className="text-xs">Quit</TableCell>
                      <TableCell className="text-xs">Stop feed, print statistics, exit</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">Ctrl+C</TableCell>
                      <TableCell className="text-xs">Quit</TableCell>
                      <TableCell className="text-xs">Same as <code>q</code></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3">Web Dashboard</h3>
                <p className="text-muted-foreground mb-3">
                  Accessible at <code>http://localhost:3000</code> (automatically uses next free port).
                </p>
                <div className="space-y-3">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">1. Live Dashboard</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                        <li>Real-time data via SSE (every ~2 seconds)</li>
                        <li>Price, floor, spike%, signal (color coded)</li>
                        <li>Sparkline chart of last 60 prices</li>
                        <li>Balances, trade statistics (wins/losses/PnL)</li>
                        <li>Last 10 trades</li>
                      </ul>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">2. Settings</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                        <li>Sliders for all 4 pattern settings</li>
                        <li>Changes sent immediately to live bot</li>
                        <li>Reset button restores defaults</li>
                      </ul>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">3. Backtesting</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        See section <strong>Backtesting</strong> below.
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">4. AI Agent</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        See section <strong>AI Agent Operations</strong> below.
                      </p>
                    </CardContent>
                  </Card>
                </div>

                <h4 className="text-sm font-semibold mt-4 mb-2">API Endpoints</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Endpoint</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-mono text-xs">/api/stream</TableCell>
                      <TableCell className="text-xs">GET (SSE)</TableCell>
                      <TableCell className="text-xs">Live bot state every ~2s</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">/api/state</TableCell>
                      <TableCell className="text-xs">GET</TableCell>
                      <TableCell className="text-xs">Current bot state as JSON</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">/api/settings</TableCell>
                      <TableCell className="text-xs">POST</TableCell>
                      <TableCell className="text-xs">Change pattern settings</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">/api/reset</TableCell>
                      <TableCell className="text-xs">POST</TableCell>
                      <TableCell className="text-xs">Reset settings to defaults</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">/api/backtest/data-range</TableCell>
                      <TableCell className="text-xs">GET</TableCell>
                      <TableCell className="text-xs">Available price data time range</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">/api/backtest/start</TableCell>
                      <TableCell className="text-xs">POST</TableCell>
                      <TableCell className="text-xs">Start backtest</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">/api/backtest/stop</TableCell>
                      <TableCell className="text-xs">POST</TableCell>
                      <TableCell className="text-xs">Stop backtest</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">/api/backtest/stream</TableCell>
                      <TableCell className="text-xs">GET (SSE)</TableCell>
                      <TableCell className="text-xs">Backtest state stream</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">/api/backtest/report</TableCell>
                      <TableCell className="text-xs">GET</TableCell>
                      <TableCell className="text-xs">Markdown report</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">/api/backtest/import</TableCell>
                      <TableCell className="text-xs">POST</TableCell>
                      <TableCell className="text-xs">Import historical data</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">/api/agent/status</TableCell>
                      <TableCell className="text-xs">GET</TableCell>
                      <TableCell className="text-xs">Agent status + config</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">/api/agent/models</TableCell>
                      <TableCell className="text-xs">GET</TableCell>
                      <TableCell className="text-xs">Available Ollama models</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">/api/agent/config</TableCell>
                      <TableCell className="text-xs">POST</TableCell>
                      <TableCell className="text-xs">Change agent configuration</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">/api/agent/trigger</TableCell>
                      <TableCell className="text-xs">POST</TableCell>
                      <TableCell className="text-xs">Manual analysis</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">/api/agent/start</TableCell>
                      <TableCell className="text-xs">POST</TableCell>
                      <TableCell className="text-xs">Start agent</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">/api/agent/stop</TableCell>
                      <TableCell className="text-xs">POST</TableCell>
                      <TableCell className="text-xs">Stop agent</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">/api/agent/history</TableCell>
                      <TableCell className="text-xs">GET</TableCell>
                      <TableCell className="text-xs">All recommendations</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3">Backtesting</h3>

                <h4 className="text-sm font-semibold mb-2">Prerequisites</h4>
                <p className="text-muted-foreground mb-3">
                  Price data must be available in <code>data/prices.jsonl</code>.
                  Data is collected automatically once the bot is running.
                </p>

                <h4 className="text-sm font-semibold mb-2">Import Historical Data</h4>
                <p className="text-muted-foreground mb-2">
                  In the backtesting tab of the web dashboard: select hours (1–72h), click "Start Import".
                </p>
                <pre className="bg-muted p-2 rounded font-mono text-xs mb-4">
{`curl -X POST http://localhost:3000/api/backtest/import \\
  -H 'Content-Type: application/json' \\
  -d '{"hours": 24}'`}
                </pre>

                <h4 className="text-sm font-semibold mb-2">Running a Backtest</h4>
                <ol className="text-muted-foreground space-y-1 list-decimal list-inside mb-4">
                  <li>Open web dashboard → tab "Backtesting"</li>
                  <li>Data range is displayed automatically</li>
                  <li>Select time range (from/to date + time)</li>
                  <li>Select speed: 1x, 5x, 10x, 50x, 100x, 200x, 500x, Instant</li>
                  <li>Configure settings (independent from live bot)</li>
                  <li>Additional config: initialSOL, tradeSize, agent on/off</li>
                  <li>Click "Start Backtest"</li>
                </ol>

                <h4 className="text-sm font-semibold mb-2">During Backtest</h4>
                <ul className="text-muted-foreground space-y-1 list-disc list-inside mb-4">
                  <li>Progress bar shows progress 0–100%</li>
                  <li>Live dashboard shows backtest data</li>
                  <li>The live bot is <strong>not</strong> affected</li>
                  <li>"Stop Backtest" aborts early</li>
                </ul>

                <h4 className="text-sm font-semibold mb-2">Result</h4>
                <p className="text-muted-foreground mb-2">
                  After completion: summary with trades, wins, losses, win rate, PnL%, SOL final balance, price range, duration.
                </p>
                <pre className="bg-muted p-2 rounded font-mono text-xs">
{`curl http://localhost:3000/api/backtest/report > backtest-report.md`}
                </pre>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3">AI Agent Operations</h3>

                <h4 className="text-sm font-semibold mb-2">Prerequisites</h4>
                <ul className="text-muted-foreground space-y-1 list-disc list-inside mb-4">
                  <li>Ollama installed and accessible at <code>http://localhost:11434</code></li>
                  <li>Model available (default: <code>qwen3.5:4b</code>)</li>
                  <li>Install model: <code>ollama pull qwen3.5:4b</code></li>
                </ul>

                <h4 className="text-sm font-semibold mb-2">Configure Agent</h4>
                <p className="text-muted-foreground mb-2">
                  In the web dashboard → tab "AI Agent":
                </p>
                <ul className="text-muted-foreground space-y-1 list-disc list-inside mb-4">
                  <li>Select model (dropdown)</li>
                  <li>Set cycle (default: 21 minutes)</li>
                  <li>Temperature (0.0–1.0, default: 0.3)</li>
                  <li>Min confidence (0.0–1.0, default: 0.4)</li>
                  <li>Auto-apply on/off (automatically apply recommendations)</li>
                </ul>

                <h4 className="text-sm font-semibold mb-2">Start/Stop Agent</h4>
                <ul className="text-muted-foreground space-y-1 list-disc list-inside mb-4">
                  <li>In web dashboard: "Start Agent" / "Stop Agent" button</li>
                  <li>Or via API: <code>POST /api/agent/start</code> or <code>/stop</code></li>
                  <li>Trigger manual analysis: <code>POST /api/agent/trigger</code></li>
                </ul>

                <h4 className="text-sm font-semibold mb-2">View Recommendations</h4>
                <p className="text-muted-foreground">
                  In web dashboard → tab "AI Agent" → "Recommendation History".
                  Each recommendation shows: regime detection, confidence, proposed settings, reasoning.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
