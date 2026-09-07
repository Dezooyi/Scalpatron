/**
 * Roundtrip-Semantik für die UI: Ein "Trade" ist ein geschlossener Zyklus
 * BUY (Entry) → SELL (Exit). Die recentTrades/Performance-Events liegen je
 * Ereignis (BUY ODER SELL) vor; diese Helper fassen sie zu Trades zusammen,
 * damit kein offener BUY oder jedes Einzel-Event fälschlich als eigener Trade
 * gezählt/dargestellt wird.
 */

export type CycleEvent = {
  timestamp: number;
  action: string;
  price: number;
  amount?: number | null;
  pnlPercent?: number | null;
};

export interface ClosedCycle {
  buy: CycleEvent | null; // null = BUY außerhalb des Event-Fensters (z.B. 50er-Limit)
  sell: CycleEvent;
  holdMs: number | null;
}

export interface CycleResult {
  /** Geschlossene Roundtrips, sortiert nach Exit-Zeit absteigend (neueste zuerst). */
  closed: ClosedCycle[];
  /** Aktuell offener BUY (kein Exit danach), falls vorhanden. */
  openBuy: CycleEvent | null;
}

/**
 * Paart BUY/SELL-Events pro Bot zu geschlossenen Roundtrips.
 * Eingabe darf beliebig sortiert sein (asc/desc); wird intern aufsteigend
 * nach timestamp verarbeitet (FIFO über offene BUYs).
 */
export function buildTradeCycles(events: CycleEvent[]): CycleResult {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

  const openBuys: CycleEvent[] = [];
  const closed: ClosedCycle[] = [];

  for (const e of sorted) {
    if (e.action === 'BUY') {
      openBuys.push(e);
    } else if (e.action === 'SELL') {
      const buy = openBuys.length > 0 ? openBuys.shift()! : null;
      closed.push({
        buy,
        sell: e,
        holdMs: buy ? e.timestamp - buy.timestamp : null,
      });
    }
  }

  closed.sort((a, b) => b.sell.timestamp - a.sell.timestamp);

  return { closed, openBuy: openBuys.length > 0 ? openBuys[openBuys.length - 1] : null };
}

/** Anzahl realisierter Trades (geschlossene Roundtrips) in einem Event-Fenster. */
export function countClosedTrades(events: CycleEvent[]): number {
  return buildTradeCycles(events).closed.length;
}
