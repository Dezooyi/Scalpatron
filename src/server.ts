import http from 'http';
import type { BotManager } from './botManager.js';
import { PriceRecorder } from './priceRecorder.js';
import { logger } from './appLogger.js';
import { getAdvisorSuggestions } from './advisorEngine.js';
import { TokenService, isValidMintAddress, saveTokenToDb } from './tokenService.js';
import { getSetting, setSetting, getRegimePerformance, listStrategies, saveStrategy, getStrategy, deleteStrategy, getDetailedLiveFeedStats, wipeLiveFeed, setBotStrategy, saveBotOrder, getBotOrder, deleteBotOrder, getTradesForPerformance, getTimeWindowPerformance, detectTimeWindowDrift, getLessonsForBot, saveUiSettings, loadUiSettings, type UiSettings } from './db.js';
import { loadBuiltinTemplates } from './strategyEngine.js';
import { PriceFeed, SLOT_MS } from './priceFeed.js';
import type { OllamaAgent } from './ollamaAgent.js';
import { buildSystemPrompt } from './ollamaAgent.js';
import { validateStrategy } from './strategy.js';
import { DEFAULT_SETTINGS } from './patternDetector.js';
import { CONFIG } from './config.js';
import { walletService, type RangeKey, getSolscanUrl } from './walletService.js';
import { getTradesForWallet } from './db.js';

const DEFAULT_GLOBAL_SETTINGS = {
  floorWindow: DEFAULT_SETTINGS.floorWindow,
  spikeThreshold: DEFAULT_SETTINGS.spikeThreshold,
  sellDropThreshold: DEFAULT_SETTINGS.sellDropThreshold,
  cooldownTicks: DEFAULT_SETTINGS.cooldownTicks,
  initialSOL: 10,
  tradeSize: 1,
  aggressiveness: 10,
  tradingMode: "fixed" as "fixed" | "aggressive",
  paperMode: true,
};

// ADR-022 (M3): Gebundener TTL+LRU-Cache. Ersetzt die früheren unbounded Maps
// (responseCache Map + bodyParserCache mit Date.now()-Key, die über Stunden den
// Heap aufblähten). max begrenzt die Einträge; abgelaufene werden lazily beim
// get() entfernt, überschüssige am ältesten Ende (Map-Insertion-Order) evictet.
class BoundedTTLCache {
  private map = new Map<string, { data: any; expiresAt: number }>();
  constructor(private readonly max: number) {}

  get(key: string): any | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return null;
    }
    // LRU: Position auffrischen.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.data;
  }

  set(key: string, data: any, ttlMs: number): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { data, expiresAt: Date.now() + ttlMs });
    while (this.map.size > this.max) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) break;
      this.map.delete(oldestKey);
    }
  }
}

const responseCache = new BoundedTTLCache(256);

function getCachedResponse<T>(key: string): T | null {
  return responseCache.get(key) as T | null;
}

function setCachedResponse<T>(key: string, data: T, ttlMs: number): void {
  responseCache.set(key, data, ttlMs);
}

// ADR-022 (M1): Vergleicht zwei Werte auf Wertgleichheit. Primitive direkt,
// Objekte/Arrays via JSON.stringify (Top-Level-Felder wie settings/stats/
// strategyConfig werden als ganze Werte verglichen — siehe Delta-Diff).
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return a === b;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

// ADR-022 (M3): Request Body Parser OHNE Cache. Der frühere bodyParserCache
// nutzte Date.now() im Key → jeder Request erzeugte einen neuen Eintrag →
// unbounded growth. Body-Parsing ist billig, Caching hier bringt keinen Wert.
async function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e: any) {
        reject(new Error(`Invalid JSON: ${e.message}`));
      }
    });
    req.on('error', reject);
  });
}

export class BotServer {
  private sseClients: Set<http.ServerResponse> = new Set();
  private botManager: BotManager;
  private recorder: PriceRecorder;
  private tokenService: TokenService;
  private priceFeed: PriceFeed;
  private ollamaAgent: OllamaAgent | null = null;
  // ADR-022 (M1): Delta-State-Baseline. lastSentStateById hält den zuletzt an
  // die Clients serialisierten Bot-State (keyed by bot.id). stateSeq ist der
  // monotone Sequenz-Zähler für state/state_delta Events.
  private lastSentStateById: Map<string, any> = new Map();
  private stateSeq = 0;

  constructor(botManager: BotManager, recorder: PriceRecorder, port = 3000) {
    this.botManager = botManager;
    this.recorder = recorder;
    this.tokenService = TokenService.getInstance();
    this.priceFeed = PriceFeed.getInstance();
    // Connect logger to SSE
    logger.setSSECallback((entry) => {
      this.broadcast('terminal_log', entry);
    });

    // ADR-010: Price-Feed-Outage an alle SSE-Clients weiterleiten (für UI-Badge).
    this.priceFeed.on('price_stale', (payload) => {
      this.broadcast('price_stale', payload);
    });

    // ADR-015: Periodischer Wallet-Balance-Snapshot (alle 5 Min)
    walletService.startSnapshotScheduler();
    setTimeout(() => {
      walletService.snapshotBalances().catch(() => {});
    }, 10_000);

    // Periodisch Token-Preise von DexScreener aktualisieren (alle 60 Sekunden)
    setInterval(() => {
      this.tokenService.refreshAllTokenPrices().catch(() => {});
    }, 60_000);

    // Performance: SSE Broadcast Throttling
    this.setupSSEThrottling();

    this.startListening(port);
  }

  /**
   * ADR-022 (M1): SSE Broadcast mit Throttling + Delta-Diff für 'state'.
   *
   * Statt jede Sekunde den VOLLSTÄNDIGEN Bot-State-Baum zu serialisieren, wird
   * nur geändertes je Bot berechnet: Top-Level-Felder werden als ganze Werte
   * gepatcht (I1: settings/strategyConfig bleiben ganze Objekte — wichtig für
   * das Dirty-Tracking der Self-Opt-Panels). Strukturelle Änderungen (Bot
   * hinzugefügt/entfernt) → Voll-State. Sequence-Brüche heilt das Frontend via
   * Full-Resync (I2). Trading-Pfad wird nicht berührt (Display-Projektion).
   */
  private setupSSEThrottling(): void {
    let lastBroadcastTime = 0;
    const SSE_THROTTLE_MS = 200; // Lower throttle for faster UI responsiveness

    const originalBroadcast = this.broadcast.bind(this);
    this.broadcast = (eventName: string, data: any): void => {
      const now = Date.now();

      // Delta-Pfad nur für 'state'; alle anderen Events unverändert.
      if (eventName === 'state') {
        if (now - lastBroadcastTime < SSE_THROTTLE_MS) {
          return; // I4: Trade-Loop hat Vorrang; Throttle entlastet Clients.
        }
        lastBroadcastTime = now;

        const fullState: any[] = Array.isArray(data) ? data : [];
        const newById = new Map<string, any>();
        for (const bot of fullState) {
          if (bot && typeof bot.id === 'string') newById.set(bot.id, bot);
        }

        // Strukturelle Änderung (Bot-Set verändert) → Voll-State senden.
        const oldIds = this.lastSentStateById;
        let structuralChange = oldIds.size !== newById.size;
        if (!structuralChange) {
          for (const id of newById.keys()) {
            if (!oldIds.has(id)) { structuralChange = true; break; }
          }
        }
        if (structuralChange) {
          this.stateSeq++;
          originalBroadcast('state', { seq: this.stateSeq, full: true, bots: fullState });
          this.lastSentStateById = newById;
          return;
        }

        // Inkrementeller Diff je Bot.
        const patches: any[] = [];
        for (const bot of fullState) {
          const old = oldIds.get(bot.id);
          const patch: any = {};
          let changed = false;
          for (const key of Object.keys(bot)) {
            const newVal = bot[key];
            if (old === undefined || !jsonEqual(newVal, old[key])) {
              patch[key] = newVal; // ganzes Feld (I1)
              changed = true;
            }
          }
          if (changed) {
            patch.id = bot.id;
            patches.push(patch);
            oldIds.set(bot.id, bot);
          }
        }

        if (patches.length > 0) {
          this.stateSeq++;
          originalBroadcast('state_delta', { seq: this.stateSeq, patches });
        }
        return;
      }

      originalBroadcast(eventName, data);
    };
  }

  private startListening(startPort: number): void {
    let port = startPort;
    const tryNext = () => {
      const srv = http.createServer((req, res) => this.handleRequest(req, res));
      srv.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && port < startPort + 10) {
          port++;
          tryNext();
        } else {
          console.error(`[Server] Fehler: ${err.message}`);
        }
      });
      // Security: Bind to all interfaces to handle localhost resolution correctly (IPv4/IPv6)
      srv.listen(port, () => {
        console.log(`[Server] API gebunden an Port ${port}`);
        console.log(`[Server] Lokal erreichbar unter: http://localhost:${port}`);
      });
    };
    tryNext();
  }

  public broadcast(eventName: string, data: any): void {
    const payload = JSON.stringify(data);
    const message = `event: ${eventName}\ndata: ${payload}\n\n`;
    
    // Performance: Batch write to all clients
    const clientsToRemove: http.ServerResponse[] = [];
    
    for (const client of this.sseClients) {
      try {
        client.write(message);
      } catch (e) {
        // Client disconnected, mark for removal
        clientsToRemove.push(client);
      }
    }
    
    // Cleanup disconnected clients
    for (const client of clientsToRemove) {
      this.sseClients.delete(client);
    }
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = req.url ?? '/';
    const urlObj = new URL(`http://localhost${url}`);
    const pathname = urlObj.pathname;

    // CORS headers - support EventSource and cross-origin development
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    // Performance: Add compression header for large responses
    res.setHeader('Vary', 'Accept-Encoding');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // SSE endpoint for global state
    if (url === '/api/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
      });
      this.sseClients.add(res);

      // ADR-022 (M1): Handshake sendet immer frischen Voll-State im neuen
      // Format ({seq, full, bots}) mit aktuellem stateSeq, damit der Client
      // eine korrekte Delta-Baseline hat. Sequence-Lücken heilt das Frontend
      // per Full-Resync (I2).
      const initialState = this.botManager.getAllStates();
      this.stateSeq++;
      res.write(`event: state\ndata: ${JSON.stringify({ seq: this.stateSeq, full: true, bots: initialState })}\n\n`);
      // Baseline für künftige Deltas setzen.
      this.lastSentStateById = new Map(initialState.map((b: any) => [b.id, b]));

      req.on('close', () => {
        this.sseClients.delete(res);
        res.end();
      });
      return;
    }

    // GET /api/bots - mit Response Caching
    if (url === '/api/bots' && req.method === 'GET') {
      const cached = getCachedResponse<any>('bots-list');
      if (cached) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(cached));
        return;
      }
      
      const state = this.botManager.getAllStates();
      setCachedResponse('bots-list', state, CONFIG.PRICE_FEED_TICKRATE_MS / 2);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state));
      return;
    }

    // GET /api/bots/order - Bot-Reihenfolge aus Datenbank laden
    if (url === '/api/bots/order' && req.method === 'GET') {
      try {
        const order = getBotOrder();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ order }));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // POST /api/bots/reorder - Bot-Reihenfolge in Datenbank speichern
    if (url === '/api/bots/reorder' && req.method === 'POST') {
      parseBody(req).then(({ botIds }: { botIds: string[] }) => {
        try {
          if (!Array.isArray(botIds)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'botIds must be an array' }));
            return;
          }
          saveBotOrder(botIds);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      }).catch((e: any) => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      });
      return;
    }

    // GET /api/bot/:id/livefeed - Live Feed Statistiken für einen Bot (mit Caching)
    if (url.startsWith('/api/bot/') && url.endsWith('/livefeed') && req.method === 'GET') {
      const botId = url.split('/')[3];
      const cacheKey = `livefeed:${botId}`;
      
      // Check cache first (TTL: 5 seconds)
      const cached = getCachedResponse<any>(cacheKey);
      if (cached) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(cached));
        return;
      }
      
      const bot = this.botManager.getBot(botId);
      if (!bot) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bot not found' }));
        return;
      }
      try {
        const stats = getDetailedLiveFeedStats(bot.mintAddress);
        setCachedResponse(cacheKey, stats, 5000);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stats));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // GET /api/config - Server Konfiguration anzeigen (für Debugging)
    if (url === '/api/config' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        priceFeedProvider: CONFIG.PRICE_FEED_PROVIDER,
        priceFeedSlotMs: SLOT_MS,
        priceFeedSafeRpm: 55,
        priceFeedActiveMints: this.priceFeed.getActiveMintCount(),
        priceFeedEffectiveIntervalMs: this.priceFeed.getEffectiveIntervalMs(),
        priceFeedUrl: CONFIG.PRICE_FEED_PROVIDER === 'custom' ? '[REDACTED]' : CONFIG.PRICE_FEED_URL,
        pollIntervalMs: CONFIG.POLL_INTERVAL_MS,
        rpcUrl: CONFIG.RPC_URL,
        ollamaUrl: CONFIG.OLLAMA_URL,
        ollamaModel: CONFIG.OLLAMA_MODEL,
      }));
      return;
    }

    // POST /api/bots - mit optimiertem Body Parser
    if (url === '/api/bots' && req.method === 'POST') {
      parseBody(req).then((config) => {
        try {
          // Pre-Flight für Live-Mode: ohne Private-Key + erreichbarer RPC
          // würde der erste Trade erst zur Laufzeit fehlschlagen.
          if (config.paperMode === false) {
            if (!CONFIG.WALLET_PRIVATE_KEY) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Live-Mode aktiviert, aber WALLET_PRIVATE_KEY fehlt in .env — Importiere zuerst einen Key unter Wallet → Settings.' }));
              return;
            }
            const tradeSize = Number(config.tradeSize);
            const aggressiveness = Number(config.aggressiveness);
            if (Number.isFinite(tradeSize) && tradeSize > 0 && tradeSize < 0.05) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `tradeSize ${tradeSize} SOL ist kleiner als die Tx-Fee-Reserve (0.05 SOL). Erhöhe den Wert oder wechsle in den Aggressive-Modus.` }));
              return;
            }
            if (Number.isFinite(aggressiveness) && aggressiveness >= 100) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Aggressiveness 100% würde die komplette Wallet drainen. Max 90% empfohlen (Reserve für SELL-Tx-Fees).' }));
              return;
            }
          }
          const bot = this.botManager.createBot(config);
          // Auto-add token to whitelist so name resolves in the dashboard grid.
          const mint: string = config.mintAddress ?? '';
          if (mint && isValidMintAddress(mint)) {
            const existing = this.tokenService.getToken(mint);
            if (!existing) {
              // If name/symbol were passed directly (e.g. from Advisor), save immediately.
              // Otherwise fall back to async DexScreener lookup.
              const knownName: string = config.tokenName ?? '';
              const knownSymbol: string = config.tokenSymbol ?? '';
              if (knownName && knownSymbol) {
                saveTokenToDb({
                  mintAddress: mint,
                  name: knownName,
                  symbol: knownSymbol,
                  decimals: 6,
                  priceUsd: config.tokenPriceUsd ?? undefined,
                  volume24h: config.tokenVolume24h ?? undefined,
                  liquidity: config.tokenLiquidity ?? undefined,
                  createdAt: Date.now(),
                  isActive: true,
                });
              } else {
                this.tokenService.addToken(mint).catch(() => {});
              }
            }
          }
          this.broadcast('state', this.botManager.getAllStates());
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(bot.getState()));
        } catch (e: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      }).catch((e: any) => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      });
      return;
    }

    // POST /api/strategies/import - mit optimiertem Body Parser
    if (url === '/api/strategies/import' && req.method === 'POST') {
      parseBody(req).then((strategy) => {
        try {
          const validatedStrategy = validateStrategy(strategy);
          const bot = this.botManager.createBot({
            name: validatedStrategy.name,
            mintAddress: validatedStrategy.mintAddress,
            initialSOL: validatedStrategy.initialSOL ?? 10,
            paperMode: validatedStrategy.paperMode ?? true,
            settings: {
              ...DEFAULT_SETTINGS,
              floorWindow: validatedStrategy.parameters.floorWindow as number ?? DEFAULT_SETTINGS.floorWindow,
              spikeThreshold: validatedStrategy.parameters.spikeThreshold as number ?? DEFAULT_SETTINGS.spikeThreshold,
              sellDropThreshold: validatedStrategy.parameters.sellDropThreshold as number ?? DEFAULT_SETTINGS.sellDropThreshold,
              cooldownTicks: validatedStrategy.parameters.cooldownTicks as number ?? DEFAULT_SETTINGS.cooldownTicks
            }
          });

          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(bot.getState()));
        } catch (e: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      }).catch((e: any) => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      });
      return;
    }

    // DELETE /api/bots — delete ALL bots at once
    if (url === '/api/bots' && req.method === 'DELETE') {
      const allBots = this.botManager.getAllBots();
      for (const bot of allBots) {
        this.botManager.deleteBot(bot.getState().id);
        deleteBotOrder(bot.getState().id);
      }
      this.broadcast('state', []);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, deleted: allBots.length }));
      return;
    }

    // Dynamic routes /api/bots/:id/*
    const botMatch = url.match(/^\/api\/bots\/([^/]+)(\/([^?]*))?/);
    if (botMatch) {
      const id = botMatch[1];
      const action = botMatch[3]; // Path without query string
      const bot = this.botManager.getBot(id);

      if (!bot) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bot not found' }));
        return;
      }

      if (req.method === 'DELETE' && !action) {
        this.botManager.deleteBot(id);
        deleteBotOrder(id); // Auch Bot-Reihenfolge aus Datenbank löschen
        this.broadcast('state', this.botManager.getAllStates());
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      // DELETE /api/bots/:id/livefeed — wipe persistent price history for this bot's token
      if (req.method === 'DELETE' && action === 'livefeed') {
        const deleted = wipeLiveFeed(bot.mintAddress);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, deleted }));
        return;
      }

      // GET /api/bots/:id/indicators — live indicator values for strategy display
      if (req.method === 'GET' && action === 'indicators') {
        const data = bot.getIndicatorValues();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
        return;
      }

      // GET /api/bots/:id/history — price history for charts (memory optimization: not sent over SSE)
      if (req.method === 'GET' && action === 'history') {
        const limit = urlObj.searchParams.get('limit') ? parseInt(urlObj.searchParams.get('limit')!, 10) : 100;
        const feed = PriceFeed.getInstance();
        const fullHistory = feed.getHistory(bot.mintAddress);
        const history = fullHistory.slice(-limit).map((p: { timestamp: number; price: number }) => ({
          timestamp: p.timestamp,
          price: p.price
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ mintAddress: bot.mintAddress, limit, history }));
        return;
      }

      // GET /api/bots/:id/system-prompt — returns effective prompt + source + auto-preview
      if (req.method === 'GET' && action === 'system-prompt') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(bot.getSystemPromptInfo(buildSystemPrompt)));
        return;
      }

      // PUT /api/bots/:id/system-prompt — set or clear per-bot custom prompt
      if (req.method === 'PUT' && action === 'system-prompt') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const { systemPrompt } = JSON.parse(body) as { systemPrompt: string | null };
            if (systemPrompt === null || systemPrompt === '') {
              bot.clearCustomSystemPrompt();
            } else {
              bot.setCustomSystemPrompt(systemPrompt);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, source: bot.getSystemPromptSource() }));
          } catch (e) {
            res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
        return;
      }

      // POST /api/bots/:id/reset - Reset bot data (clear trades, prices, settings)
      if (req.method === 'POST' && action === 'reset') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
          try {
            const { clearTrades, clearPrices, resetSettings, restartBot } = JSON.parse(body);

            // Reset bot stats in memory (this also clears DB trades/prices if requested)
            bot.resetStats(clearTrades, clearPrices);

            if (clearTrades) {
              logger.info(id, 'SYSTEM', 'Trade-Historie gelöscht (Reset)');
            }

            if (clearPrices) {
              logger.info(id, 'SYSTEM', `Preisdaten gelöscht für ${bot.mintAddress.slice(0, 8)}...`);
            }

            // Reset settings to defaults
            if (resetSettings) {
              const { floorWindow, spikeThreshold, sellDropThreshold, cooldownTicks } = DEFAULT_GLOBAL_SETTINGS;
              this.botManager.updateBotSettings(id, { floorWindow, spikeThreshold, sellDropThreshold, cooldownTicks });
              logger.info(id, 'SYSTEM', 'Einstellungen auf Standard zurückgesetzt');
            }
            
            // Restart bot
            if (restartBot) {
              if (bot.status === 'running') {
                await bot.stop();
                await new Promise(resolve => setTimeout(resolve, 500));
                await bot.start();
                logger.info(id, 'SYSTEM', 'Bot neu gestartet');
              }
            }
            
            this.broadcast('state', this.botManager.getAllStates());
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } catch (e: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }

      if (req.method === 'PUT' && action === 'status') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const { status } = JSON.parse(body);
            this.botManager.updateBotStatus(id, status);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, status }));
          } catch (e: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }

      if (req.method === 'PUT' && action === 'settings') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const incoming = JSON.parse(body);
            // Pattern settings (killSwitch wird separat behandelt, nicht an PatternDetector durchreichen)
            const { tradeSize, aggressiveness, tradingMode, walletAddress, killSwitch, ...patternSettings } = incoming;
            if (Object.keys(patternSettings).length > 0) {
              this.botManager.updateBotSettings(id, patternSettings);
            }
            // Trade config
            if (tradeSize !== undefined || aggressiveness !== undefined || tradingMode !== undefined) {
              const current = bot.getState();
              this.botManager.updateBotTradeConfig(
                id,
                tradeSize ?? current.tradeSize,
                aggressiveness ?? current.aggressiveness,
                tradingMode ?? current.tradingMode,
              );
            }
            // Wallet address
            if (walletAddress !== undefined) {
              this.botManager.updateBotWalletAddress(id, walletAddress);
            }
            // Kill-Switch / Stop-Strategie Konfiguration
            if (killSwitch !== undefined) {
              this.botManager.updateBotKillSwitch(id, killSwitch);
            }
            this.broadcast('state', this.botManager.getAllStates());
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, settings: bot.getSettings() }));
          } catch (e: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }

      if (req.method === 'PUT' && action === 'paperMode') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const { paperMode } = JSON.parse(body);
            // Live-Mode-Wechsel ablehnen, wenn kein Private-Key in .env existiert.
            // Verhindert, dass der Bot ohne gültiges Signing-Setup auf Live schaltet.
            if (paperMode === false && !CONFIG.WALLET_PRIVATE_KEY) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Live-Mode benötigt WALLET_PRIVATE_KEY in .env — Importiere zuerst einen Key.' }));
              return;
            }
            this.botManager.updateBotPaperMode(id, paperMode);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, paperMode }));
          } catch (e: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }

      // POST /api/bots/:id/killswitch/reset — Kill-Switch quittieren und erneut scharfschalten
      if (req.method === 'POST' && action === 'killswitch/reset') {
        this.botManager.resetBotKillSwitch(id);
        this.broadcast('state', this.botManager.getAllStates());
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      // ADR-020: POST /api/bots/:id/adaptations/reset — gespeicherte Programm-
      // Anpassungen löschen, sodass der User-Preset wieder reinläuft.
      if (req.method === 'POST' && action === 'adaptations/reset') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const { scope } = JSON.parse(body || '{}');
            if (scope !== 'novapulse' && scope !== 'paet' && scope !== 'all') {
              throw new Error(`Invalid scope: ${scope}`);
            }
            const result = this.botManager.resetBotAdaptations(id, scope);
            this.broadcast('state', this.botManager.getAllStates());
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, ...result }));
          } catch (e: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }

      // POST /api/bots/:id/trade - Manual BUY/SELL trading
      if (req.method === 'POST' && action === 'trade') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
          try {
            const { action: tradeAction, price } = JSON.parse(body) as { action: 'BUY' | 'SELL', price: number };
            
            if (!tradeAction || !price) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing action or price' }));
              return;
            }

            const tradeResult = await bot.executeManualTrade(tradeAction, price);

            if (tradeResult) {
              this.broadcast('state', this.botManager.getAllStates());
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true, trade: tradeResult }));
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Trade failed - check balance or positions' }));
            }
          } catch (e: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }

      // POST /api/bots/:id/config - Update bot trading config
      if (req.method === 'POST' && action === 'config') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
          try {
            const { tradeSize, aggressiveness, tradingMode } = JSON.parse(body) as {
              tradeSize?: number;
              aggressiveness?: number;
              tradingMode?: 'fixed' | 'aggressive'
            };

            // Sanity-Check für Live-Bots: Trade-Größe muss Tx-Fee-Reserve übersteigen,
            // und 100% Aggressiveness würde die Wallet vollständig drainen.
            if (!bot.getTrader().paperMode) {
              if (typeof tradeSize === 'number' && tradeSize > 0 && tradeSize < 0.05) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `tradeSize ${tradeSize} SOL unter Reserve-Floor (0.05 SOL für SELL-Tx-Fees).` }));
                return;
              }
              if (typeof aggressiveness === 'number' && aggressiveness >= 100) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Aggressiveness 100% würde die Wallet vollständig drainen — max 90% empfohlen.' }));
                return;
              }
            }
            
            if (tradingMode === undefined && tradeSize === undefined && aggressiveness === undefined) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing config parameters' }));
              return;
            }

            // Get current config from trader
            const currentConfig = bot.getTrader().getTradeConfig();

            // Update with new values
            const newTradeSize = tradeSize ?? currentConfig.tradeSize;
            const newAggressiveness = aggressiveness ?? currentConfig.aggressiveness;
            const newTradingMode = tradingMode ?? currentConfig.tradingMode;

            // Apply config update
            bot.updateTradeConfig(newTradeSize, newAggressiveness, newTradingMode);
            
            // Broadcast state update
            this.broadcast('state', this.botManager.getAllStates());
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              ok: true,
              config: {
                tradeSize: newTradeSize,
                aggressiveness: newAggressiveness,
                tradingMode: newTradingMode,
              }
            }));
          } catch (e: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }
    }

    // ==================== PRICE HISTORY API ====================
    
    // GET /api/prices/history - Alle historischen Preisdaten (JSONL)
    if (url === '/api/prices/history' && req.method === 'GET') {
      try {
        const allPrices = this.recorder.loadAll();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(allPrices));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // GET /api/prices/live?mintAddress=xxx&limit=1000 - Live Feed Daten aus SQLite
    const liveFeedMatch = url.match(/^\/api\/prices\/live\?mintAddress=([^&]+)(&limit=(\d+))?$/);
    if (liveFeedMatch && req.method === 'GET') {
      try {
        const mintAddress = liveFeedMatch[1];
        const limit = parseInt(liveFeedMatch[3] || '1000');
        const prices = this.recorder.loadFromDatabase(mintAddress, limit);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(prices));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // GET /api/prices/stats - Live Feed Statistiken
    if (url === '/api/prices/stats' && req.method === 'GET') {
      try {
        const stats = this.recorder.getStats();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stats));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // ==================== TOKEN WHITELIST API ====================
    
    // GET /api/tokens - Alle Whitelist-Token abrufen
    if (url === '/api/tokens' && req.method === 'GET') {
      try {
        const tokens = this.tokenService.getAllTokens();
        
        // Aktuelle Preisdaten: PriceFeed (live) hat Vorrang, sonst DB-Werte
        const tokensWithPrices = tokens.map(token => {
          const history = this.priceFeed.getHistory(token.mintAddress);
          const livePrice = history.length > 0 ? history[history.length - 1].price : undefined;

          return {
            ...token,
            priceUsd: livePrice ?? token.priceUsd,
            volume24h: token.volume24h,
            liquidity: token.liquidity,
            priceChange24h: token.priceChange24h,
            lastPoll: this.priceFeed.getLastPoll(token.mintAddress)
          };
        });
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(tokensWithPrices));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // GET /api/tokens/lookup/:mintAddress - Token-Info von DexScreener (ohne Speicherung)
    const lookupMatch = url.match(/^\/api\/tokens\/lookup\/([^/]+)$/);
    if (lookupMatch && req.method === 'GET') {
      const mintAddress = lookupMatch[1];
      
      if (!isValidMintAddress(mintAddress)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid mint address format' }));
        return;
      }
      
      try {
        const tokenInfo = await this.tokenService.lookupToken(mintAddress);
        
        if (!tokenInfo) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Token not found on DexScreener' }));
          return;
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(tokenInfo));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // POST /api/tokens - Neues Token zur Whitelist hinzufügen
    if (url === '/api/tokens' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { mintAddress } = JSON.parse(body);
          
          if (!mintAddress) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Mint address is required' }));
            return;
          }
          
          const result = await this.tokenService.addToken(mintAddress);
          
          if (!result.success) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: result.error }));
            return;
          }
          
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result.token));
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // DELETE /api/tokens/:mintAddress - Token aus Whitelist entfernen
    const deleteMatch = url.match(/^\/api\/tokens\/([^/]+)$/);
    if (deleteMatch && req.method === 'DELETE') {
      const mintAddress = deleteMatch[1];
      
      const result = this.tokenService.removeToken(mintAddress);
      
      if (!result.success) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: result.error }));
        return;
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, mintAddress }));
      return;
    }

    // POST /api/tokens/clear-all - Alle Token explizit löschen (nur über API)
    if (url === '/api/tokens/clear-all' && req.method === 'POST') {
      try {
        // Hole alle Token und lösche sie einzeln
        const allTokens = this.tokenService.getAllTokens();
        let deletedCount = 0;
        for (const token of allTokens) {
          const result = this.tokenService.removeToken(token.mintAddress);
          if (result.success) deletedCount++;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, deletedCount, total: allTokens.length }));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // ==================== OLLAMA AGENT API ====================
    
    // GET /api/agent/status - Agent Status abrufen
    if (pathname === '/api/agent/status' && req.method === 'GET') {
      if (!this.ollamaAgent) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'OllamaAgent not initialized' }));
        return;
      }
      const status = this.ollamaAgent.getStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }

    // GET /api/agent/models - Verfügbare Ollama Modelle
    if (pathname === '/api/agent/models' && req.method === 'GET') {
      if (!this.ollamaAgent) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'OllamaAgent not initialized' }));
        return;
      }
      const models = await this.ollamaAgent.listModels();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(models));
      return;
    }

    // GET /api/agent/history - Analyse-Historie
    if (pathname === '/api/agent/history' && req.method === 'GET') {
      if (!this.ollamaAgent) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'OllamaAgent not initialized' }));
        return;
      }
      const botId = urlObj.searchParams.get('botId') || undefined;
      const limit = parseInt(urlObj.searchParams.get('limit') || '50', 10);
      const history = this.ollamaAgent.getHistory(botId, limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(history));
      return;
    }

    // POST /api/agent/config - Agent Config aktualisieren
    if (pathname === '/api/agent/config' && req.method === 'POST') {
      if (!this.ollamaAgent) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'OllamaAgent not initialized' }));
        return;
      }
      const agent = this.ollamaAgent;
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const config = JSON.parse(body);
          agent.updateConfig(config);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, config: agent.config }));
        } catch (e: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // POST /api/agent/start - Agent starten
    if (pathname === '/api/agent/start' && req.method === 'POST') {
      if (!this.ollamaAgent) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'OllamaAgent not initialized' }));
        return;
      }
      this.ollamaAgent.start();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, status: this.ollamaAgent.getStatus() }));
      return;
    }

    // POST /api/agent/stop - Agent stoppen
    if (pathname === '/api/agent/stop' && req.method === 'POST') {
      if (!this.ollamaAgent) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'OllamaAgent not initialized' }));
        return;
      }
      this.ollamaAgent.stop();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, status: this.ollamaAgent.getStatus() }));
      return;
    }

    // POST /api/agent/trigger - Manuelle Analyse auslösen
    if (pathname === '/api/agent/trigger' && req.method === 'POST') {
      if (!this.ollamaAgent) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'OllamaAgent not initialized' }));
        return;
      }
      const body = await parseBody(req);
      const botId: string | undefined = body?.botId || undefined;
      // ADR-012: optional force multiplier (0..100) controls how aggressively
      // the AI's recommendation is blended into current settings. Clamped
      // server-side. Undefined => legacy behaviour (1:1 apply).
      let forceMultiplier: number | undefined;
      if (body && typeof body.forceMultiplier === 'number') {
        const raw = body.forceMultiplier;
        if (Number.isFinite(raw)) {
          forceMultiplier = Math.max(0, Math.min(100, Math.round(raw)));
        }
      }
      this.ollamaAgent.triggerAnalysis(botId, forceMultiplier);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        message: 'Analysis triggered',
        botId: botId ?? 'all',
        forceMultiplier: forceMultiplier ?? 100,
      }));
      return;
    }

    // ==================== GLOBAL SETTINGS API ====================

    // GET /api/settings
    if (url === '/api/settings' && req.method === 'GET') {
      try {
        const raw = getSetting('globalSettings', JSON.stringify(DEFAULT_GLOBAL_SETTINGS));
        console.log('[Server] GET /api/settings - Raw from DB:', raw);
        const settings = JSON.parse(raw);
        // Merge with defaults to ensure all fields are present (backward compatibility)
        const merged = { ...DEFAULT_GLOBAL_SETTINGS, ...settings };
        console.log('[Server] GET /api/settings - Merged:', merged);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(merged));
      } catch (e: any) {
        console.error('[Server] GET /api/settings - Error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // PUT /api/settings
    if (url === '/api/settings' && req.method === 'PUT') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const incoming = JSON.parse(body);
          console.log('[Server] PUT /api/settings - Incoming:', incoming);
          const { applyToAll, ...settingsOnly } = incoming;
          const merged = { ...DEFAULT_GLOBAL_SETTINGS, ...settingsOnly };
          console.log('[Server] PUT /api/settings - Merged:', merged);
          setSetting('globalSettings', JSON.stringify(merged));
          console.log('[Server] PUT /api/settings - Saved to DB');

          if (applyToAll) {
            const { floorWindow, spikeThreshold, sellDropThreshold, cooldownTicks } = merged;
            this.botManager.updateAllBotSettings({ floorWindow, spikeThreshold, sellDropThreshold, cooldownTicks });
            // Broadcast updated bot states to all SSE clients
            this.broadcast('state', this.botManager.getAllStates());
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ...merged, appliedToBots: applyToAll ? this.botManager.getAllBots().length : 0 }));
        } catch (e: any) {
          console.error('[Server] PUT /api/settings - Error:', e.message);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // ==================== UI SETTINGS API ====================

    // GET /api/settings/ui - UI-spezifische Einstellungen laden
    if (pathname === '/api/settings/ui' && req.method === 'GET') {
      try {
        const settings = loadUiSettings() ?? {};
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(settings));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // PUT /api/settings/ui - UI-spezifische Einstellungen speichern
    if (pathname === '/api/settings/ui' && req.method === 'PUT') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const incoming = JSON.parse(body) as UiSettings;
          const current = loadUiSettings() ?? {};
          const merged = { ...current, ...incoming };
          saveUiSettings(merged);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, settings: merged }));
        } catch (e: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // ==================== STRATEGY API ====================

    // GET /api/strategies/templates — built-in templates
    if (pathname === '/api/strategies/templates' && req.method === 'GET') {
      try {
        const templates = await loadBuiltinTemplates();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(templates));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // GET /api/strategies — all saved strategies
    if (pathname === '/api/strategies' && req.method === 'GET') {
      try {
        const type = urlObj.searchParams.get('type') || undefined;
        const strategies = listStrategies(type);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(strategies));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // POST /api/strategies — save a custom strategy
    if (pathname === '/api/strategies' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const config = JSON.parse(body);
          const id = saveStrategy(config, false);
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, id }));
        } catch (e: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // GET /api/strategies/:id
    const strategyGetMatch = pathname.match(/^\/api\/strategies\/([^/]+)$/);
    if (strategyGetMatch && req.method === 'GET') {
      const strategy = getStrategy(strategyGetMatch[1]);
      if (!strategy) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Strategy not found' }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(strategy));
      }
      return;
    }

    // DELETE /api/strategies/:id
    if (strategyGetMatch && req.method === 'DELETE') {
      deleteStrategy(strategyGetMatch[1]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // PUT /api/bots/:id/strategy — assign strategy to bot
    const botStrategyMatch = pathname.match(/^\/api\/bots\/([^/]+)\/strategy$/);
    if (botStrategyMatch && req.method === 'PUT') {
      const botId = botStrategyMatch[1];
      const bot = this.botManager.getBot(botId);
      if (!bot) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bot not found' }));
        return;
      }
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { strategyId, strategyConfig } = JSON.parse(body);
          let config = strategyConfig;
          if (!config && strategyId) {
            config = getStrategy(strategyId);
          }
          if (!config) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No strategy config provided' }));
            return;
          }
          bot.updateStrategy(config);
          // Persist strategy assignment so it survives server restarts
          const resolvedId = strategyId ?? config.id;
          if (resolvedId) setBotStrategy(botId, resolvedId);
          this.broadcast('state', this.botManager.getAllStates());
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, strategyType: config.strategy_type }));
        } catch (e: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // GET /api/agent/regime-performance — per-regime win rate stats
    if (pathname === '/api/agent/regime-performance' && req.method === 'GET') {
      try {
        const botId = urlObj.searchParams.get('botId') || undefined;
        const perf = getRegimePerformance(botId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(perf));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // GET /api/agent/insights?botId=… — ADR-011 aggregated insights
    if (pathname === '/api/agent/insights' && req.method === 'GET') {
      const botId = urlObj.searchParams.get('botId');
      try {
        if (!botId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'botId query param required' }));
          return;
        }
        const minSamples = parseInt(process.env.AI_TIMEWINDOW_MIN_SAMPLES ?? '5', 10);
        const driftThreshold = parseInt(process.env.AI_DRIFT_THRESHOLD_PCT ?? '20', 10);
        const hourPerf = getTimeWindowPerformance(botId, 'hour_of_day', minSamples);
        const dayPerf = getTimeWindowPerformance(botId, 'weekday', minSamples);
        const hourDrift = detectTimeWindowDrift(botId, 'hour_of_day', driftThreshold, minSamples);
        const dayDrift = detectTimeWindowDrift(botId, 'weekday', driftThreshold, minSamples);
        const lessons = getLessonsForBot(botId, 5, parseInt(process.env.AI_LESSONS_LOOKBACK_DAYS ?? '7', 10));
        const allowSwitch = (process.env.AI_ALLOW_STRATEGY_SWITCH ?? '0') === '1';
        const minSwitchConf = parseFloat(process.env.AI_MIN_SWITCH_CONFIDENCE ?? '0.7');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          botId,
          timeWindows: { hour: hourPerf, weekday: dayPerf },
          drift: { hour: hourDrift, weekday: dayDrift },
          lessons,
          safety: { allowAutoSwitch: allowSwitch, minSwitchConfidence: minSwitchConf },
        }));
      } catch (e: any) {
        console.error(`[Server] /api/agent/insights failed for botId=${botId}:`, e);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message ?? String(e) }));
      }
      return;
    }

    // POST /api/agent/confirm-switch — manually approve/reject a proposed strategy switch
    if (pathname === '/api/agent/confirm-switch' && req.method === 'POST') {
      const body = await parseBody(req).catch(() => null);
      if (!body || typeof body.botId !== 'string' || typeof body.toStrategyType !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'botId and toStrategyType required' }));
        return;
      }
      const { botId, toStrategyType, approved } = body as { botId: string; toStrategyType: string; approved: boolean };
      const bot = this.botManager.getBot(botId);
      if (!bot) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bot not found' }));
        return;
      }
      if (!approved) {
        logger.info(botId, 'AI_AGENT', `Strategy switch to ${toStrategyType} rejected by user.`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, applied: false }));
        return;
      }
      const result = await bot.applyStrategySwitch(toStrategyType, 'user-confirmed via UI');
      if (!result) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `No template for ${toStrategyType}` }));
        return;
      }
      this.broadcast('state', this.botManager.getAllStates());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, applied: true, strategyType: result }));
      return;
    }

    // ==================== WALLET API (ADR-015) ====================

    // GET /api/wallet/info — primäre Wallet, SOL-Balance, Netzwerk, Token-Count
    if (pathname === '/api/wallet/info' && req.method === 'GET') {
      try {
        const info = await walletService.getInfo();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(info));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // GET /api/wallet/balances — alle Token-Balances der primären Wallet
    if (pathname === '/api/wallet/balances' && req.method === 'GET') {
      try {
        const address = walletService.getPrimaryAddress();
        const allBots = this.botManager.getAllBots();
        const liveBots = allBots.filter(b => {
          const s = b.getState();
          return !s.paperMode && s.walletAddress === address;
        });
        const mints = Array.from(new Set(liveBots.map(b => b.getState().mintAddress)));
        const balances = await walletService.getAllTokenBalances(mints, address);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ address, balances }));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // GET /api/wallet/balance/history?range=24h|7d|30d|all — historische Snapshots
    const balanceHistoryMatch = pathname.match(/^\/api\/wallet\/balance\/history$/);
    if (balanceHistoryMatch && req.method === 'GET') {
      try {
        const rangeRaw = (urlObj.searchParams.get('range') ?? '24h') as RangeKey;
        const range: RangeKey = ['1h', '24h', '7d', '30d', 'all'].includes(rangeRaw) ? rangeRaw : '24h';
        const history = await walletService.getBalanceHistory(range);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ range, history }));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // GET /api/wallet/transactions?limit=100&offset=0&botId=…&type=BUY|SELL&mode=paper|live&from=<ms>&to=<ms>
    const txMatch = pathname.match(/^\/api\/wallet\/transactions$/);
    if (txMatch && req.method === 'GET') {
      try {
        const limit = Math.min(500, parseInt(urlObj.searchParams.get('limit') ?? '100', 10));
        const offset = Math.max(0, parseInt(urlObj.searchParams.get('offset') ?? '0', 10));
        const botId = urlObj.searchParams.get('botId') ?? undefined;
        const typeRaw = urlObj.searchParams.get('type');
        const type = typeRaw === 'BUY' || typeRaw === 'SELL' ? typeRaw : undefined;
        const modeRaw = urlObj.searchParams.get('mode');
        const mode = modeRaw === 'paper' || modeRaw === 'live' ? modeRaw : undefined;
        const fromParam = urlObj.searchParams.get('from');
        const toParam = urlObj.searchParams.get('to');
        const from = fromParam ? parseInt(fromParam, 10) : undefined;
        const to = toParam ? parseInt(toParam, 10) : undefined;

        const trades = getTradesForWallet({ limit, offset, botId, type, mode, from, to });
        const network = walletService.getPrimaryAddress()
          ? (await walletService.getInfo()).network
          : 'mainnet';
        const enriched = trades.map(t => ({
          ...t,
          solscanUrl: t.signature ? getSolscanUrl(t.signature, network) : null,
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ limit, offset, count: enriched.length, transactions: enriched }));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // GET /api/wallet/transactions/onchain?limit=25 — Live-Tx direkt von Solana RPC
    const onchainTxMatch = pathname.match(/^\/api\/wallet\/transactions\/onchain$/);
    if (onchainTxMatch && req.method === 'GET') {
      try {
        const limit = Math.min(100, parseInt(urlObj.searchParams.get('limit') ?? '25', 10));
        const txs = await walletService.getOnChainTransactions(limit);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ count: txs.length, transactions: txs }));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // GET /api/wallet/transactions/:signature — Tx-Detail
    const txDetailMatch = pathname.match(/^\/api\/wallet\/transactions\/([1-9A-HJ-NP-Za-km-z]{64,88})$/);
    if (txDetailMatch && req.method === 'GET') {
      try {
        const signature = txDetailMatch[1];
        const detail = await walletService.getTransactionDetail(signature);
        if (!detail) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Transaction not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(detail));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // POST /api/wallet/snapshot — manueller Snapshot-Trigger
    if (pathname === '/api/wallet/snapshot' && req.method === 'POST') {
      try {
        await walletService.snapshotBalances();
        this.broadcast('wallet_update', { walletAddress: walletService.getPrimaryAddress(), timestamp: Date.now() });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, timestamp: Date.now() }));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // GET /api/wallet/bots — welche Bots nutzen welche Wallet
    if (pathname === '/api/wallet/bots' && req.method === 'GET') {
      try {
        const address = walletService.getPrimaryAddress();
        const rows = this.botManager.getAllBots().map(bot => {
          const state = bot.getState();
          return {
            botId: state.id,
            botName: state.name,
            walletAddress: state.walletAddress ?? '',
            paperMode: state.paperMode,
            mintAddress: state.mintAddress,
          };
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ primaryWallet: address, bots: rows }));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // GET /api/wallet/config — Wallet-Setup-Konfiguration (kein Private-Key!)
    if (pathname === '/api/wallet/config' && req.method === 'GET') {
      try {
        const config = walletService.getConfig();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(config));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // POST /api/wallet/setup/generate — neues Keypair generieren
    if (pathname === '/api/wallet/setup/generate' && req.method === 'POST') {
      try {
        const result = walletService.generateNewWallet();
        this.broadcast('wallet_update', { walletAddress: result.address, timestamp: Date.now() });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, address: result.address, privateKeyBase58: result.privateKeyBase58 }));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // POST /api/wallet/setup/import — bestehenden Private-Key importieren
    if (pathname === '/api/wallet/setup/import' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { privateKey } = JSON.parse(body) as { privateKey?: string };
          if (!privateKey) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'privateKey ist erforderlich' }));
            return;
          }
          const result = walletService.importPrivateKey(privateKey);
          this.broadcast('wallet_update', { walletAddress: result.address, timestamp: Date.now() });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, address: result.address }));
        } catch (e: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message ?? 'Import fehlgeschlagen' }));
        }
      });
      return;
    }

    // DELETE /api/wallet/setup — Private-Key aus .env entfernen
    if (pathname === '/api/wallet/setup' && req.method === 'DELETE') {
      try {
        walletService.clearPrivateKey();
        this.broadcast('wallet_update', { walletAddress: null, timestamp: Date.now() });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // PUT /api/wallet/paper-mode-default — globaler Paper-Mode-Default
    if (pathname === '/api/wallet/paper-mode-default' && req.method === 'PUT') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { paperMode } = JSON.parse(body) as { paperMode?: boolean };
          if (typeof paperMode !== 'boolean') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'paperMode (boolean) ist erforderlich' }));
            return;
          }
          walletService.setPaperModeDefault(paperMode);
          this.broadcast('state', this.botManager.getAllStates());
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, paperMode }));
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // POST /api/wallet/test-rpc — RPC-Verbindung testen
    if (pathname === '/api/wallet/test-rpc' && req.method === 'POST') {
      try {
        const result = await walletService.testRpc();
        res.writeHead(result.ok ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // GET /api/performance — bestätigte Trades für Performance-Analyse (alle Bots, zeitgefiltert)
    // Query-Parameter: from=<ms>, to=<ms>, botIds=<comma-separierte IDs>, mode=paper|live
    if (pathname === '/api/performance' && req.method === 'GET') {
      try {
        const fromParam = urlObj.searchParams.get('from');
        const toParam = urlObj.searchParams.get('to');
        const botIdsParam = urlObj.searchParams.get('botIds');
        const modeParam = urlObj.searchParams.get('mode');

        const from = fromParam ? parseInt(fromParam, 10) : undefined;
        const to = toParam ? parseInt(toParam, 10) : undefined;
        const botIds = botIdsParam
          ? botIdsParam.split(',').map(s => s.trim()).filter(Boolean)
          : undefined;
        const mode = modeParam === 'paper' || modeParam === 'live' ? modeParam : undefined;

        const trades = getTradesForPerformance(from, to, botIds, mode);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ trades }));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // GET /api/advisor/suggestions — Top-3 token+strategy recommendations from GeckoTerminal trending
    if (pathname === '/api/advisor/suggestions' && req.method === 'GET') {
      try {
        const forceRefresh = urlObj.searchParams.get('refresh') === '1';
        const result = await getAdvisorSuggestions(forceRefresh);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // Default 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  /** OllamaAgent Referenz setzen */
  setOllamaAgent(agent: OllamaAgent): void {
    this.ollamaAgent = agent;
    console.log('[BotServer] OllamaAgent referenz gesetzt');
  }
}
