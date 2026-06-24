import type { PricePoint } from './priceFeed.js';
import type { PatternResult, PatternSettings } from './patternDetector.js';
import type { TraderStats } from './trader.js';
import type { TradeLogEntry } from './logger.js';
import { PatternDetector } from './patternDetector.js';
import { Trader } from './trader.js';
import { CorrectionAgent } from './agent.js';

export type BacktestSpeed = 1 | 5 | 10 | 50 | 100 | 200 | 500 | 0;

export interface BacktestConfig {
  fromTimestamp: number;
  toTimestamp: number;
  speed: BacktestSpeed;
  settings: PatternSettings;
  initialSOL: number;
  tradeSize: number;
  enableAgent: boolean;
}

export interface BacktestState {
  status: 'running' | 'completed' | 'stopped';
  progress: number;
  currentTick: number;
  totalTicks: number;
  prices: PricePoint[];
  pattern: PatternResult | null;
  stats: TraderStats;
  settings: PatternSettings;
  recentTrades: TradeLogEntry[];
  elapsedMs: number;
}

export interface BacktestSummary {
  config: BacktestConfig;
  finalStats: TraderStats;
  allTrades: TradeLogEntry[];
  settingsHistory: { tick: number; settings: PatternSettings; reason: string }[];
  duration: { ticks: number; wallTimeMs: number; dataTimeMs: number };
  priceRange: { min: number; max: number; start: number; end: number };
}

export class Backtester {
  private config: BacktestConfig;
  private prices: PricePoint[];
  private detector: PatternDetector;
  private trader: Trader;
  private agent: CorrectionAgent;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private currentIndex = 0;
  private startTime = 0;
  private lastResult: PatternResult | null = null;
  private settingsHistory: { tick: number; settings: PatternSettings; reason: string }[] = [];
  private onTick: ((state: BacktestState) => void) | null = null;
  private onComplete: ((summary: BacktestSummary) => void) | null = null;

  constructor(config: BacktestConfig, prices: PricePoint[]) {
    this.config = config;
    this.prices = prices;
    this.detector = new PatternDetector({ ...config.settings });
    this.trader = new Trader({
      initialSOL: config.initialSOL,
      tradeSize: config.tradeSize,
      paperMode: true,
      logFile: `backtest-${Date.now()}.jsonl`,
    });
    this.agent = new CorrectionAgent();
  }

  get running(): boolean {
    return this.intervalId !== null || this.currentIndex < this.prices.length;
  }

  start(onTick: (state: BacktestState) => void, onComplete: (summary: BacktestSummary) => void): void {
    this.onTick = onTick;
    this.onComplete = onComplete;
    this.startTime = Date.now();
    this.currentIndex = 0;

    if (this.config.speed === 0) {
      this.runInstant();
    } else {
      const intervalMs = Math.round(2000 / this.config.speed);
      this.intervalId = setInterval(() => this.processTick(), intervalMs);
    }
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async processTick(): Promise<void> {
    if (this.currentIndex >= this.prices.length) {
      this.stop();
      this.finish();
      return;
    }

    this.currentIndex++;
    await this.runOneTick();
    this.emitState('running');
  }

  private async runInstant(): Promise<void> {
    for (let i = 0; i < this.prices.length; i++) {
      this.currentIndex = i + 1;
      await this.runOneTick();

      // Emit progress every 100 ticks
      if (i % 100 === 0) {
        this.emitState('running');
      }
    }
    this.finish();
  }

  private async runOneTick(): Promise<void> {
    const history = this.prices.slice(0, this.currentIndex);

    if (history.length < this.detector.settings.floorWindow) {
      this.lastResult = null;
      return;
    }

    const result = this.detector.analyze(history);
    this.lastResult = result;

    const trade = await this.trader.handleSignal(result, { ...this.detector.settings } as unknown as Record<string, number>);

    if (trade && this.config.enableAgent) {
      const advice = this.agent.analyze(this.trader.getLogger().getEntries(), this.detector.settings);
      if (advice) {
        this.detector.updateSettings(advice.adjustedSettings);
        this.settingsHistory.push({
          tick: this.currentIndex,
          settings: { ...this.detector.settings },
          reason: advice.reason,
        });
      }
    }
  }

  private emitState(status: 'running' | 'completed'): void {
    const history = this.prices.slice(0, this.currentIndex);
    const state: BacktestState = {
      status,
      progress: this.currentIndex / this.prices.length,
      currentTick: this.currentIndex,
      totalTicks: this.prices.length,
      prices: history.slice(-50),
      pattern: this.lastResult,
      stats: this.trader.getStats(),
      settings: { ...this.detector.settings },
      recentTrades: this.trader.getLogger().getLastN(5),
      elapsedMs: Date.now() - this.startTime,
    };
    this.onTick?.(state);
  }

  private finish(): void {
    this.emitState('completed');
    this.onComplete?.(this.buildSummary());
  }

  private buildSummary(): BacktestSummary {
    const priceVals = this.prices.map(p => p.price);
    return {
      config: this.config,
      finalStats: this.trader.getStats(),
      allTrades: this.trader.getLogger().getEntries(),
      settingsHistory: this.settingsHistory,
      duration: {
        ticks: this.prices.length,
        wallTimeMs: Date.now() - this.startTime,
        dataTimeMs: this.prices.length > 1
          ? this.prices[this.prices.length - 1].timestamp - this.prices[0].timestamp
          : 0,
      },
      priceRange: {
        min: Math.min(...priceVals),
        max: Math.max(...priceVals),
        start: priceVals[0] ?? 0,
        end: priceVals[priceVals.length - 1] ?? 0,
      },
    };
  }

  static generateReport(summary: BacktestSummary): string {
    const { config, finalStats, allTrades, settingsHistory, duration, priceRange } = summary;
    const fromDate = new Date(config.fromTimestamp).toLocaleString('de-DE');
    const toDate = new Date(config.toTimestamp).toLocaleString('de-DE');
    const genDate = new Date().toISOString();
    const winRate = finalStats.totalTrades > 0
      ? ((finalStats.wins / finalStats.totalTrades) * 100).toFixed(1)
      : '0';
    const speedLabel = config.speed === 0 ? 'Instant' : `${config.speed}x`;

    let md = `# Backtest Report — Range Spike Scalper\n\n`;
    md += `**Generiert:** ${genDate}\n\n`;

    // Konfiguration
    md += `## Konfiguration\n\n`;
    md += `| Parameter | Wert |\n|-----------|------|\n`;
    md += `| Zeitraum | ${fromDate} – ${toDate} |\n`;
    md += `| Ticks | ${duration.ticks} |\n`;
    md += `| Datenzeitraum | ${(duration.dataTimeMs / 60000).toFixed(1)} Min |\n`;
    md += `| Speed | ${speedLabel} |\n`;
    md += `| Initial SOL | ${config.initialSOL} |\n`;
    md += `| Trade Size | ${config.tradeSize} SOL |\n`;
    md += `| Agent aktiv | ${config.enableAgent ? 'Ja' : 'Nein'} |\n\n`;

    // Start-Settings
    md += `### Start-Settings\n\n`;
    md += `| Parameter | Wert |\n|-----------|------|\n`;
    md += `| floorWindow | ${config.settings.floorWindow} |\n`;
    md += `| spikeThreshold | ${config.settings.spikeThreshold}% |\n`;
    md += `| sellDropThreshold | ${config.settings.sellDropThreshold}% |\n`;
    md += `| cooldownTicks | ${config.settings.cooldownTicks} |\n\n`;

    // Ergebnis
    md += `## Ergebnis\n\n`;
    md += `| Metrik | Wert |\n|--------|------|\n`;
    md += `| Trades | ${finalStats.totalTrades} |\n`;
    md += `| Wins | ${finalStats.wins} |\n`;
    md += `| Losses | ${finalStats.losses} |\n`;
    md += `| Win-Rate | ${winRate}% |\n`;
    md += `| Total PnL | ${finalStats.totalPnlPercent >= 0 ? '+' : ''}${finalStats.totalPnlPercent.toFixed(2)}% |\n`;
    md += `| SOL Final | ${finalStats.balanceSOL.toFixed(4)} |\n`;
    md += `| Preis Start | $${priceRange.start.toFixed(8)} |\n`;
    md += `| Preis Ende | $${priceRange.end.toFixed(8)} |\n`;
    md += `| Preis Min | $${priceRange.min.toFixed(8)} |\n`;
    md += `| Preis Max | $${priceRange.max.toFixed(8)} |\n\n`;

    // Alle Trades
    if (allTrades.length > 0) {
      md += `## Alle Trades\n\n`;
      md += `| # | Zeit | Aktion | Preis | Floor | Spike% | PnL% | Settings |\n`;
      md += `|---|------|--------|-------|-------|--------|------|----------|\n`;
      allTrades.forEach((t, i) => {
        const time = new Date(t.timestamp).toLocaleTimeString('de-DE');
        const pnl = t.pnlPercent !== undefined ? `${t.pnlPercent >= 0 ? '+' : ''}${t.pnlPercent.toFixed(2)}` : '—';
        const s = t.settings as Record<string, number>;
        const settingsStr = `fw:${s.floorWindow ?? '?'} st:${s.spikeThreshold ?? '?'} sd:${s.sellDropThreshold ?? '?'}`;
        md += `| ${i + 1} | ${time} | ${t.action} | ${t.price.toFixed(8)} | ${t.floor.toFixed(8)} | ${t.spikePercent.toFixed(3)} | ${pnl} | ${settingsStr} |\n`;
      });
      md += '\n';
    }

    // Agent-Anpassungen
    if (settingsHistory.length > 0) {
      md += `## Agent-Anpassungen\n\n`;
      md += `| Tick | Grund | Neue Settings |\n|------|-------|---------------|\n`;
      settingsHistory.forEach(h => {
        const s = h.settings;
        md += `| ${h.tick} | ${h.reason} | fw:${s.floorWindow} st:${s.spikeThreshold} sd:${s.sellDropThreshold} cd:${s.cooldownTicks} |\n`;
      });
      md += '\n';
    }

    // Analyse-Notizen
    md += `## Analyse-Notizen\n\n`;
    md += `> Dieser Report wurde für die manuelle LLM-Analyse generiert.\n`;
    md += `> Kopiere den gesamten Inhalt in einen Chat mit Claude/ChatGPT zur Strategie-Optimierung.\n\n`;
    md += `### Vorgeschlagene Analyse-Fragen\n`;
    md += `- Gibt es ein Muster bei den Verlust-Trades (Tageszeit, Spike-Höhe)?\n`;
    md += `- Sind die Agent-Anpassungen sinnvoll oder destabilisierend?\n`;
    md += `- Welche Settings-Kombination hätte die beste Win-Rate erzielt?\n`;
    md += `- Gibt es Phasen wo der Bot besser pausiert hätte?\n`;
    md += `- Wie verhält sich die Performance bei verschiedenen Volatilitätsniveaus?\n`;

    return md;
  }
}
