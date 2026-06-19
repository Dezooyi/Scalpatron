import { useEffect, useMemo, useState } from "react";
import type { BotState } from "@/App";
import {
  type PerformanceTrade,
  type PerformanceFilters,
  type PerformanceMetrics,
  type PerBotMetrics,
  TIMEFRAME_MS,
  computeMetrics,
  computePerBotMetrics,
} from "@/lib/performanceMetrics";

const POLL_INTERVAL_MS = 15_000;

export interface PerformanceData {
  trades: PerformanceTrade[];
  metrics: PerformanceMetrics;
  perBot: PerBotMetrics[];
  loading: boolean;
  error: string | null;
}

function getApiBase(): string {
  try {
    return localStorage.getItem("scalpatron_api_url") ?? "";
  } catch {
    return "";
  }
}

/**
 * Holt Trades vom Backend (/api/performance) und wendet die Filter an.
 * Zeitfenster + Bot-Auswahl werden serverseitig gefiltert (über Query-Params),
 * Status/Modus/Strategie/Outcome clientseitig anhand der Live-Bot-Metadaten.
 *
 * Der Fetch wird auch dann neu ausgelöst, wenn sich die Bot-Liste ändert
 * (neuer Bot erstellt / gelöscht), damit die Performance-Tabelle nicht bis zum
 * nächsten 15s-Polling-Intervall veraltet bleibt.
 */
export function usePerformanceData(
  bots: BotState[],
  filters: PerformanceFilters,
): PerformanceData {
  const [rawTrades, setRawTrades] = useState<PerformanceTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dependency-Key für den Fetch: ändert sich bei Filter-Wechseln
  // sowie bei jeder Änderung der Bot-Liste.
  const fetchKey =
    `${filters.timeframe}|${[...filters.botIds].sort().join(",")}|${filters.mode}` +
    `|${bots.map((b) => b.id).sort().join(",")}`;

  useEffect(() => {
    let cancelled = false;
    const apiBase = getApiBase();

    const run = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        const ms = TIMEFRAME_MS[filters.timeframe];
        if (ms !== null) {
          params.set("from", String(Date.now() - ms));
        }
        if (filters.botIds.length > 0) {
          params.set("botIds", filters.botIds.join(","));
        }
        // Mode (paper/live) wird serverseitig pro Trade gefiltert (exakt)
        if (filters.mode !== "all") {
          params.set("mode", filters.mode);
        }
        const url = `${apiBase}/api/performance${params.toString() ? `?${params.toString()}` : ""}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { trades: Array<Record<string, unknown>> };
        if (!cancelled) {
          // paperMode (0/1) zu boolean normalisieren; Default paper bei fehlendem Wert
          const normalized: PerformanceTrade[] = (Array.isArray(data.trades) ? data.trades : []).map((t) => ({
            botId: String(t.botId),
            timestamp: Number(t.timestamp),
            action: String(t.action),
            price: Number(t.price),
            amount: typeof t.amount === "number" ? t.amount : null,
            pnlPercent: typeof t.pnlPercent === "number" ? t.pnlPercent : null,
            paperMode: t.paperMode === 0 ? false : true,
          }));
          setRawTrades(normalized);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Fetch failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();

    // Live-Polling für aktualisierte Metriken
    const interval = setInterval(run, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey]);

  // Lookup-Tabelle: botId -> Bot-Metadaten für clientseitige Filter
  const botMeta = useMemo(() => {
    const map = new Map<string, { status: string; paperMode: boolean; strategyType?: string }>();
    for (const b of bots) {
      map.set(b.id, {
        status: b.status,
        paperMode: b.paperMode ?? true,
        strategyType: b.strategyType ?? "scalping",
      });
    }
    return map;
  }, [bots]);

  // Clientseitige Filter anwenden (Status/Strategie anhand aktueller Bot-Metadaten,
  // Outcome anhand PnL). Paper/Live-Modus wird serverseitig pro Trade gefiltert.
  const filteredTrades = useMemo(() => {
    return rawTrades.filter((t) => {
      const meta = botMeta.get(t.botId);
      if (!meta) {
        // Bot evtl. gelöscht — nur einbeziehen wenn keine Bot-spezifischen Filter aktiv
        if (filters.status !== "all" || filters.strategy !== "all") {
          return false;
        }
      } else {
        if (filters.status !== "all" && meta.status !== filters.status) return false;
        if (filters.strategy !== "all" && meta.strategyType !== filters.strategy) return false;
      }

      if (filters.outcome !== "all" && t.action === "SELL") {
        const pnl = t.pnlPercent ?? 0;
        if (filters.outcome === "wins" && pnl <= 0) return false;
        if (filters.outcome === "losses" && pnl >= 0) return false;
      }
      return true;
    });
  }, [rawTrades, botMeta, filters.status, filters.strategy, filters.outcome]);

  const metrics = useMemo(() => computeMetrics(filteredTrades), [filteredTrades]);
  const perBot = useMemo(() => computePerBotMetrics(filteredTrades), [filteredTrades]);

  return { trades: filteredTrades, metrics, perBot, loading, error };
}
