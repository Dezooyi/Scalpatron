import type { TradeLogEntry } from './logger.js';
import type { PatternSettings } from './patternDetector.js';

export interface AgentAdvice {
  adjustedSettings: Partial<PatternSettings>;
  reason: string;
}

export class CorrectionAgent {
  private minTrades = 5; // Minimum Trades bevor Optimierung startet

  analyze(trades: TradeLogEntry[], currentSettings: PatternSettings): AgentAdvice | null {
    if (trades.length < this.minTrades) return null;

    const recentTrades = trades.slice(-20);
    const sells = recentTrades.filter(t => t.action === 'SELL');
    if (sells.length < 3) return null;

    const adjustments: Partial<PatternSettings> = {};
    const reasons: string[] = [];

    // Analyse 1: Win-Rate prüfen
    const wins = sells.filter(t => (t.pnlPercent ?? 0) > 0).length;
    const winRate = wins / sells.length;

    // Analyse 2: Durchschnittlicher Spike bei Sells
    const avgSpikeAtSell = sells.reduce((s, t) => s + t.spikePercent, 0) / sells.length;

    // Analyse 3: Durchschnittlicher PnL
    const avgPnl = sells.reduce((s, t) => s + (t.pnlPercent ?? 0), 0) / sells.length;

    // Regel 1: Zu viele Verlust-Trades → Spike-Threshold erhöhen
    if (winRate < 0.4) {
      const newThreshold = Math.min(currentSettings.spikeThreshold * 1.3, 5.0);
      adjustments.spikeThreshold = parseFloat(newThreshold.toFixed(3));
      reasons.push(`Win-Rate ${(winRate * 100).toFixed(0)}% zu niedrig → spikeThreshold ${currentSettings.spikeThreshold}% → ${adjustments.spikeThreshold}%`);
    }

    // Regel 2: Win-Rate gut aber PnL zu gering → Sell-Drop verringern (früher verkaufen)
    if (winRate > 0.6 && avgPnl < 0.5) {
      const newDrop = Math.max(currentSettings.sellDropThreshold * 0.8, 0.05);
      adjustments.sellDropThreshold = parseFloat(newDrop.toFixed(3));
      reasons.push(`PnL ${avgPnl.toFixed(2)}% gering trotz guter Win-Rate → sellDrop ${currentSettings.sellDropThreshold}% → ${adjustments.sellDropThreshold}%`);
    }

    // Regel 3: Durchschnittlicher Spike bei Sells ist sehr hoch → wir verkaufen zu spät
    if (avgSpikeAtSell > currentSettings.spikeThreshold * 3) {
      const newDrop = Math.max(currentSettings.sellDropThreshold * 0.7, 0.05);
      adjustments.sellDropThreshold = parseFloat(newDrop.toFixed(3));
      reasons.push(`Avg Spike bei Sell ${avgSpikeAtSell.toFixed(2)}% (3x Threshold) → verkaufen zu spät → sellDrop ↓`);
    }

    // Regel 4: Win-Rate sehr hoch → können aggressiver traden (Threshold senken)
    if (winRate > 0.8 && sells.length >= 5) {
      const newThreshold = Math.max(currentSettings.spikeThreshold * 0.85, 0.1);
      adjustments.spikeThreshold = parseFloat(newThreshold.toFixed(3));
      reasons.push(`Win-Rate ${(winRate * 100).toFixed(0)}% exzellent → spikeThreshold ${currentSettings.spikeThreshold}% → ${adjustments.spikeThreshold}%`);
    }

    if (reasons.length === 0) return null;

    return {
      adjustedSettings: adjustments,
      reason: reasons.join(' | '),
    };
  }
}
