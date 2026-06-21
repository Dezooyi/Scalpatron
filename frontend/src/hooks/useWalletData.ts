import { useCallback, useEffect, useRef, useState } from "react";

export type WalletNetwork = "mainnet" | "devnet";
export type WalletTxMode = "ALL" | "paper" | "live";
export type WalletTxType = "ALL" | "BUY" | "SELL";
export type WalletRange = "1h" | "24h" | "7d" | "30d" | "all";

export interface WalletInfo {
  address: string;
  network: WalletNetwork;
  solBalance: number;
  solBalanceUsd?: number;
  tokenCount: number;
  lastUpdate: number;
}

export interface TokenBalance {
  mint: string;
  symbol?: string;
  name?: string;
  balance: number;
  decimals: number;
  usdValue?: number;
}

export interface WalletBalanceSnapshot {
  id: number;
  walletAddress: string;
  mintAddress: string | null;
  balance: number;
  usdValue: number | null;
  source: string;
  botId: string | null;
  timestamp: number;
}

export interface WalletTrade {
  id: number;
  botId: string;
  timestamp: number;
  action: string;
  price: number;
  amount: number | null;
  pnlPercent: number | null;
  status: string;
  paperMode: number;
  signature?: string | null;
  solAmount?: number | null;
  fee?: number | null;
  slippagePct?: number | null;
  source?: string | null;
  solscanUrl?: string | null;
}

export interface OnChainTx {
  signature: string;
  blockTime: number | null;
  slot: number | null;
  fee: number;
  feePayer: string | null;
  err: unknown;
  solscanUrl: string;
}

export interface WalletBotAssignment {
  botId: string;
  botName: string;
  walletAddress: string;
  paperMode?: boolean;
  mintAddress: string;
}

export const getApiBase = (): string =>
  (typeof window !== "undefined" && localStorage.getItem("scalpatron_api_url")) || "";

interface UseWalletDataResult {
  info: WalletInfo | null;
  balances: TokenBalance[];
  transactions: WalletTrade[];
  onchainTxs: OnChainTx[];
  balanceHistory: WalletBalanceSnapshot[];
  bots: WalletBotAssignment[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  triggerSnapshot: () => Promise<boolean>;
}

const REFRESH_INTERVAL_MS = 30_000;

export function useWalletData(autoRefresh = true): UseWalletDataResult {
  const [info, setInfo] = useState<WalletInfo | null>(null);
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [transactions, setTransactions] = useState<WalletTrade[]>([]);
  const [onchainTxs, setOnchainTxs] = useState<OnChainTx[]>([]);
  const [balanceHistory, setBalanceHistory] = useState<WalletBalanceSnapshot[]>([]);
  const [bots, setBots] = useState<WalletBotAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setError(null);
    try {
      const base = getApiBase();
      const [infoRes, balRes, txRes, ocRes, histRes, botsRes] = await Promise.all([
        fetch(`${base}/api/wallet/info`).then(r => r.ok ? r.json() : null),
        fetch(`${base}/api/wallet/balances`).then(r => r.ok ? r.json() : null),
        fetch(`${base}/api/wallet/transactions?limit=200`).then(r => r.ok ? r.json() : null),
        fetch(`${base}/api/wallet/transactions/onchain?limit=25`).then(r => r.ok ? r.json() : null),
        fetch(`${base}/api/wallet/balance/history?range=24h`).then(r => r.ok ? r.json() : null),
        fetch(`${base}/api/wallet/bots`).then(r => r.ok ? r.json() : null),
      ]);
      if (infoRes) setInfo(infoRes);
      if (balRes?.balances) setBalances(balRes.balances);
      if (txRes?.transactions) setTransactions(txRes.transactions);
      if (ocRes?.transactions) setOnchainTxs(ocRes.transactions);
      if (histRes?.history) setBalanceHistory(histRes.history);
      if (botsRes?.bots) setBots(botsRes.bots);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, []);

  const triggerSnapshot = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`${getApiBase()}/api/wallet/snapshot`, { method: "POST" });
      if (!res.ok) return false;
      await refresh();
      return true;
    } catch {
      return false;
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
    if (!autoRefresh) return;
    const interval = setInterval(() => { void refresh(); }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh, autoRefresh]);

  return { info, balances, transactions, onchainTxs, balanceHistory, bots, loading, error, refresh, triggerSnapshot };
}

export function shortenAddress(address: string, head = 4, tail = 4): string {
  if (!address) return "";
  if (address.length <= head + tail + 3) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

export function formatSol(value: number, decimals = 4): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(decimals)} SOL`;
}

export function formatUsd(value?: number): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

export function formatTokenAmount(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  if (value < 0.0001) return value.toExponential(2);
  if (value < 1) return value.toFixed(Math.min(decimals + 2, 6));
  if (value < 1000) return value.toFixed(decimals);
  if (value < 1_000_000) return `${(value / 1000).toFixed(2)}K`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}

export function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}