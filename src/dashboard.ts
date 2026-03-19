import type { PricePoint } from './priceFeed.js';
import type { PatternResult, PatternSettings } from './patternDetector.js';
import type { TraderStats } from './trader.js';
import type { TradeLogEntry } from './logger.js';

const CLEAR = '\x1b[2J\x1b[H';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';

function col(text: string, color: string): string {
  return `${color}${text}${RESET}`;
}

function sparkline(prices: number[], width = 40): string {
  if (prices.length < 2) return '';
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const blocks = ' ▁▂▃▄▅▆▇█';
  const recent = prices.slice(-width);
  return recent.map(p => {
    const idx = Math.round(((p - min) / range) * (blocks.length - 1));
    return blocks[idx];
  }).join('');
}

export class Dashboard {
  private lastRender = 0;
  private minRenderInterval = 500;

  render(data: {
    prices: PricePoint[];
    pattern: PatternResult | null;
    stats: TraderStats;
    settings: PatternSettings;
    recentTrades: TradeLogEntry[];
    mode: string;
    tokenSymbol?: string; // Token-Symbol für dynamische Anzeige
  }): void {
    const now = Date.now();
    if (now - this.lastRender < this.minRenderInterval) return;
    this.lastRender = now;

    const { prices, pattern, stats, settings, recentTrades, mode, tokenSymbol = 'TOKEN' } = data;
    const current = prices[prices.length - 1];
    const priceValues = prices.map(p => p.price);

    const lines: string[] = [];

    // Header
    lines.push(CLEAR);
    lines.push(col('━'.repeat(60), DIM));
    lines.push(col(`  ${tokenSymbol} Range Spike Scalper`, BOLD + CYAN) + col(`  [${mode}]`, YELLOW));
    lines.push(col('━'.repeat(60), DIM));
    lines.push('');

    // Preis
    if (current) {
      const time = new Date(current.timestamp).toISOString().slice(11, 19);
      lines.push(`  ${col('Preis', BOLD)}    $${current.price.toFixed(8)}  ${col(time, DIM)}`);
    }
    if (pattern) {
      lines.push(`  ${col('Floor', BOLD)}    $${pattern.floor.toFixed(8)}`);
      const spkCol = pattern.spikePercent >= settings.spikeThreshold ? GREEN : WHITE;
      lines.push(`  ${col('Spike', BOLD)}    ${col(pattern.spikePercent.toFixed(3) + '%', spkCol)}`);
      if (pattern.peakPrice > 0) {
        lines.push(`  ${col('Peak', BOLD)}     $${pattern.peakPrice.toFixed(8)}  ${col('Drop: ' + pattern.dropFromPeak.toFixed(3) + '%', RED)}`);
      }
      const sigCol = pattern.signal === 'BUY' ? GREEN : pattern.signal === 'SELL' ? RED : DIM;
      lines.push(`  ${col('Signal', BOLD)}   ${col(pattern.signal, sigCol)}`);
    }

    // Chart
    lines.push('');
    lines.push(`  ${col('Chart', BOLD)}    ${sparkline(priceValues)}`);
    lines.push('');

    // Position & Stats
    lines.push(col('─'.repeat(60), DIM));
    lines.push(`  ${col('SOL', BOLD)}      ${stats.balanceSOL.toFixed(4)}    ${col(tokenSymbol, BOLD)}  ${stats.balanceToken.toFixed(0)}`);
    if (stats.currentPosition) {
      const pos = stats.currentPosition;
      const unPnl = ((prices[prices.length - 1]?.price ?? pos.entryPrice) - pos.entryPrice) / pos.entryPrice * 100;
      const pnlCol = unPnl >= 0 ? GREEN : RED;
      lines.push(`  ${col('Position', BOLD)} entry $${pos.entryPrice.toFixed(8)}  ${col(unPnl.toFixed(2) + '%', pnlCol)}`);
    }
    lines.push(`  ${col('Trades', BOLD)}   ${stats.totalTrades}  W:${col(String(stats.wins), GREEN)} L:${col(String(stats.losses), RED)}  PnL: ${col(stats.totalPnlPercent.toFixed(2) + '%', stats.totalPnlPercent >= 0 ? GREEN : RED)}`);

    // Recent Trades
    if (recentTrades.length > 0) {
      lines.push('');
      lines.push(col('─'.repeat(60), DIM));
      lines.push(`  ${col('Letzte Trades', BOLD)}`);
      for (const t of recentTrades.slice(-5)) {
        const time = new Date(t.timestamp).toISOString().slice(11, 19);
        const actCol = t.action === 'BUY' ? GREEN : RED;
        const pnl = t.pnlPercent != null ? ` ${col(t.pnlPercent.toFixed(2) + '%', t.pnlPercent >= 0 ? GREEN : RED)}` : '';
        lines.push(`  ${col(time, DIM)} ${col(t.action, actCol)} $${t.price.toFixed(8)}${pnl}`);
      }
    }

    // Settings
    lines.push('');
    lines.push(col('─'.repeat(60), DIM));
    lines.push(`  ${col('Settings', BOLD)}  floor:${settings.floorWindow} spike:${settings.spikeThreshold}% drop:${settings.sellDropThreshold}% cd:${settings.cooldownTicks}`);
    lines.push(col('━'.repeat(60), DIM));
    lines.push(col('  [q]uit  [s]ettings  [r]eset  [p]aper/live', DIM));

    process.stdout.write(lines.join('\n') + '\n');
  }
}

export function promptSettings(current: PatternSettings): Promise<Partial<PatternSettings> | null> {
  return new Promise(resolve => {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    console.log(`\n${col('Settings anpassen (Enter = beibehalten):', BOLD + CYAN)}`);
    const ask = (label: string, key: keyof PatternSettings, cb: () => void) => {
      rl.question(`  ${label} [${current[key]}]: `, (ans: string) => {
        if (ans.trim()) (current as unknown as Record<string, number>)[key] = parseFloat(ans);
        cb();
      });
    };
    ask('Floor Window (Ticks)', 'floorWindow', () =>
      ask('Spike Threshold (%)', 'spikeThreshold', () =>
        ask('Sell Drop Threshold (%)', 'sellDropThreshold', () =>
          ask('Cooldown (Ticks)', 'cooldownTicks', () => {
            rl.close();
            resolve(current);
          })
        )
      )
    );
  });
}
