import { BotInstance, BotState } from './botInstance.js';
import { db, wipeLiveFeed, setBotStrategy, getStrategy, getBotStrategyId } from './db.js';
import { DEFAULT_SETTINGS, PatternSettings } from './patternDetector.js';
import { randomUUID } from 'crypto';
import { loadOrCreateKeypair } from './wallet.js';
import type { KillSwitchConfig } from './killSwitch.js';

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
  settings?: Partial<PatternSettings>;
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
        walletAddress = loadOrCreateKeypair('live').publicKey.toBase58();
      }

      const bot = new BotInstance(
        row.id, row.name, row.mintAddress, row.initialSOL, row.paperMode === 1,
        walletAddress, row.tradeSize ?? 1, row.aggressiveness ?? 10,
        (row.tradingMode ?? 'fixed') as 'fixed' | 'aggressive',
      );
      // Load assigned strategy first so per-bot persisted settings can override template defaults
      const strategyId = getBotStrategyId(bot.id);
      const strategyConfig = strategyId ? getStrategy(strategyId) : undefined;
      if (strategyConfig) bot.updateStrategy(strategyConfig);

      // ADR-014: best-effort migration. Legacy bots were persisted with
      // settings = DEFAULT_SETTINGS while they actually traded on the assigned
      // strategy template's scalping_settings (which only lived in memory at
      // creation time). Detect the placeholder and adopt the template values so
      // DB and engine stay consistent across restarts (no Template → DEFAULT jump).
      let effectiveSettings: PatternSettings = settings;
      if (
        strategyConfig?.scalping_settings &&
        JSON.stringify(settings) === JSON.stringify(DEFAULT_SETTINGS)
      ) {
        effectiveSettings = { ...DEFAULT_SETTINGS, ...strategyConfig.scalping_settings };
        try {
          db.prepare('UPDATE bots SET settings = ? WHERE id = ?').run(
            JSON.stringify(effectiveSettings), bot.id,
          );
          console.log(`[BotManager] ADR-014 Migration: Bot ${bot.id} settings auf Template-Werte aktualisiert`);
        } catch (e) {
          console.warn(`[BotManager] ADR-014 Migration fehlgeschlagen fuer Bot ${bot.id}: ${(e as Error).message}`);
        }
      }

      // Apply persisted bot-specific settings last (authoritative override)
      bot.updateSettings(effectiveSettings);

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

    // ADR-014: resolve effective settings in priority order:
    //   1) explicit settings from the request (e.g. Advisor scalpingSettings),
    //   2) the assigned strategy template's scalping_settings (so DB and engine
    //      match from creation — no Template → DEFAULT jump on restart),
    //   3) DEFAULT_SETTINGS (legacy / non-scalping path).
    const strategyConfig = config.strategyId ? getStrategy(config.strategyId) : undefined;
    let settings: PatternSettings;
    if (config.settings) {
      settings = { ...DEFAULT_SETTINGS, ...config.settings };
    } else if (strategyConfig?.scalping_settings) {
      settings = { ...DEFAULT_SETTINGS, ...strategyConfig.scalping_settings };
    } else {
      settings = { ...DEFAULT_SETTINGS };
    }

    let walletAddress = config.walletAddress ?? '';
    
    // Auto-fill wallet address if live mode and empty
    if (!config.paperMode && !walletAddress) {
      walletAddress = loadOrCreateKeypair('live').publicKey.toBase58();
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
    if (config.strategyId && strategyConfig) {
      bot.updateStrategy(strategyConfig);
      setBotStrategy(id, config.strategyId);
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

  public updateBotKillSwitch(id: string, config: KillSwitchConfig) {
    const bot = this.bots.get(id);
    if (!bot) return;
    // setKillSwitchConfig aktualisiert die Engine UND persistiert in die DB
    bot.setKillSwitchConfig(config);
  }

  public resetBotKillSwitch(id: string) {
    const bot = this.bots.get(id);
    if (!bot) return;
    bot.resetKillSwitch();
  }

  public updateBotPaperMode(id: string, paperMode: boolean) {
    const bot = this.bots.get(id);
    if (!bot) return;

    bot.setPaperMode(paperMode);

    // If switching to live mode and wallet is empty, auto-fill with global PK
    if (!paperMode && !bot.walletAddress) {
      const globalAddr = loadOrCreateKeypair('live').publicKey.toBase58();
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

  /**
   * Lädt das Keypair aller laufenden Live-Trader neu aus .env.
   * Wird vom WalletService nach Import/Generate/Clear getriggert, damit
   * kein Trade mehr mit dem veralteten Keypair signiert wird.
   */
  public async reloadAllLiveTraders(): Promise<void> {
    let count = 0;
    for (const bot of this.bots.values()) {
      const trader = bot.getTrader();
      if (!trader.paperMode) {
        trader.reloadKeypair();
        count++;
      }
    }
    if (count > 0) {
      console.log(`[BotManager] ${count} Live-Trader Keypair neu geladen`);
    }
  }
}
