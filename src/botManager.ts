import { BotInstance, BotState } from './botInstance.js';
import { db, wipeLiveFeed, setBotStrategy, getStrategy, getBotStrategyId } from './db.js';
import { DEFAULT_SETTINGS, PatternSettings } from './patternDetector.js';
import { randomUUID } from 'crypto';
import { loadOrCreateKeypair } from './wallet.js';

interface BotConfig {
  id?: string;
  name: string;
  mintAddress: string;
  initialSOL: number;
  paperMode: boolean;
  walletAddress?: string;
  tradeSize?: number;
  aggressiveness?: number;
  tradingMode?: 'fixed' | 'aggressive';
  settings?: PatternSettings;
  strategyId?: string;   // assign a strategy from Strategy Management at creation
}

export class BotManager {
  private bots: Map<string, BotInstance> = new Map();

  constructor() {
    this.loadBotsFromDB();
  }

  private loadBotsFromDB() {
    const stmt = db.prepare('SELECT * FROM bots');
    const rows = stmt.all() as any[];

    for (const row of rows) {
      const settings = JSON.parse(row.settings);
      let walletAddress = row.walletAddress ?? '';
      if (row.paperMode === 0 && !walletAddress) {
        walletAddress = loadOrCreateKeypair().publicKey.toBase58();
      }

      const bot = new BotInstance(
        row.id, row.name, row.mintAddress, row.initialSOL, row.paperMode === 1,
        walletAddress, row.tradeSize ?? 1, row.aggressiveness ?? 10,
        (row.tradingMode ?? 'fixed') as 'fixed' | 'aggressive',
      );
      bot.updateSettings(settings);

      const strategyId = getBotStrategyId(bot.id);
      if (strategyId) {
        const config = getStrategy(strategyId);
        if (config) bot.updateStrategy(config);
      }

      this.bots.set(bot.id, bot);
      
      // Auto-start if it was running? For now leave them stopped on boot for safety.
      // Or restore status:
      if (row.status === 'running') {
        bot.start();
      }
    }
    console.log(`[BotManager] Geladen: ${this.bots.size} Bots aus DB`);
  }

  public createBot(config: BotConfig): BotInstance {
    const id = config.id || randomUUID();
    const settings = config.settings || DEFAULT_SETTINGS;
    let walletAddress = config.walletAddress ?? '';
    
    // Auto-fill wallet address if live mode and empty
    if (!config.paperMode && !walletAddress) {
      walletAddress = loadOrCreateKeypair().publicKey.toBase58();
    }
    const tradeSize = config.tradeSize ?? 1;
    const aggressiveness = config.aggressiveness ?? 10;
    const tradingMode = config.tradingMode ?? 'fixed';

    // Save to DB
    const stmt = db.prepare(`
      INSERT INTO bots (id, name, mintAddress, status, initialSOL, paperMode, settings, walletAddress, tradeSize, aggressiveness, tradingMode, strategyId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id, config.name, config.mintAddress, 'stopped',
      config.initialSOL, config.paperMode ? 1 : 0, JSON.stringify(settings),
      walletAddress, tradeSize, aggressiveness, tradingMode,
      config.strategyId ?? null,
    );

    const bot = new BotInstance(id, config.name, config.mintAddress, config.initialSOL, config.paperMode,
      walletAddress, tradeSize, aggressiveness, tradingMode);
    bot.updateSettings(settings);

    // Assign strategy at creation if strategyId provided
    if (config.strategyId) {
      const strategyConfig = getStrategy(config.strategyId);
      if (strategyConfig) {
        bot.updateStrategy(strategyConfig);
        setBotStrategy(id, config.strategyId);
      }
    }

    this.bots.set(id, bot);

    return bot;
  }

  public deleteBot(id: string): void {
    const bot = this.bots.get(id);
    if (bot) {
      bot.stop();
      const mintAddress = bot.mintAddress;
      this.bots.delete(id);
      // ON DELETE CASCADE entfernt automatisch trades und agent_history
      db.prepare('DELETE FROM bots WHERE id = ?').run(id);
      // live_feed hat keinen CASCADE — manuell bereinigen
      wipeLiveFeed(mintAddress);
    }
  }

  public getBot(id: string): BotInstance | undefined {
    return this.bots.get(id);
  }

  public getAllBots(): BotInstance[] {
    return Array.from(this.bots.values());
  }

  public getAllStates(): BotState[] {
    return this.getAllBots().map(b => b.getState());
  }

  public updateBotStatus(id: string, status: 'running' | 'paused' | 'stopped') {
    const bot = this.bots.get(id);
    if (!bot) return;

    if (status === 'running') {
      console.log(`[BotManager] Bot ${id} wird GESTARTET`);
      bot.start();
    } else if (status === 'paused') {
      bot.pause();
    } else if (status === 'stopped') {
      console.log(`[BotManager] Bot ${id} wird GESTOPPT`);
      bot.stop();
    }

    db.prepare('UPDATE bots SET status = ? WHERE id = ?').run(status, id);
  }

  public updateBotSettings(id: string, settings: Partial<PatternSettings>) {
    const bot = this.bots.get(id);
    if (!bot) return;

    bot.updateSettings(settings);
    db.prepare('UPDATE bots SET settings = ? WHERE id = ?').run(JSON.stringify(bot.getSettings()), id);
  }

  public updateBotTradeConfig(id: string, tradeSize: number, aggressiveness: number, tradingMode: 'fixed' | 'aggressive') {
    const bot = this.bots.get(id);
    if (!bot) return;
    bot.updateTradeConfig(tradeSize, aggressiveness, tradingMode);
    db.prepare('UPDATE bots SET tradeSize = ?, aggressiveness = ?, tradingMode = ? WHERE id = ?')
      .run(tradeSize, aggressiveness, tradingMode, id);
  }

  public updateBotWalletAddress(id: string, walletAddress: string) {
    const bot = this.bots.get(id);
    if (!bot) return;
    bot.walletAddress = walletAddress;
    db.prepare('UPDATE bots SET walletAddress = ? WHERE id = ?').run(walletAddress, id);
  }

  public updateBotPaperMode(id: string, paperMode: boolean) {
    const bot = this.bots.get(id);
    if (!bot) return;

    bot.setPaperMode(paperMode);

    // If switching to live mode and wallet is empty, auto-fill with global PK
    if (!paperMode && !bot.walletAddress) {
      const globalAddr = loadOrCreateKeypair().publicKey.toBase58();
      bot.walletAddress = globalAddr;
    }

    db.prepare('UPDATE bots SET paperMode = ?, walletAddress = ? WHERE id = ?')
      .run(paperMode ? 1 : 0, bot.walletAddress, id);
  }

  public updateAllBotSettings(settings: Partial<PatternSettings>) {
    for (const [id, bot] of this.bots) {
      bot.updateSettings(settings);
      db.prepare('UPDATE bots SET settings = ? WHERE id = ?').run(JSON.stringify(bot.getSettings()), id);
    }
    console.log(`[BotManager] Alle ${this.bots.size} Bots mit neuen Settings aktualisiert`);
  }
}
