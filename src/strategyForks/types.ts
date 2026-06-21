import type { StrategyConfig, MarketContext } from '../strategyTypes.js';

/**
 * A StrategyFork programmatically adapts a StrategyConfig based on live market context.
 * Forks enable rapid, deterministic iteration of strategy variants without editing JSON templates.
 */
export interface StrategyFork {
  /** Unique fork identifier, e.g. 'adaptive-scalping' */
  id: string;

  /** Returns true if this fork should adapt the given strategy config. */
  canHandle: (config: StrategyConfig) => boolean;

  /** Returns a possibly modified copy of the strategy config. Must be pure (no side effects). */
  adapt: (config: StrategyConfig, context: MarketContext) => StrategyConfig;
}

/** Registry that holds all registered forks and selects the first matching one. */
export class ForkRegistry {
  private forks: StrategyFork[] = [];

  register(fork: StrategyFork): void {
    this.forks.push(fork);
  }

  registerAll(forks: StrategyFork[]): void {
    for (const fork of forks) {
      this.register(fork);
    }
  }

  find(config: StrategyConfig): StrategyFork | undefined {
    return this.forks.find((fork) => fork.canHandle(config));
  }

  adapt(config: StrategyConfig, context: MarketContext): StrategyConfig {
    const fork = this.find(config);
    if (!fork) return config;
    try {
      return fork.adapt(config, context);
    } catch (e: any) {
      // On fork error, fall back to the original config to keep the bot running.
      console.warn(`[ForkRegistry] Fork ${fork.id} failed: ${e.message ?? String(e)}`);
      return config;
    }
  }

  list(): StrategyFork[] {
    return [...this.forks];
  }
}
