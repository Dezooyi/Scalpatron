import http from 'http';
import type { BotManager } from './botManager.js';
import { PriceRecorder } from './priceRecorder.js';
import { logger } from './appLogger.js';
import { TokenService, isValidMintAddress } from './tokenService.js';
import { getSetting, setSetting, getRegimePerformance, listStrategies, saveStrategy, getStrategy, deleteStrategy, getDetailedLiveFeedStats, wipeLiveFeed, setBotStrategy, saveBotOrder, getBotOrder, deleteBotOrder } from './db.js';
import { loadBuiltinTemplates } from './strategyEngine.js';
import { PriceFeed } from './priceFeed.js';
import type { OllamaAgent } from './ollamaAgent.js';
import { buildSystemPrompt } from './ollamaAgent.js';
import { validateStrategy } from './strategy.js';
import { DEFAULT_SETTINGS } from './patternDetector.js';
import { CONFIG } from './config.js';

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

// Performance: Response Caching für häufige GET-Requests
interface ResponseCache<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

const responseCache = new Map<string, ResponseCache<any>>();

function getCachedResponse<T>(key: string): T | null {
  const cached = responseCache.get(key);
  if (cached && Date.now() - cached.timestamp < cached.ttl) {
    return cached.data as T;
  }
  responseCache.delete(key);
  return null;
}

function setCachedResponse<T>(key: string, data: T, ttlMs: number): void {
  responseCache.set(key, { data, timestamp: Date.now(), ttl: ttlMs });
  // Cleanup old entries periodically
  if (responseCache.size > 100) {
    const now = Date.now();
    for (const [k, v] of responseCache.entries()) {
      if (now - v.timestamp > v.ttl) {
        responseCache.delete(k);
      }
    }
  }
}

// Performance: Request Body Parser mit Cache
const bodyParserCache = new Map<string, any>();
let lastBodyParseTime = 0;
const BODY_PARSE_CACHE_TTL = 100; // 100ms

async function parseBody(req: http.IncomingMessage): Promise<any> {
  const cacheKey = `${req.method}:${req.url}:${Date.now() - lastBodyParseTime < BODY_PARSE_CACHE_TTL ? 'cached' : Date.now()}`;
  
  // Check cache for rapid duplicate requests
  if (bodyParserCache.has(cacheKey)) {
    return bodyParserCache.get(cacheKey);
  }
  
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        lastBodyParseTime = Date.now();
        bodyParserCache.set(cacheKey, parsed);
        resolve(parsed);
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
  private lastStateCache: any = null;
  private lastStateCacheTime: number = 0;
  private readonly STATE_CACHE_TTL = 100; // 100ms für SSE State Updates

  constructor(botManager: BotManager, recorder: PriceRecorder, port = 3000) {
    this.botManager = botManager;
    this.recorder = recorder;
    this.tokenService = TokenService.getInstance();
    this.priceFeed = PriceFeed.getInstance();
    // Connect logger to SSE
    logger.setSSECallback((entry) => {
      this.broadcast('terminal_log', entry);
    });

    // Periodisch Token-Preise von DexScreener aktualisieren (alle 60 Sekunden)
    setInterval(() => {
      this.tokenService.refreshAllTokenPrices().catch(() => {});
    }, 60_000);

    // Performance: SSE Broadcast Throttling
    this.setupSSEThrottling();

    this.startListening(port);
  }

  /**
   * Performance: SSE Broadcast mit Throttling um Client-Überlastung zu vermeiden
   */
  private setupSSEThrottling(): void {
    let lastBroadcastTime = 0;
    const SSE_THROTTLE_MS = 200; // Lower throttle for faster UI responsiveness
    
    const originalBroadcast = this.broadcast.bind(this);
    this.broadcast = (eventName: string, data: any): void => {
      const now = Date.now();
      
      // Throttle state events to reduce bandwidth
      if (eventName === 'state' && now - lastBroadcastTime < SSE_THROTTLE_MS) {
        return;
      }
      
      lastBroadcastTime = now;
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

      // Send initial state with caching
      const cachedState = getCachedResponse<any>('initial-state');
      if (cachedState) {
        res.write(`event: state\ndata: ${JSON.stringify(cachedState)}\n\n`);
      } else {
        const state = this.botManager.getAllStates();
        setCachedResponse('initial-state', state, 1000);
        res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
      }

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
        priceFeedTickrateMs: CONFIG.PRICE_FEED_TICKRATE_MS,
        priceFeedRequestIntervalMs: CONFIG.PRICE_FEED_REQUEST_INTERVAL_MS,
        priceFeedMaxRetries: CONFIG.PRICE_FEED_MAX_RETRIES,
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
          const bot = this.botManager.createBot(config);
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
              floorWindow: validatedStrategy.parameters.floorWindow ?? DEFAULT_SETTINGS.floorWindow,
              spikeThreshold: validatedStrategy.parameters.spikeThreshold ?? DEFAULT_SETTINGS.spikeThreshold,
              sellDropThreshold: validatedStrategy.parameters.sellDropThreshold ?? DEFAULT_SETTINGS.sellDropThreshold,
              cooldownTicks: validatedStrategy.parameters.cooldownTicks ?? DEFAULT_SETTINGS.cooldownTicks
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

    // Dynamic routes /api/bots/:id/*
    const botMatch = url.match(/^\/api\/bots\/([^/]+)(\/(.*))?$/);
    if (botMatch) {
      const id = botMatch[1];
      const action = botMatch[3];
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
            // Pattern settings
            const { tradeSize, aggressiveness, tradingMode, walletAddress, ...patternSettings } = incoming;
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
      this.ollamaAgent.triggerAnalysis(botId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: 'Analysis triggered', botId: botId ?? 'all' }));
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
