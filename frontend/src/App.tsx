import { useState, useEffect, useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import {
  loadAnimationConfig,
  type AnimationConfig,
  getBoxShadowValues,
} from "@/lib/animationConfig";
import {
  Play,
  Square,
  Plus,
  Activity,
  Settings,
  Database,
  Server,
  Moon,
  Sun,
  BookOpen,
  RefreshCw,
  BrainCircuit,
  Terminal,
  Zap,
  Trash2,
  SlidersHorizontal,
  FlaskConical,
  Flame,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUp,
  ArrowDown,
  Info,
  Puzzle,
} from "lucide-react";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import Documentation from "@/components/Documentation";
import GlobalSettings from "@/components/GlobalSettings";
import { LogFeedList } from "@/components/LogFeedList";
import type { LogFeedRowData, BadgeVariant } from "@/components/LogFeedList";
import { Ripple } from "@/components/Ripple";
import { useConfirm } from "@/components/ConfirmDialog";
import { ScannerPulse } from "@/components/ScannerPulse";
import { LastActivityCard } from "@/components/LastActivityCard";
import { LiveFeedListCard } from "@/components/LiveFeedListCard";
import { BotTelemetry } from "@/components/BotTelemetry";
import { useTooltip } from "@/components/GlobalTooltip";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getStrategyIcon, getStrategyColor } from "@/lib/botUtils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CreateBotDialog } from "@/components/CreateBotDialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type BotSettings = {
  floorWindow: number;
  spikeThreshold: number;
  sellDropThreshold: number;
  cooldownTicks: number;
};

export type BotPosition = {
  entryPrice: number;
  entryTime: number;
  amount: number;
};

export type BotStats = {
  totalTrades: number;
  wins: number;
  losses: number;
  totalPnlPercent: number;
  openPositionsCount?: number;
  currentPosition: BotPosition | null;
  balanceSOL: number;
  balanceUGOR: number;
  lastPrice: number;
};

export type Trade = {
  timestamp: number;
  action: string;
  price: number;
  pnlPercent?: number;
  pnl?: number;
  exitPrice?: number;
};

type LogEntry = {
  level: string;
  source?: string;
  botId?: string;
  message: string;
  timestamp: number;
};

export type { LogEntry };

export type AgentAdviceEntry = {
  botId: string;
  advice?: {
    regime?: string;
    confidence?: number;
    reason?: string;
    analysis?: string;
    timestamp?: number;
    adjustedSettings?: Partial<BotSettings>;
    previousSettings?: Partial<BotSettings>;
  };
};

/**
 * Custom Hook zur Erkennung des aktuellen Breakpoints
 * Gibt die Anzahl der Spalten zurück, die im aktuellen Breakpoint angezeigt werden
 *
 * Grid-Konfiguration:
 * - Default (< 640px): 1 Spalte
 * - sm (>= 640px): 1 Spalte
 * - md (>= 768px): 2 Spalten
 * - lg (>= 1024px): 3 Spalten
 * - xl (>= 1280px): 4 Spalten
 */
function useGridColumns(): number {
  const [columns, setColumns] = useState(1);

  useEffect(() => {
    const updateColumns = () => {
      const width = window.innerWidth;
      if (width >= 1280) {
        setColumns(4); // xl: grid-cols-4
      } else if (width >= 1024) {
        setColumns(3); // lg: grid-cols-3
      } else if (width >= 768) {
        setColumns(2); // md: grid-cols-2
      } else {
        setColumns(1); // default: grid-cols-1
      }
    };

    updateColumns();
    window.addEventListener('resize', updateColumns);
    return () => window.removeEventListener('resize', updateColumns);
  }, []);

  return columns;
}

function formatUptime(startTime?: number): string {
  if (!startTime) return "—";
  const sec = Math.floor((Date.now() - startTime) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hrs = Math.floor(min / 60);
  const remMin = min % 60;
  if (hrs < 24) return remMin > 0 ? `${hrs}h ${remMin}m` : `${hrs}h`;
  const days = Math.floor(hrs / 24);
  const remHrs = hrs % 24;
  return remHrs > 0 ? `${days}d ${remHrs}h` : `${days}d`;
}

export type AgentHistoryEntry = {
  botId: string;
  timestamp: number;
  regime?: string;
  confidence?: number;
  reason?: string;
  analysis?: string;
  adjustedSettings?: BotSettings | string;
  aggressivenessAdvice?: number;
  outcomeTradeCount?: number;
  outcomeTotalPnl?: number;
  outcomeWins?: number;
};

type RegimePerformance = {
  regime: string;
  winRate: number;
  avgPnl: number;
  totalTrades: number;
};

type IndicatorDef = {
  type: string;
  period?: number;
  fast_period?: number;
  slow_period?: number;
};

type StrategyTemplate = {
  id: string;
  strategy_name: string;
  strategy_type: string;
  description?: string;
  isTemplate?: boolean;
  indicators?: IndicatorDef[];
  system_prompt?: string;
};

type StrategyConfig = {
  id?: string;
  strategy_name: string;
  strategy_type: string;
  description?: string;
  market: { symbol: string; timeframe: string; exchange: string };
  indicators: Array<{
    type: string;
    period?: number;
    fast_period?: number;
    slow_period?: number;
    signal_period?: number;
    std_dev?: number;
    k_period?: number;
    d_period?: number;
    window?: number;
  }>;
  entry_conditions: Array<{ left: string; operator: string; right: string | number }>;
  exit_conditions: Array<{ type: string; value?: number; trailing_pct?: number; condition?: any }>;
  risk_management: { position_size: number; max_positions: number; leverage: number; max_drawdown?: number };
  execution: { order_type: string; slippage_tolerance: number };
  scalping_settings?: { floorWindow?: number; spikeThreshold?: number; sellDropThreshold?: number; cooldownTicks?: number };
  system_prompt?: string;
  isTemplate?: boolean;
  grid_levels?: number | string;
};

type SystemPromptInfo = {
  source: 'custom' | 'strategy' | 'auto';
  effectivePrompt: string;
  autoPrompt: string;
  strategyPrompt: string | null;
  customPrompt: string | null;
  strategyName: string | null;
  strategyType: string;
};

type AgentConfigType = {
  provider?: 'ollama' | 'opencode';
  model: string;
  cycleMinutes: number;
  temperature: number;
  maxTokens: number;
  minConfidence: number;
  autoApply: boolean;
  systemPrompt: string;
};

export type BotState = {
  id: string;
  name: string;
  mintAddress: string;
  settings: BotSettings;
  stats: BotStats;
  status: "running" | "paused" | "stopped";
  paperMode?: boolean;
  walletAddress?: string;
  tradeSize?: number;
  aggressiveness?: number;       // user max ceiling
  aiAggressiveness?: number;     // current AI-set effective value
  tradingMode?: "fixed" | "aggressive";
  recentTrades?: Trade[];
  priceHistory?: number[];
  lastPoll?: number;
  totalTicks?: number;
  startTime?: number;
  strategyId?: string;
  strategyType?: string;
  strategyConfig?: StrategyConfig;
};

type TokenInfo = {
  mintAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  priceUsd?: number;
  volume24h?: number;
  liquidity?: number;
  priceChange24h?: number;
  createdAt?: number;
  isActive: boolean;
  lastPoll?: number;
};

type SettingsChange = {
  key: keyof BotSettings;
  oldValue: number;
  newValue: number;
  changePercent: number;
  timestamp: number;
};

type BotSettingsChanges = Record<string, SettingsChange[]>;

const getApiBase = () =>
  localStorage.getItem('scalpatron_api_url') ?? 'http://localhost:3000';

export default function App() {
  const confirm = useConfirm();
  const tooltip = useTooltip();
  const [bots, setBots] = useState<BotState[]>([]);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [deletingBotId, setDeletingBotId] = useState<string | null>(null);
  const [serverStatus, setServerStatus] = useState<
    "connected" | "disconnected"
  >("disconnected");
  
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [agentAdvice, setAgentAdvice] = useState<AgentAdviceEntry[]>([]);
  const [terminalLogs, setTerminalLogs] = useState<Record<string, LogEntry[]>>({});
  
  // AI Settings Changes pro Bot
  const [botSettingsChanges, setBotSettingsChanges] = useState<BotSettingsChanges>({});
  
  // Strategy Assistant States
  const [agentStatus, setAgentStatus] = useState<{ status: string; model: string; regime: string; cycle: number; running: boolean; analyzing: boolean } | null>(null);
  const [agentConfig, setAgentConfig] = useState<AgentConfigType | null>(null);
  const [agentHistory, setAgentHistory] = useState<AgentHistoryEntry[]>([]);
  const [agentModels, setAgentModels] = useState<string[]>([]);
  const [selectedHistoryBot, setSelectedHistoryBot] = useState<string>("all");
  const [configStatus, setConfigStatus] = useState<string>("");
  const [isTriggering, setIsTriggering] = useState(false);
  const [regimePerformance, setRegimePerformance] = useState<RegimePerformance[]>([]);
  const [strategyTemplates, setStrategyTemplates] = useState<StrategyTemplate[]>([]);
  const [newBotStrategyId, setNewBotStrategyId] = useState<string>("");

  // Strategien Tab State
  const [savedStrategies, setSavedStrategies] = useState<StrategyTemplate[]>([]);
  const [strategySubTab, setStrategySubTab] = useState<"templates" | "saved" | "editor">("templates");
  const [strategyFilter, setStrategyFilter] = useState<string>("all");
  const [strategyEditorJson, setStrategyEditorJson] = useState<string>("");
  const [strategyEditorSystemPrompt, setStrategyEditorSystemPrompt] = useState<string>("");
  const [strategyEditorError, setStrategyEditorError] = useState<string>("");
  const [strategyEditorValid, setStrategyEditorValid] = useState<boolean>(false);
  const [strategySaveStatus, setStrategySaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Assistent Sub-Tab State
  const [assistentBotId, setAssistentBotId] = useState<string>("");
  const [assistentPromptInfo, setAssistentPromptInfo] = useState<SystemPromptInfo | null>(null);
  const [assistentEditMode, setAssistentEditMode] = useState(false);
  const [assistentEditValue, setAssistentEditValue] = useState<string>("");
  const [assistentSaveStatus, setAssistentSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Live indicator values per bot (from GET /api/bots/:id/indicators)
  const [botIndicators, setBotIndicators] = useState<Record<string, { latestValues: Record<string, number>; strategyName: string; strategyType: string }>>({});

  // Token Whitelist State
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [isAddTokenDialogOpen, setIsAddTokenDialogOpen] = useState(false);
  const [newTokenMintAddress, setNewTokenMintAddress] = useState("");
  const [lookupResult, setLookupResult] = useState<Partial<TokenInfo> | null>(null);
  
  // Grid-Spalten-Anzahl für responsive Bot-Button-Größen
  const gridColumns = useGridColumns();
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [selectedTokenInfo, setSelectedTokenInfo] = useState<Partial<TokenInfo> | null>(null);
  
  // Create Bot Dialog State
  const [newBotName, setNewBotName] = useState("");
  const [newBotMintAddress, setNewBotMintAddress] = useState("");
  const [showTokenWhitelist, setShowTokenWhitelist] = useState(false);
  const [newBotWalletAddress, setNewBotWalletAddress] = useState("");
  const [newBotTradingMode, setNewBotTradingMode] = useState<"fixed" | "aggressive">("fixed");
  const [newBotTradeSize, setNewBotTradeSize] = useState(1);
  const [newBotAggressiveness, setNewBotAggressiveness] = useState(10);
  const [isCreateBotDialogOpen, setIsCreateBotDialogOpen] = useState(false);

  // Global Settings (cached for CreateBot dialog defaults)
  const [globalSettings, setGlobalSettings] = useState({ initialSOL: 10, tradeSize: 1, paperMode: true });

  // Inline Bot Settings Panel
  const [botSettingsPanelId, setBotSettingsPanelId] = useState<string | null>(null);
  const [botSettingsDraft, setBotSettingsDraft] = useState<{ floorWindow: number; spikeThreshold: number; sellDropThreshold: number; cooldownTicks: number; tradeSize: number; aggressiveness: number; tradingMode: "fixed" | "aggressive"; walletAddress: string; strategyConfigDraft: StrategyConfig | null }>({ floorWindow: 20, spikeThreshold: 0.3, sellDropThreshold: 0.15, cooldownTicks: 5, tradeSize: 1, aggressiveness: 10, tradingMode: "fixed", walletAddress: "", strategyConfigDraft: null });
  const [botSettingsSaveStatus, setBotSettingsSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [tradeFlash, setTradeFlash] = useState<Record<string, "buy" | "sell" | null>>({});
  const [aiFlash, setAiFlash] = useState<Record<string, boolean>>({});
  const prevTradeCountRef = useRef<Record<string, number>>({});

  // Reset Dialog State
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetBotId, setResetBotId] = useState<string | null>(null);
  const [resetOptions, setResetOptions] = useState({ clearTrades: true, clearPrices: false, resetSettings: false, restartBot: true });
  const [isResetting, setIsResetting] = useState(false);

  // Bot Info Panel State
  const [botInfoPanelId, setBotInfoPanelId] = useState<string | null>(null);

  const logEndRef = useRef<HTMLDivElement>(null);
  const globalPulseCircle1Ref = useRef<HTMLDivElement>(null);
  const globalPulseCircle2Ref = useRef<HTMLDivElement>(null);
  const globalPulseCircle3Ref = useRef<HTMLDivElement>(null);
  const globalPulseContainerRef = useRef<HTMLDivElement>(null);

  // Detect new trades and trigger flash animation
  useEffect(() => {
    bots.forEach((bot) => {
      const latestTrade = bot.recentTrades?.[0];
      const currTs = latestTrade?.timestamp ?? 0;
      const prevTs = prevTradeCountRef.current[bot.id] ?? 0;
      if (currTs > prevTs && prevTs > 0) {
        const flashType = latestTrade?.action === "BUY" ? "buy" : "sell";
        setTradeFlash((f) => ({ ...f, [bot.id]: flashType }));
        setTimeout(() => setTradeFlash((f) => ({ ...f, [bot.id]: null })), 1700);
      }
      if (currTs > 0) prevTradeCountRef.current[bot.id] = currTs;
    });
  }, [bots]);

  // Auto-scroll logs
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [terminalLogs]);

  // Apply Theme
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // Globale Animation-Konfiguration
  const [animConfig] = useState<AnimationConfig>(loadAnimationConfig());

  // GSAP Animation Hook für Trade-Flash (Buy/Sell) mit globaler Konfiguration
  useGSAP(() => {
    if (!animConfig.enabled) return;
    
    const botIds = Object.keys(tradeFlash);
    botIds.forEach((botId) => {
      const flashType = tradeFlash[botId];
      if (flashType) {
        const baseColor = flashType === "buy"
          ? "rgb(34, 197, 94)"  // green-500
          : "rgb(239, 68, 68)"; // red-500
        
        // Kill any existing animation on this element
        gsap.killTweensOf(`.trade-flash-target-${botId}`);
        
        // Use configured values
        const pulseShadow = getBoxShadowValues(animConfig, baseColor, "pulse");
        const holdShadow = getBoxShadowValues(animConfig, baseColor, "hold");
        
        // Animation with configured timing
        gsap.timeline()
          .to(`.trade-flash-target-${botId}`, {
            boxShadow: pulseShadow,
            duration: animConfig.pulseDuration,
            ease: animConfig.easeType
          })
          .to(`.trade-flash-target-${botId}`, {
            boxShadow: holdShadow,
            duration: animConfig.holdDuration,
            ease: animConfig.easeType
          })
          .to(`.trade-flash-target-${botId}`, {
            boxShadow: "0 0 0 0 rgba(0,0,0,0)",
            duration: animConfig.fadeDuration,
            ease: animConfig.easeType,
            onComplete: () => setTradeFlash(f => ({ ...f, [botId]: null }))
          });
      }
    });
  }, [tradeFlash, animConfig]);

  // GSAP Animation Hook für AI-Update-Flash (Purple) mit globaler Konfiguration
  useGSAP(() => {
    if (!animConfig.enabled) return;
    
    const botIds = Object.keys(aiFlash);
    botIds.forEach((botId) => {
      if (aiFlash[botId]) {
        const baseColor = "rgb(168, 85, 247)"; // purple-500
        
        // Kill any existing animation on this element
        gsap.killTweensOf(`.ai-flash-target-${botId}`);
        
        // Use configured values
        const pulseShadow = getBoxShadowValues(animConfig, baseColor, "pulse");
        const holdShadow = getBoxShadowValues(animConfig, baseColor, "hold");
        
        // Animation with configured timing
        gsap.timeline()
          .to(`.ai-flash-target-${botId}`, {
            boxShadow: pulseShadow,
            duration: animConfig.pulseDuration,
            ease: animConfig.easeType
          })
          .to(`.ai-flash-target-${botId}`, {
            boxShadow: holdShadow,
            duration: animConfig.holdDuration,
            ease: animConfig.easeType
          })
          .to(`.ai-flash-target-${botId}`, {
            boxShadow: "0 0 0 0 rgba(0,0,0,0)",
            duration: animConfig.fadeDuration,
            ease: animConfig.easeType,
            onComplete: () => setAiFlash(f => ({ ...f, [botId]: false }))
          });
      }
    });
  }, [aiFlash, animConfig]);

  useEffect(() => {
    const sse = new EventSource(`${getApiBase()}/api/stream`);

    sse.onopen = () => setServerStatus("connected");
    sse.onerror = () => setServerStatus("disconnected");

    sse.addEventListener("state", (e) => {
      try {
        const data = JSON.parse(e.data);
        console.log(
          `[SSE] State received: ${data.length} bots. First bot price history:`,
          data[0]?.priceHistory?.length,
        );
        setBots(data);
      } catch (err) {
        console.error("SSE Parse Error", err);
      }
    });

    sse.addEventListener("agent_advice", (e) => {
      try {
        const data = JSON.parse(e.data);
        setAgentAdvice((prev) => [data, ...prev].slice(0, 50));

        // History direkt aktualisieren wenn neue Analyse
        if (data.advice) {
          setAgentHistory((prev) => {
            const newEntry = {
              botId: data.botId,
              timestamp: data.advice.timestamp || Date.now(),
              regime: data.advice.regime,
              confidence: data.advice.confidence,
              reason: data.advice.reason,
              analysis: data.advice.analysis,
              adjustedSettings: data.advice.adjustedSettings,
              applied: true,
            };
            return [newEntry, ...prev].slice(0, 100);
          });
        }
        
        // Settings Changes speichern für animiertes Badge + Live Feed Inline-Anzeige
        if (data.botId && data.advice?.adjustedSettings) {
          const newSettings = data.advice.adjustedSettings;
          const previousSettings = data.advice.previousSettings || {};
          const changes: SettingsChange[] = [];

          for (const [key, rawNew] of Object.entries(newSettings)) {
            const typedKey = key as keyof BotSettings;
            const newValue = typeof rawNew === 'number' ? rawNew : parseFloat(String(rawNew));
            if (isNaN(newValue)) continue;
            const rawOld = previousSettings[typedKey];
            const oldValue = rawOld !== undefined
              ? (typeof rawOld === 'number' ? rawOld : parseFloat(String(rawOld)))
              : newValue;
            const changePercent = oldValue !== 0
              ? ((newValue - oldValue) / oldValue) * 100
              : (newValue > 0 ? 100 : 0);
            changes.push({ key: typedKey, oldValue, newValue, changePercent, timestamp: Date.now() });
          }

          // Auch setzen wenn adjustedSettings Einträge hat aber previousSettings fehlt
          if (Object.keys(newSettings).length > 0) {
            setBotSettingsChanges((prev) => ({
              ...prev,
              [data.botId]: changes.length > 0 ? changes : Object.entries(newSettings).map(([key, val]) => ({
                key: key as keyof BotSettings,
                oldValue: parseFloat(String(val)),
                newValue: parseFloat(String(val)),
                changePercent: 0,
                timestamp: Date.now(),
              })),
            }));
            
            // AI-Flash Animation triggern
            setAiFlash((f) => ({ ...f, [data.botId]: true }));
            setTimeout(() => setAiFlash((f) => ({ ...f, [data.botId]: false })), 1500);
          }
        }
      } catch (err) {
        console.error("SSE Parse Error Agent", err);
      }
    });

    sse.addEventListener("agent_status", (e) => {
      try {
        const data = JSON.parse(e.data);
        console.log("[SSE] Agent Status:", data);
        setAgentStatus({
          running: data.running ?? false,
          analyzing: data.analyzing ?? false,
          model: data.config?.model ?? '-',
          cycle: data.config?.cycleMinutes ?? 0,
          regime: '-',
          status: data.running ? 'running' : 'stopped',
        });
        // Config auch aktualisieren
        if (data.config) {
          setAgentConfig({
            ...data.config,
            temperature: Math.round((data.config.temperature ?? 0.3) * 100),
            minConfidence: Math.round((data.config.minConfidence ?? 0.4) * 100),
          });
        }
      } catch (err) {
        console.error("SSE Parse Error Agent Status", err);
      }
    });

    sse.addEventListener("terminal_log", (e) => {
      try {
        const entry = JSON.parse(e.data);
        setTerminalLogs((prev) => {
          const botLogs = prev[entry.botId] || [];
          return {
            ...prev,
            [entry.botId]: [...botLogs, entry].slice(-100),
          };
        });
      } catch (err) {
        console.error("SSE Parse Error Terminal", err);
      }
    });

    return () => sse.close();
  }, []);

  // Initial Fetch Fallback
  useEffect(() => {
    const fetchBots = async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/bots`);
        const data = await res.json();
        setBots(data);
        console.log("[Init] Bots initial geladen:", data.length);
      } catch (err) {
        console.error("[Init] Fetch error:", err);
      }
    };
    fetchBots();
  }, []);

  // Fetch Global Settings on mount
  useEffect(() => {
    fetch(`${getApiBase()}/api/settings`)
      .then((r) => r.json())
      .then((data) => setGlobalSettings((prev) => ({ ...prev, ...data })))
      .catch(() => {});
    // Fetch strategy templates on mount so Create Bot dialog has them ready
    fetch(`${getApiBase()}/api/strategies/templates`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setStrategyTemplates(d); })
      .catch(() => {});
  }, []);
  
  // Load historical price data on mount
  useEffect(() => {
    const fetchPriceHistory = async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/prices/history`);
        const data = await res.json();
        console.log("[Init] Price History geladen:", data.length, "Preise");
        // Price history is now loaded and will be used by bots via SSE updates
      } catch (err) {
        console.error("[Init] Price History Fetch error:", err);
      }
    };
    fetchPriceHistory();
  }, []);

  // Auto-select first bot on data load
  useEffect(() => {
    if (bots.length > 0 && !selectedBotId) {
      setSelectedBotId(bots[0].id);
    }
  }, [bots, selectedBotId]);

  // Fetch live token info (price change, volume, liquidity) when selected bot changes
  useEffect(() => {
    const mintAddress = bots.find(b => b.id === selectedBotId)?.mintAddress;
    if (!mintAddress) { setSelectedTokenInfo(null); return; }
    let cancelled = false;
    fetch(`${getApiBase()}/api/tokens/lookup/${mintAddress}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (!cancelled) setSelectedTokenInfo(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedBotId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load Agent data when tab changes
  // Load agent data when tab opens; reload history when bot filter changes
  useEffect(() => {
    loadAgentHistory(selectedHistoryBot === "all" ? undefined : selectedHistoryBot);
    
    if (activeTab === "agent") {
      loadAgentStatus();
      loadAgentModels();
      // Load regime performance
      const botId = selectedHistoryBot !== "all" ? selectedHistoryBot : undefined;
      const perfUrl = botId
        ? `${getApiBase()}/api/agent/regime-performance?botId=${botId}`
        : `${getApiBase()}/api/agent/regime-performance`;
      fetch(perfUrl).then(r => r.json()).then(d => { if (Array.isArray(d)) setRegimePerformance(d); }).catch(() => {});
      // Load strategy templates
      fetch(`${getApiBase()}/api/strategies/templates`).then(r => r.json()).then(d => {
        if (Array.isArray(d)) setStrategyTemplates(d);
      }).catch(() => {});
    }
  }, [activeTab, selectedHistoryBot]);

  const toggleBotStatus = async (id: string, currentStatus: string) => {
    const nextStatus = currentStatus === "running" ? "stopped" : "running";
    await fetch(`${getApiBase()}/api/bots/${id}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
  };

  const deleteBot = async (id: string) => {
    const ok = await confirm({
      title: "Delete Bot",
      message: "Are you sure? All trades for this bot will also be removed.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    
    // Start fade-out animation
    setDeletingBotId(id);
    
    try {
      const res = await fetch(`${getApiBase()}/api/bots/${id}`, {
        method: "DELETE",
      });
      
      if (res.ok) {
        // Wait for animation to complete before removing from list
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Remove from bots list
        const remaining = bots.filter(b => b.id !== id);
        setBots(remaining);
        
        // Clear selection if needed
        if (selectedBotId === id) {
          setSelectedBotId(remaining[0]?.id || null);
        }
      }
    } catch (err) {
      console.error("Delete Bot Error:", err);
    } finally {
      setDeletingBotId(null);
    }
  };

  const openBotSettingsPanel = (bot: BotState) => {
    if (botSettingsPanelId === bot.id) {
      setBotSettingsPanelId(null);
      return;
    }
    setBotSettingsDraft({
      ...bot.settings,
      tradeSize: bot.tradeSize ?? 1,
      aggressiveness: bot.aggressiveness ?? 10,
      tradingMode: bot.tradingMode ?? "fixed",
      walletAddress: bot.walletAddress ?? "",
      strategyConfigDraft: bot.strategyConfig ? JSON.parse(JSON.stringify(bot.strategyConfig)) : null,
    });
    setBotSettingsPanelId(bot.id);
    setBotSettingsSaveStatus("idle");
  };

  const saveBotSettings = async (id: string) => {
    try {
      const { tradeSize, aggressiveness, tradingMode, walletAddress,
              floorWindow, spikeThreshold, sellDropThreshold, cooldownTicks,
              strategyConfigDraft } = botSettingsDraft;
      const stratType = strategyConfigDraft?.strategy_type ?? 'scalping';

      // Always save trade config + scalping pattern settings if applicable
      const settingsRes = await fetch(`${getApiBase()}/api/bots/${id}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tradeSize, aggressiveness, tradingMode, walletAddress,
          ...(stratType === 'scalping' ? { floorWindow, spikeThreshold, sellDropThreshold, cooldownTicks } : {}),
        }),
      });
      if (!settingsRes.ok) throw new Error();

      // For non-scalping strategies: also push updated strategyConfig
      if (stratType !== 'scalping' && strategyConfigDraft) {
        const stratRes = await fetch(`${getApiBase()}/api/bots/${id}/strategy`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ strategyConfig: strategyConfigDraft }),
        });
        if (!stratRes.ok) throw new Error();
      }

      setBotSettingsSaveStatus("saved");
      setTimeout(() => setBotSettingsSaveStatus("idle"), 2500);
    } catch {
      setBotSettingsSaveStatus("error");
      setTimeout(() => setBotSettingsSaveStatus("idle"), 2500);
    }
  };

  const handleBotReset = async (botId: string, options: { clearTrades: boolean; clearPrices: boolean; resetSettings: boolean; restartBot: boolean }) => {
    setIsResetting(true);
    try {
      const res = await fetch(`${getApiBase()}/api/bots/${botId}/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options),
      });
      if (!res.ok) throw new Error("Reset failed");
      setResetDialogOpen(false);
      setResetBotId(null);
      // Optional: Success toast could be added here
    } catch (error) {
      console.error("Bot reset error:", error);
      alert("Bot Reset fehlgeschlagen: " + (error as Error).message);
    } finally {
      setIsResetting(false);
    }
  };

  const openResetDialog = (bot: BotState) => {
    setResetBotId(bot.id);
    setResetOptions({ clearTrades: true, clearPrices: false, resetSettings: false, restartBot: true });
    setResetDialogOpen(true);
  };

  const openBotInfoPanel = (bot: BotState) => {
    if (botInfoPanelId === bot.id) {
      setBotInfoPanelId(null);
      return;
    }
    setBotInfoPanelId(bot.id);
  };


  const createDemoBot = async () => {
    const botName = newBotName || "New Custom Bot";
    const botMintAddress = newBotMintAddress.trim();
    if (!botMintAddress) {
      alert("Bitte eine Token Mint-Adresse eingeben.");
      return;
    }

    try {
      const res = await fetch(`${getApiBase()}/api/bots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: botName,
          mintAddress: botMintAddress,
          initialSOL: globalSettings.initialSOL,
          paperMode: globalSettings.paperMode,
          walletAddress: newBotWalletAddress.trim(),
          tradeSize: newBotTradeSize,
          aggressiveness: newBotAggressiveness,
          tradingMode: newBotTradingMode,
          strategyId: newBotStrategyId || undefined,
        }),
      });

      if (res.ok) {
        const newBot = await res.json();
        // Auto-select the newly created bot
        if (newBot && newBot.id) {
          setSelectedBotId(newBot.id);
        }
        // Smoothly close the dialog
        setIsCreateBotDialogOpen(false);
      }
    } catch (err) {
      console.error("[Bot] Create error:", err);
    }

    // Reset form
    setNewBotName("");
    setNewBotMintAddress("");
    setNewBotWalletAddress("");
    setNewBotTradingMode("fixed");
    setNewBotTradeSize(1);
    setNewBotAggressiveness(10);
  };

  // ==================== STRATEGY ASSISTANT (KI AGENT) FUNCTIONS ====================
  
  // Load Agent Status
  const loadAgentStatus = async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/agent/status`);
      const data = await res.json();
      console.log("[Agent] Status loaded:", data);
      setAgentStatus({
        running: data.running ?? false,
        analyzing: data.analyzing ?? false,
        model: data.config?.model ?? '-',
        cycle: data.config?.cycleMinutes ?? 0,
        regime: '-',
        status: data.running ? 'running' : 'stopped',
      });
      if (data.config) {
        // Backend sendet Dezimalwerte (0.3, 0.4), Frontend erwartet Integer (30, 40)
        setAgentConfig({
          ...data.config,
          temperature: Math.round((data.config.temperature ?? 0.3) * 100),
          minConfidence: Math.round((data.config.minConfidence ?? 0.4) * 100),
        });
      }
    } catch (err) {
      console.error("[Agent] Status fetch error:", err);
    }
  };

  // Load Agent Models
  const loadAgentModels = async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/agent/models`);
      const data = await res.json();
      // Server gibt Array von OllamaModelInfo zurück: [{ name, size, parameter_size, family }, ...]
      if (Array.isArray(data)) {
        setAgentModels(data.map((m: { name: string }) => m.name));
      } else {
        setAgentModels([]);
      }
    } catch (err) {
      console.error("[Agent] Models fetch error:", err);
      setAgentModels([]);
    }
  };

  // Load Agent History
  const loadAgentHistory = async (botId?: string) => {
    try {
      const url = botId
        ? `${getApiBase()}/api/agent/history?botId=${botId}&limit=50`
        : `${getApiBase()}/api/agent/history?limit=50`;
      const res = await fetch(url);
      const data = await res.json();
      // Sicherstellen, dass data ein Array ist
      if (Array.isArray(data)) {
        // adjustedSettings JSON-String parsen (Backend speichert als JSON-String)
        const parsed = data.map((entry: { adjustedSettings: string | object; botId: string; timestamp: number }) => {
          const { adjustedSettings, ...rest } = entry;
          return {
            ...rest,
            adjustedSettings: typeof adjustedSettings === 'string'
              ? JSON.parse(adjustedSettings)
              : adjustedSettings,
          } as AgentHistoryEntry;
        });
        setAgentHistory(parsed);
      } else {
        console.warn("[Agent] History response is not an array:", data);
        setAgentHistory([]);
      }
    } catch (err) {
      console.error("[Agent] History fetch error:", err);
      setAgentHistory([]);
    }
  };

  // Update Agent Config
  const updateAgentConfig = async (config: Partial<AgentConfigType>) => {
    setConfigStatus("Speichere...");
    // Frontend sendet Integer (30, 40), Backend erwartet Dezimal (0.3, 0.4)
    const backendConfig = {
      ...config,
      temperature: (config.temperature ?? 30) / 100,
      minConfidence: (config.minConfidence ?? 40) / 100,
    };
    try {
      const res = await fetch(`${getApiBase()}/api/agent/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(backendConfig),
      });
      if (res.ok) {
        setConfigStatus("Gespeichert!");
        setTimeout(() => setConfigStatus(""), 2000);
        loadAgentStatus();
      } else {
        setConfigStatus("Fehler beim Speichern");
      }
    } catch (err) {
      console.error("[Agent] Config update error:", err);
      setConfigStatus("Fehler beim Speichern");
    }
  };

  // Start Agent
  const startAgent = async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/agent/start`, { method: "POST" });
      const data = await res.json();
      console.log("[Agent] Start response:", data);
      setConfigStatus("Agent gestartet");
      setTimeout(() => loadAgentStatus(), 500);
    } catch (err) {
      console.error("[Agent] Start error:", err);
      setConfigStatus("Fehler beim Starten");
    }
  };

  // Stop Agent
  const stopAgent = async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/agent/stop`, { method: "POST" });
      const data = await res.json();
      console.log("[Agent] Stop response:", data);
      setConfigStatus("Agent gestoppt");
      setTimeout(() => loadAgentStatus(), 500);
    } catch (err) {
      console.error("[Agent] Stop error:", err);
      setConfigStatus("Fehler beim Stoppen");
    }
  };

  // Trigger Analysis
  const triggerAgentAnalysis = async () => {
    setConfigStatus("Analysiere...");
    setIsTriggering(true);
    try {
      const res = await fetch(`${getApiBase()}/api/agent/trigger`, { method: "POST" });
      const data = await res.json();
      console.log("[Agent] Trigger response:", data);
      setConfigStatus("Analyse gestartet!");
      // Warten und dann History neu laden (längeres Fenster für KI)
      setTimeout(async () => {
        await loadAgentHistory();
        setConfigStatus("");
        setIsTriggering(false);
      }, 10000);
    } catch (err) {
      console.error("[Agent] Trigger error:", err);
      setConfigStatus("Fehler bei Analyse");
      setIsTriggering(false);
    }
  };


  // ==================== TOKEN WHITELIST FUNCTIONS ====================
  
  // Load data on mount and refresh when tab changes
  useEffect(() => {
    // Initial fetch for global components (like CreateBotDialog)
    fetchTokens();
    const fetchTemplates = () => {
      fetch(`${getApiBase()}/api/strategies/templates`)
        .then(r => r.json()).then(d => { if (Array.isArray(d)) setStrategyTemplates(d); }).catch(() => {});
    };
    const fetchSavedStrategies = () => {
      fetch(`${getApiBase()}/api/strategies`)
        .then(r => r.json()).then(d => { if (Array.isArray(d)) setSavedStrategies(d); }).catch(() => {});
    };
    fetchTemplates();
    fetchSavedStrategies();

    if (activeTab === 'strategies') {
      // Pre-select first template in newBotStrategyId if not set yet
      setNewBotStrategyId(id => id || 'scalping');
    }
  }, [activeTab]);

  // Load system prompt info when assistent sub-tab bot changes
  useEffect(() => {
    if (!assistentBotId) { setAssistentPromptInfo(null); return; }
    fetch(`${getApiBase()}/api/bots/${assistentBotId}/system-prompt`)
      .then(r => r.json())
      .then(d => { setAssistentPromptInfo(d); setAssistentEditValue(d.customPrompt ?? d.strategyPrompt ?? d.autoPrompt); })
      .catch(() => setAssistentPromptInfo(null));
  }, [assistentBotId]);

  // Poll live indicator values for selected bot every 5s
  useEffect(() => {
    if (!selectedBotId) return;
    const poll = () => {
      fetch(`${getApiBase()}/api/bots/${selectedBotId}/indicators`)
        .then(r => r.json())
        .then(d => setBotIndicators(prev => ({ ...prev, [selectedBotId]: d })))
        .catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [selectedBotId]);
  
  // Auto-refresh token prices every 5 seconds when on tokens tab
  useEffect(() => {
    if (activeTab !== 'tokens') return;
    
    const interval = setInterval(() => {
      fetchTokens();
    }, 5000);
    
    return () => clearInterval(interval);
  }, [activeTab]);
  
  const fetchTokens = async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/tokens`);
      const data = await res.json();
      setTokens(data);
      console.log("[Token] Tokens loaded:", data.length);
    } catch (err) {
      console.error("[Token] Fetch error:", err);
    }
  };
  
  const handleLookupToken = async () => {
    if (!newTokenMintAddress.trim()) {
      setLookupError("Please enter a mint address");
      return;
    }
    
    // Validate mint address format
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    if (!base58Regex.test(newTokenMintAddress.trim())) {
      setLookupError("Invalid mint address format. Must be a valid Solana Base58 address (32-44 characters).");
      return;
    }
    
    setIsLookingUp(true);
    setLookupError(null);
    setLookupResult(null);
    
    try {
      const mintAddress = newTokenMintAddress.trim();
      const res = await fetch(`${getApiBase()}/api/tokens/lookup/${mintAddress}`);
      
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Lookup failed');
      }
      
      const data = await res.json();
      setLookupResult(data);
      console.log("[Token] Lookup result:", data);
    } catch (err: unknown) {
      setLookupError(err instanceof Error ? err.message : 'Failed to lookup token');
      console.error("[Token] Lookup error:", err);
    } finally {
      setIsLookingUp(false);
    }
  };
  
  const handleAddToken = async () => {
    if (!newTokenMintAddress.trim()) {
      setLookupError("Please enter a mint address");
      return;
    }
    
    try {
      const res = await fetch(`${getApiBase()}/api/tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress: newTokenMintAddress.trim() }),
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to add token');
      }
      
      const data = await res.json();
      console.log("[Token] Token added:", data);
      
      // Reset and close dialog
      setNewTokenMintAddress("");
      setLookupResult(null);
      setLookupError(null);
      setIsAddTokenDialogOpen(false);
      
      // Refresh token list
      fetchTokens();
    } catch (err: unknown) {
      setLookupError(err instanceof Error ? err.message : 'Failed to add token');
      console.error("[Token] Add error:", err);
    }
  };
  
  const handleRemoveToken = async (mintAddress: string) => {
    const ok = await confirm({
      title: "Token entfernen",
      message: `Token aus der Whitelist entfernen?\n${mintAddress}`,
      confirmLabel: "Entfernen",
      variant: "warning",
    });
    if (!ok) return;
    
    try {
      const res = await fetch(`${getApiBase()}/api/tokens/${mintAddress}`, {
        method: "DELETE",
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to remove token');
      }
      
      console.log("[Token] Token removed:", mintAddress);
      
      // Refresh token list
      fetchTokens();
    } catch (err: unknown) {
      console.error("[Token] Remove error:", err);
      alert(`Failed to remove token: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  
  const formatVolume = (volume?: number): string => {
    if (volume === undefined || volume === null) return '-';
    if (volume >= 1_000_000) return `$${(volume / 1_000_000).toFixed(2)}M`;
    if (volume >= 1_000) return `$${(volume / 1_000).toFixed(2)}K`;
    return `$${volume.toFixed(2)}`;
  };
  
  const formatPrice = (price?: number): string => {
    if (price === undefined || price === null) return '-';
    if (price < 0.000001) return `$${price.toFixed(8)}`;
    if (price < 0.01) return `$${price.toFixed(6)}`;
    if (price < 1) return `$${price.toFixed(4)}`;
    return `$${price.toFixed(2)}`;
  };

    const selectedBot = bots.find((b) => b.id === selectedBotId);
    const [backgroundPulseTrigger, setBackgroundPulseTrigger] = useState(false);
    
    // Reset background pulse trigger after a short delay
    useEffect(() => {
      if (backgroundPulseTrigger) {
        const timer = setTimeout(() => setBackgroundPulseTrigger(false), 800);
        return () => clearTimeout(timer);
      }
    }, [backgroundPulseTrigger]);

    // Trigger background pulse on AI updates - runs after selectedBot is defined
    useEffect(() => {
      // Safety check: only run if selectedBot exists
      if (!selectedBot) return;

      if (terminalLogs[selectedBot.id]?.length > 0) {
        const latestLog = terminalLogs[selectedBot.id][terminalLogs[selectedBot.id].length - 1];
        const isAiUpdate = latestLog?.level === "ACT" && latestLog?.message.includes("Einstellung optimiert");
        if (isAiUpdate) {
          setBackgroundPulseTrigger(true);
        }
      }
    }, [terminalLogs, selectedBot?.id]);

    // GSAP Animation Hook für Globalen Hintergrund Puls (Background Pulse)
    useGSAP(() => {
      if (!animConfig.backgroundPulseEnabled || !backgroundPulseTrigger || !globalPulseContainerRef.current) return;

      const circle1 = globalPulseCircle1Ref.current;
      const circle2 = globalPulseCircle2Ref.current;
      const circle3 = globalPulseCircle3Ref.current;
      if (!circle1 || !circle2 || !circle3) return;

      // Farbe: Purple für AI Updates
      const color = animConfig.bgPulseColorAI;

      const tl = gsap.timeline();

      // Radial Gradient für alle Circles
      const gradient = `radial-gradient(circle at center, ${color} 0%, ${color} 98%, transparent 100.1%)`;

      // Reset - alle Circles auf Startposition
      tl.set([circle1, circle2, circle3], {
        background: gradient,
        scale: animConfig.bgPulseInitialScale,
        opacity: 0,
        xPercent: -50,
        yPercent: -50,
        left: "50%",
        top: "50%",
        position: 'fixed'
      });

      tl.set(globalPulseContainerRef.current, { opacity: 1 });

      // Phase 1: Schnelle Expansion (Wabernd)
      tl.to(circle1, { 
        scale: animConfig.bgPulseExpand1Scale, 
        opacity: animConfig.bgPulseOpacity1, 
        duration: animConfig.bgPulseExpandDuration, 
        ease: animConfig.easeType 
      });
      tl.to(circle2, { 
        scale: animConfig.bgPulseExpand2Scale, 
        opacity: animConfig.bgPulseOpacity2, 
        duration: animConfig.bgPulseExpandDuration + 0.05, 
        ease: animConfig.easeType 
      }, "-=0.1");
      tl.to(circle3, { 
        scale: animConfig.bgPulseExpand3Scale, 
        opacity: animConfig.bgPulseOpacity3, 
        duration: animConfig.bgPulseExpandDuration + 0.1, 
        ease: animConfig.easeType 
      }, "-=0.15");

      // Phase 2: Langsame Expansion (Billowing)
      tl.to(circle1, { 
        scale: animConfig.bgPulseBillow1Scale, 
        opacity: 0, 
        duration: animConfig.bgPulseBillowDuration, 
        ease: animConfig.easeType 
      });
      tl.to(circle2, { 
        scale: animConfig.bgPulseBillow2Scale, 
        opacity: 0, 
        duration: animConfig.bgPulseBillowDuration + 0.3, 
        ease: animConfig.easeType 
      }, "<0.1");
      tl.to(circle3, { 
        scale: animConfig.bgPulseBillow3Scale, 
        opacity: 0, 
        duration: animConfig.bgPulseBillowDuration + 0.6, 
        ease: animConfig.easeType 
      }, "<0.15");

    }, [backgroundPulseTrigger, animConfig]);

    return (
      <>
       {/* GLOBAL BACKGROUND PULSE (GSAP Controlled Waber-Effect) - FIXIERT FÜR GESAMTE APP */}
       <div className="global-pulse-container" ref={globalPulseContainerRef}>
          <div className="global-pulse-circle" ref={globalPulseCircle1Ref} />
          <div className="global-pulse-circle global-pulse-circle-2" ref={globalPulseCircle2Ref} />
          <div className="global-pulse-circle global-pulse-circle-3" ref={globalPulseCircle3Ref} />
       </div>

       <div className="flex h-screen w-full bg-background text-foreground overflow-hidden relative">
       
       {/* Top Navigation Bar - ersetzt Sidepanel */}
       <header className="topbar">
         <div className="topbar-container">
           {/* Logo links mit Tooltip */}
           <div className="topbar-logo relative group cursor-help">
             <Activity className="h-6 w-6" />
             <span>Scalpatron</span>
             {/* Tooltip */}
             <div className="logo-tooltip">
               <div className="text-sm font-semibold text-foreground mb-1">Scalpatron Trading Bot</div>
               <div className="text-xs text-muted-foreground">Version 2.1 - Multi-Strategy Trading Platform für Solana SPL Tokens</div>
               <div className="logo-tooltip-arrow"></div>
             </div>
           </div>
           
           {/* Navigation in der Mitte */}
           <nav className="topbar-nav">
             {/* Dashboard Button */}
             <div className="topbar-nav-item">
               <button
                 className={`topbar-nav-button ${activeTab === "dashboard" ? "active" : ""}`}
                 onClick={() => {
                   setActiveTab("dashboard");
                   setSelectedBotId(null);
                 }}
               >
                 <Server className="h-4 w-4" />
               </button>
               <div className="nav-tooltip">
                 <span className="nav-tooltip-label">Bots Dashboard</span>
                 <span className="nav-tooltip-info">Übersicht aller Trading Bots</span>
               </div>
             </div>
             
             {/* Token Management Button */}
             <div className="topbar-nav-item">
               <button
                 className={`topbar-nav-button ${activeTab === "tokens" ? "active" : ""}`}
                 onClick={() => {
                   setActiveTab("tokens");
                   setSelectedBotId(null);
                 }}
               >
                 <Database className="h-4 w-4" />
               </button>
               <div className="nav-tooltip">
                 <span className="nav-tooltip-label">Token Management</span>
                 <span className="nav-tooltip-info">Whitelist verwalten</span>
               </div>
             </div>
             
             {/* Strategy Assistant Button */}
             {/* Strategien Button */}
             <div className="topbar-nav-item">
               <button
                 className={`topbar-nav-button ${activeTab === "strategies" ? "active" : ""}`}
                 onClick={() => {
                   setActiveTab("strategies");
                   setSelectedBotId(null);
                 }}
               >
                 <FlaskConical className="h-4 w-4" />
               </button>
               <div className="nav-tooltip">
                 <span className="nav-tooltip-label">Strategien</span>
                 <span className="nav-tooltip-info">Strategy Management</span>
               </div>
             </div>

             <div className="topbar-nav-item">
               <button
                 className={`topbar-nav-button ${activeTab === "agent" ? "active" : ""}`}
                 onClick={() => {
                   setActiveTab("agent");
                   setSelectedBotId(null);
                 }}
               >
                 <BrainCircuit className="h-4 w-4" />
               </button>
               <div className="nav-tooltip">
                 <span className="nav-tooltip-label">Strategy Assistant</span>
                 <span className="nav-tooltip-info">KI-gestützte Analyse</span>
               </div>
             </div>
             
             {/* Documentation Button */}
             <div className="topbar-nav-item">
               <button
                 className={`topbar-nav-button ${activeTab === "docs" ? "active" : ""}`}
                 onClick={() => {
                   setActiveTab("docs");
                   setSelectedBotId(null);
                 }}
               >
                 <BookOpen className="h-4 w-4" />
               </button>
               <div className="nav-tooltip">
                 <span className="nav-tooltip-label">Dokumentation</span>
                 <span className="nav-tooltip-info">Handbücher & Guides</span>
               </div>
             </div>
             
             {/* Settings Button */}
             <div className="topbar-nav-item">
               <button
                 className={`topbar-nav-button ${activeTab === "settings" ? "active" : ""}`}
                 onClick={() => {
                   setActiveTab("settings");
                   setSelectedBotId(null);
                 }}
               >
                 <Settings className="h-4 w-4" />
               </button>
               <div className="nav-tooltip">
                 <span className="nav-tooltip-label">Global Settings</span>
                 <span className="nav-tooltip-info">General Settings</span>
               </div>
             </div>
           </nav>
           
           {/* Rechts: Backend Status und Theme Toggle */}
            <div className="topbar-actions flex items-center gap-4">
              {/* Create Bot CTA */}
               <button
                 className="flex items-center gap-2 bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 hover:border-primary/50 transition-colors px-3 py-1.5 rounded-md text-sm font-bold"
                 onClick={() => {
                   setActiveTab("dashboard");
                   setSelectedBotId(null);
                   setIsCreateBotDialogOpen(true);
                 }}
               >
                 <Plus className="h-4 w-4" /> Create Bot
               </button>

              {/* Backend Status mit Tooltip */}
              <div className="backend-indicator-wrapper relative group cursor-help">
               <div className="backend-indicator">
                 <span className={`backend-indicator-dot ${serverStatus === "connected" ? "connected" : "disconnected"}`}></span>
                 <span className="text-xs">{serverStatus === "connected" ? "Connected" : "Disconnected"}</span>
               </div>
               {/* Tooltip */}
               <div className="action-tooltip">
                 <div className="text-sm font-semibold text-foreground mb-1">Backend Status</div>
                 <div className="text-xs text-muted-foreground">
                   {serverStatus === "connected"
                     ? "Verbunden mit dem Trading Bot Daemon auf Port 3000"
                     : "Keine Verbindung - Seite neu laden"}
                 </div>
                 {serverStatus === "disconnected" && (
                   <button
                     onClick={() => window.location.reload()}
                     className="mt-2 text-xs text-primary hover:underline flex items-center gap-1"
                   >
                     <RefreshCw className="h-3 w-3" /> Neu laden
                   </button>
                 )}
                 <div className="action-tooltip-arrow"></div>
               </div>
             </div>
             
             {/* Theme Toggle Button mit Tooltip */}
             <div className="relative group">
               <button
                 className="theme-toggle"
                 onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
               >
                 {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
               </button>
               {/* Tooltip */}
               <div className="action-tooltip">
                 <div className="text-sm font-semibold text-foreground mb-1">Theme wechseln</div>
                 <div className="text-xs text-muted-foreground">
                   {theme === "dark" ? "Zu Light Mode wechseln" : "Zu Dark Mode wechseln"}
                 </div>
                 <div className="action-tooltip-arrow"></div>
               </div>
             </div>
           </div>
         </div>
       </header>
       
       {/* Main Content Area - Dashboard, Tokens, Agent, Docs, Settings */}
       <main className="flex-1 overflow-auto p-8">
         <div className="max-w-6xl mx-auto space-y-8">
           {activeTab === "dashboard" ? (
            // COMBINED DASHBOARD VIEW
             <div className="relative">
               <Ripple className="rounded-xl" blur={0} glow={tradeFlash[selectedBotId ?? ""] === "buy"} />
               <div className="relative z-10 space-y-4 animate-in fade-in duration-300">
                <CreateBotDialog
                  open={isCreateBotDialogOpen}
                  onOpenChange={setIsCreateBotDialogOpen}
                  hiddenTrigger
                  tokens={tokens}
                  strategyTemplates={strategyTemplates}
                  savedStrategies={savedStrategies}
                  newBotName={newBotName}
                  setNewBotName={setNewBotName}
                  newBotMintAddress={newBotMintAddress}
                  setNewBotMintAddress={setNewBotMintAddress}
                  newBotWalletAddress={newBotWalletAddress}
                  setNewBotWalletAddress={setNewBotWalletAddress}
                  newBotTradingMode={newBotTradingMode}
                  setNewBotTradingMode={setNewBotTradingMode}
                  newBotTradeSize={newBotTradeSize}
                  setNewBotTradeSize={setNewBotTradeSize}
                  newBotAggressiveness={newBotAggressiveness}
                  setNewBotAggressiveness={setNewBotAggressiveness}
                  newBotStrategyId={newBotStrategyId}
                  setNewBotStrategyId={setNewBotStrategyId}
                  showTokenWhitelist={showTokenWhitelist}
                  setShowTokenWhitelist={setShowTokenWhitelist}
                  onCreateBot={createDemoBot}
                />
              </div>

               {/* ── Disconnected Empty State ── */}
               {serverStatus !== "connected" && (
                 <div className="flex flex-col items-center justify-center py-16 gap-10 animate-in fade-in duration-500">
                   {/* Ghost Bot Chip Grid */}
                   <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full max-w-2xl opacity-40 pointer-events-none select-none">
                     {[
                       { name: "UGOR-α",  pnl: "+12.4%", trades: 38, status: "running",  color: "text-green-400" },
                       { name: "SOL-β",   pnl: "-3.1%",  trades: 14, status: "stopped",  color: "text-red-400"   },
                       { name: "BONK-γ",  pnl: "+8.7%",  trades: 61, status: "running",  color: "text-green-400" },
                       { name: "WIF-δ",   pnl: "+0.2%",  trades: 5,  status: "stopped",  color: "text-zinc-400"  },
                     ].map((ghost, i) => (
                       <div
                         key={i}
                         className="relative rounded-lg border border-white/10 bg-zinc-900/60 px-4 py-3 flex flex-col gap-2"
                         style={{ animationDelay: `${i * 120}ms` }}
                       >
                         {/* animated skeleton shimmer */}
                         <div className="absolute inset-0 rounded-lg overflow-hidden">
                           <div
                             className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite]"
                             style={{
                               background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)",
                               animationDelay: `${i * 300}ms`,
                             }}
                           />
                         </div>
                         <div className="flex items-center justify-between gap-2">
                           <div className="flex items-center gap-2">
                             <span className={`w-2 h-2 rounded-full shrink-0 ${ghost.status === "running" ? "bg-green-500 animate-pulse shadow-[0_0_6px_#22c55e]" : "bg-zinc-600"}`} />
                             <span className="font-bold text-sm text-white/70">{ghost.name}</span>
                           </div>
                           <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">{ghost.status}</span>
                         </div>
                         <span className={`text-xl font-black tabular-nums ${ghost.color}`}>{ghost.pnl}</span>
                         <span className="text-[10px] font-mono text-zinc-600">{ghost.trades} trades</span>
                       </div>
                     ))}
                   </div>

                   {/* Status Message */}
                   <div className="flex flex-col items-center gap-3 text-center">
                     <div className="relative flex items-center justify-center w-14 h-14">
                       <span className="absolute inset-0 rounded-full bg-red-500/10 animate-ping" />
                       <span className="relative w-14 h-14 rounded-full bg-zinc-900 border border-red-500/30 flex items-center justify-center">
                         <RefreshCw className="h-5 w-5 text-red-400 animate-spin [animation-duration:3s]" />
                       </span>
                     </div>
                     <div>
                       <p className="text-base font-bold text-white/50">Keine Verbindung zum Backend</p>
                       <p className="text-xs text-zinc-600 mt-1 max-w-xs">
                         Scalpatron wartet auf den Trading-Daemon (Port 3000). Starte den Bot mit <code className="bg-zinc-800 px-1 rounded text-zinc-400">npx tsx src/index.ts</code>.
                       </p>
                     </div>
                     <button
                       onClick={() => window.location.reload()}
                       className="mt-1 flex items-center gap-2 text-xs font-bold text-primary hover:text-primary/80 border border-primary/20 hover:border-primary/40 bg-primary/5 hover:bg-primary/10 px-4 py-2 rounded-full transition-all"
                     >
                       <RefreshCw className="h-3 w-3" /> Erneut verbinden
                     </button>
                   </div>
                 </div>
               )}

              {/* Bot Chip Grid - Responsive mit dynamischer Größenberechnung */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {bots.map((bot, botIndex) => {
                  const isSelected = bot.id === selectedBotId;
                  const isRunning = bot.status === "running";
                  const isDeleting = deletingBotId === bot.id;
                  
                  // Trend-Indicator aus recentTrades ableiten
                  const lastTrade = bot.recentTrades?.[0];
                  const lastEvent = lastTrade?.action || null;
                  const lastEventTime = lastTrade?.timestamp || 0;
                  const now = Date.now();
                  const eventAge = (now - lastEventTime) / 1000; // Sekunden
                  
                  // Trend basierend auf letztem Trade
                  const trendDirection = lastEvent === 'BUY' ? 'UP' : lastEvent === 'SELL' ? 'DOWN' : 'FLAT';
                  const TrendIcon = trendDirection === 'UP' ? TrendingUp : trendDirection === 'DOWN' ? TrendingDown : Minus;
                  const trendColor = trendDirection === 'UP' ? 'text-green-400' : trendDirection === 'DOWN' ? 'text-red-400' : 'text-zinc-500';
                  
                  // Event-Indicator nur anzeigen wenn < 30 Sekunden alt
                  const showEventIndicator = eventAge < 30 && lastEvent;
                  const eventColor = lastEvent === 'BUY' ? 'bg-green-500/20 text-green-400 border-green-500/30'
                    : lastEvent === 'SELL' ? 'bg-red-500/20 text-red-400 border-red-500/30'
                    : 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30';
                  const EventIcon = lastEvent === 'BUY' ? ArrowUp : lastEvent === 'SELL' ? ArrowDown : Info;
                  
                  // Größe basierend auf der tatsächlichen Grid-Zeile berechnen
                  const row = Math.floor(botIndex / gridColumns);
                  const sizeVariant = row === 0 ? 'xl' : row === 1 ? 'l' : 'm';

                  // Bot stats helpers
                  const winRate = (bot.stats?.totalTrades ?? 0) > 0
                    ? Math.round(((bot.stats.wins ?? 0) / bot.stats.totalTrades) * 100)
                    : null;
                  const uptime = formatUptime(bot.startTime);
              
                  return (
                    <button
                      key={bot.id}
                      onClick={() => setSelectedBotId(bot.id)}
                      className={`relative text-left rounded-lg border transition-all duration-200 bg-zinc-900/60 flex flex-col trade-flash-target-${bot.id} ai-flash-target-${bot.id} ${
                        sizeVariant === 'xl' ? 'px-5 py-4 gap-3' : sizeVariant === 'l' ? 'px-4 py-3 gap-2' : 'px-3 py-2 gap-1.5'
                      } ${
                        isSelected
                          ? "border-primary/70 bot-chip-selected shadow-lg shadow-primary/10"
                          : "border-white/10 hover:border-primary/30 hover:bg-zinc-800/60"
                      } ${isDeleting ? "animate-out fade-out zoom-out duration-300" : ""}`}
                    >
                      {/* Pulse Animation Trigger (Behind the button) */}
                      {(tradeFlash[bot.id] || aiFlash[bot.id]) && (
                        <>
                          {/* Inner "Sharp" Pulse */}
                          <div 
                            className="absolute inset-0 -z-10 rounded-lg animate-inner-pulse pointer-events-none"
                            style={{
                              background: `radial-gradient(circle at center, ${
                                aiFlash[bot.id] 
                                  ? "rgba(168, 85, 247, 0.7)" 
                                  : tradeFlash[bot.id] === "buy" 
                                    ? "rgba(34, 197, 94, 0.7)" 
                                    : "rgba(239, 68, 68, 0.7)"
                              } 0%, transparent 50%)`
                            }}
                          />
                          {/* Outer "Drifting" Pulse */}
                          <div 
                            className="absolute inset-0 -z-10 rounded-lg animate-outer-pulse pointer-events-none"
                            style={{
                              background: `radial-gradient(circle at center, ${
                                aiFlash[bot.id] 
                                  ? "rgba(168, 85, 247, 0.3)" 
                                  : tradeFlash[bot.id] === "buy" 
                                    ? "rgba(34, 197, 94, 0.3)" 
                                    : "rgba(239, 68, 68, 0.3)"
                              } 0%, transparent 70%)`
                            }}
                          />
                        </>
                      )}
                      {/* Event Indicator Badge */}
                      {showEventIndicator && (
                        <div className={`absolute -top-2 -right-2 px-2 py-0.5 rounded-full border text-[9px] font-bold flex items-center gap-1 ${eventColor} animate-in fade-in zoom-in duration-200`}>
                          <EventIcon className="h-2.5 w-2.5" />
                          {lastEvent}
                        </div>
                      )}
                      
                      {/* XL Size - Alle Informationen */}
                      {sizeVariant === 'xl' && (
                        <>
                          {/* Header Row */}
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${isRunning ? "bg-green-500 " + (backgroundPulseTrigger ? "animate-pulse-trigger" : "animate-pulse") + "shadow-[0_0_6px_#22c55e]" : "bg-zinc-600 " + (backgroundPulseTrigger ? "animate-pulse-trigger" : "")}`} />
                              <div className="flex flex-col min-w-0">
                                <span className="font-bold text-base truncate">{bot.name}</span>
                                <span className="text-[10px] font-mono text-zinc-500 truncate tabular-nums">{bot.mintAddress?.slice(0, 6)}…{bot.mintAddress?.slice(-4)}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {(() => { 
                                const st = bot.strategyType ?? 'scalping'; 
                                const desc = st === 'trend' ? "Trend Strategy: Folgt dem Markttrend für längerfristige Positionen." : 
                                            st === 'mean_reversion' ? "Mean Reversion: Setzt auf die Rückkehr zum Durchschnittspreis." :
                                            st === 'breakout' ? "Breakout Strategy: Nutzt massive Ausbrüche aus Preiszonen." :
                                            st === 'momentum' ? "Momentum Strategy: Exploits the speed of price movements." :
                                            "Scalping Strategy: Exploits small price spikes for quick profits.";
                                return (
                                  <span 
                                    className={`flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded border cursor-help ${getStrategyColor(st)}`}
                                    onMouseEnter={(e) => tooltip.show(desc, e)}
                                    onMouseMove={(e) => tooltip.move(e)}
                                    onMouseLeave={() => tooltip.hide()}
                                  >
                                    {getStrategyIcon(st, "h-2 w-2")}
                                    {st}
                                  </span>
                                ); 
                              })()}
                              <span 
                                className={`text-xs font-bold px-2 py-0.5 rounded cursor-help ${isRunning ? "text-green-400 bg-green-500/10" : "text-zinc-500 bg-zinc-800"}`}
                                onMouseEnter={(e) => tooltip.show(`Bot ist ${bot.status}. ${isRunning ? "Analysiert den Markt." : "Keine Aktivität."}`, e)}
                                onMouseMove={(e) => tooltip.move(e)}
                                onMouseLeave={() => tooltip.hide()}
                              >
                                {bot.status}
                              </span>
                            </div>
                          </div>

                          {/* PNL - Big Display */}
                          <div className="flex items-baseline gap-2">
                            <span className={`text-2xl font-black tabular-nums leading-none ${(bot.stats?.totalPnlPercent ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                              {(bot.stats?.totalPnlPercent ?? 0) >= 0 ? "+" : ""}{bot.stats?.totalPnlPercent?.toFixed(2) || "0.00"}%
                            </span>
                            <span className="text-[10px] text-zinc-500">Total PnL</span>
                          </div>

                          {/* Trades + W/L + Uptime Row */}
                          <div className="flex items-center justify-between gap-2 text-[10px] font-mono pt-2 border-t border-white/5">
                             <div className="flex flex-col gap-0.5">
                               <span className="text-zinc-500">Trades</span>
                               <span className="text-white/80 font-bold text-2xl">{bot.stats?.totalTrades || 0}</span>
                             </div>
                             <div className="flex flex-col gap-0.5 items-center">
                               <span className="text-zinc-500">W/L</span>
                               <span className={`font-bold ${winRate !== null && winRate >= 50 ? "text-green-400" : "text-red-400"} text-2xl`}>
                                 {winRate !== null ? `${winRate}%` : "—"}
                               </span>
                             </div>
                             <div className="flex flex-col gap-0.5 items-end">
                               <span className="text-zinc-500">Uptime</span>
                               <span className="text-white/80 font-bold text-2xl">{uptime}</span>
                             </div>
                          </div>

                          {/* Price + Ticks Row */}
                          <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500">
                            <span>${bot.stats?.lastPrice?.toFixed(6) || "—"}</span>
                            <span className="flex items-center gap-1">
                              <TrendIcon className={`h-3 w-3 ${trendColor}`} />
                              <span>{bot.totalTicks || 0} ticks</span>
                            </span>
                          </div>
                        </>
                      )}
                      
                      {/* L Size - Weniger Informationen */}
                      {sizeVariant === 'l' && (
                        <>
                          {/* Header Row */}
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`w-2 h-2 rounded-full shrink-0 ${isRunning ? "bg-green-500 animate-pulse shadow-[0_0_6px_#22c55e]" : "bg-zinc-600"}`} />
                              <div className="flex flex-col min-w-0">
                                <span className="font-bold text-sm truncate">{bot.name}</span>
                                <span className="text-[9px] font-mono text-zinc-500 truncate tabular-nums">{bot.mintAddress?.slice(0, 6)}…{bot.mintAddress?.slice(-4)}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {(() => { 
                                const st = bot.strategyType ?? 'scalping'; 
                                const desc = st === 'trend' ? "Trend Strategy: Folgt dem Markttrend für längerfristige Positionen." : 
                                            st === 'mean_reversion' ? "Mean Reversion: Setzt auf die Rückkehr zum Durchschnittspreis." :
                                            st === 'breakout' ? "Breakout Strategy: Nutzt massive Ausbrüche aus Preiszonen." :
                                            st === 'momentum' ? "Momentum Strategy: Exploits the speed of price movements." :
                                            "Scalping Strategy: Exploits small price spikes for quick profits.";
                                return (
                                  <span 
                                    className={`flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded border cursor-help ${getStrategyColor(st)}`}
                                    onMouseEnter={(e) => tooltip.show(desc, e)}
                                    onMouseMove={(e) => tooltip.move(e)}
                                    onMouseLeave={() => tooltip.hide()}
                                  >
                                    {getStrategyIcon(st, "h-2 w-2")}
                                    {st}
                                  </span>
                                ); 
                              })()}
                              <span 
                                className={`text-[10px] font-bold px-2 py-0.5 rounded cursor-help ${isRunning ? "text-green-400 bg-green-500/10" : "text-zinc-500 bg-zinc-800"}`}
                                onMouseEnter={(e) => tooltip.show(`Bot-Status: ${bot.status}.`, e)}
                                onMouseMove={(e) => tooltip.move(e)}
                                onMouseLeave={() => tooltip.hide()}
                              >
                                {bot.status}
                              </span>
                            </div>
                          </div>
                          
                          {/* Trend Row - Just Trend */}
                          <div className="flex items-center justify-end">
                            <div className={`flex items-center gap-1 text-[10px] font-bold ${trendColor}`}>
                              <TrendIcon className="h-3 w-3" />
                              <span>{trendDirection}</span>
                            </div>
                          </div>

                          
                           {/* Stats Row - Kompakt */}
                           <div className="flex items-center justify-between gap-2 text-[10px] font-mono pt-1 border-t border-white/5">
                             <span className={`font-bold ${(bot.stats?.totalPnlPercent ?? 0) >= 0 ? "text-green-400" : "text-red-400"} text-xl`}>
                               {(bot.stats?.totalPnlPercent ?? 0) >= 0 ? "+" : ""}{bot.stats?.totalPnlPercent?.toFixed(2) || "0.00"}%
                             </span>
                             <span className="text-zinc-500 text-xl">{bot.stats?.totalTrades || 0}T {winRate !== null ? `${winRate}%W` : ""}</span>
                             <span className="text-zinc-500 text-xl">{uptime}</span>
                           </div>
                        </>
                      )}
                      
                      {/* M Size - Minimale Informationen */}
                      {sizeVariant === 'm' && (
                        <>
                          {/* Header Row - Kompakt */}
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isRunning ? "bg-green-500 animate-pulse" : "bg-zinc-600"}`} />
                              <span className="font-bold text-xs truncate">{bot.name}</span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {(() => { 
                                const st = bot.strategyType ?? 'scalping'; 
                                return (
                                  <span 
                                    className={`flex items-center gap-0.5 text-[8px] font-bold px-1 py-0.5 rounded border cursor-help ${getStrategyColor(st)}`}
                                    onMouseEnter={(e) => tooltip.show(`${st.toUpperCase()} Strategie`, e)}
                                    onMouseMove={(e) => tooltip.move(e)}
                                    onMouseLeave={() => tooltip.hide()}
                                  >
                                    {getStrategyIcon(st, "h-1.5 w-1.5")}
                                    {st}
                                  </span>
                                ); 
                              })()}
                              <span 
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded cursor-help ${ isRunning ? "text-green-400 bg-green-500/10" : "text-zinc-500 bg-zinc-800"}`}
                                onMouseEnter={(e) => tooltip.show(`Status: ${bot.status}`, e)}
                                onMouseMove={(e) => tooltip.move(e)}
                                onMouseLeave={() => tooltip.hide()}
                              >
                                {bot.status}
                              </span>
                            </div>
                          </div>

                          {/* Stats Row - Ultra Kompakt */}
                          <div className="flex items-center justify-between gap-2 text-[9px] font-mono">
                            <span className="text-white/60">${bot.stats?.lastPrice?.toFixed(4) || "—"}</span>
                            <span className={bot.stats?.totalPnlPercent >= 0 ? "text-green-400" : "text-red-400"}>
                              {bot.stats?.totalPnlPercent >= 0 ? "+" : ""}{bot.stats?.totalPnlPercent?.toFixed(1) || "0.0"}%
                            </span>
                          </div>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Detail View — always rendered, animates on bot change */}
              {selectedBot && (() => {
                const tokenBSymbol = tokens.find(t => t.mintAddress === selectedBot.mintAddress)?.symbol
                  ?? (selectedBot.mintAddress.slice(0, 6) + "…");
                return (
                <div key={selectedBotId} className="animate-in fade-in slide-in-from-bottom-3 duration-300 space-y-4 mt-8">
                  
                  {/* DETACHED PREMIUM BOT HEADER */}
                  <Card 
                    className="border-primary/40 bg-zinc-900/60 shadow-[0_0_20px_rgba(var(--primary-rgb),0.15)] backdrop-blur-md overflow-hidden relative rounded-2xl"
                    style={{ backgroundImage: "radial-gradient(circle at top left, oklch(from var(--primary) l c h / 0.15) 0%, transparent 100%)" }}
                  >
                    <div className="flex items-center justify-between px-6 py-4 shrink-0">
                      <div className="flex items-center gap-5">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-primary/10 rounded-lg border border-primary/30 relative">
                            <Terminal className="h-5 w-5 text-primary" />
                            {selectedBot.status === "running" && (
                              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-600 rounded-full border-2 border-zinc-900 animate-ping"></span>
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              {(() => {
                                const st = selectedBot.strategyType ?? 'scalping';
                                return (
                                  <span 
                                    className={`flex items-center gap-1 text-[9px] font-black px-2 py-0.5 rounded border uppercase tracking-wider ${getStrategyColor(st)}`}
                                    onMouseEnter={(e) => tooltip.show(`${st.toUpperCase()} Strategy Active`, e)}
                                    onMouseMove={(e) => tooltip.move(e)}
                                    onMouseLeave={() => tooltip.hide()}
                                  >
                                    {getStrategyIcon(st, "h-2 w-2")}
                                    {st}
                                  </span>
                                );
                              })()}
                              <span className="text-h2 font-black tracking-tight">{selectedBot.name}</span>
                            </div>
                            <div className="flex items-center gap-2 text-micro font-mono text-zinc-500">
                              <span className={`w-1.5 h-1.5 rounded-full ${selectedBot.status === "running" ? "bg-green-500 shadow-[0_0_4px_#22c55e]" : "bg-zinc-600"}`}></span>
                              {selectedBot.status.toUpperCase()}
                              <span className="opacity-20">|</span>
                              {selectedBot.walletAddress ? (
                                <span className="truncate max-w-[120px]" title={selectedBot.walletAddress}>
                                  Wallet: {selectedBot.walletAddress.slice(0, 6)}…{selectedBot.walletAddress.slice(-4)}
                                </span>
                              ) : (
                                <span className="truncate max-w-[120px]" title={selectedBot.mintAddress}>{selectedBot.mintAddress}</span>
                              )}
                            </div>
                          </div>
                        </div>

                         {/* Telemetry Internal */}
                         <BotTelemetry 
                            bot={selectedBot} 
                            tokenBSymbol={tokenBSymbol} 
                            className="hidden lg:flex xl:gap-4" 
                         />
                      </div>

                      <div className="flex items-center gap-3">
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-9 w-9 border transition-colors ${botSettingsPanelId === selectedBot.id ? "border-primary/50 bg-primary/10 text-primary" : "border-white/5 hover:bg-white/5 text-zinc-600 hover:text-white"}`}
                          onClick={() => openBotSettingsPanel(selectedBot)}
                          title="Bot Settings"
                        >
                          <SlidersHorizontal className="h-4 w-4" />
                        </Button>

                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 border border-white/5 hover:bg-red-500/10 hover:text-red-500 text-zinc-600 transition-colors"
                          onClick={() => deleteBot(selectedBot.id)}
                          title="Delete Bot"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>

                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 border border-white/5 hover:bg-orange-500/10 hover:text-orange-500 text-zinc-600 transition-colors"
                          onClick={() => openResetDialog(selectedBot)}
                          title="Reset Bot"
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>

                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 border border-white/5 hover:bg-white/5"
                          onClick={async () => {
                            const res = await fetch(`${getApiBase()}/api/bots`);
                            const data = await res.json();
                            setBots(data);
                          }}
                          title="Engine Sync"
                        >
                          <Database className="h-4 w-4 text-primary/60" />
                        </Button>

                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-9 w-9 border transition-colors ${botInfoPanelId === selectedBot.id ? "border-primary/50 bg-primary/10 text-primary" : "border-white/5 hover:bg-white/5 text-zinc-600 hover:text-white"}`}
                          onClick={() => openBotInfoPanel(selectedBot)}
                          title="Bot Info"
                        >
                          <Info className="h-4 w-4" />
                        </Button>
                        
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-9 w-9 border transition-all duration-300 ${
                            selectedBot.status === "running" 
                              ? "border-red-500/20 bg-red-500/5 text-red-500/50 hover:text-red-500 hover:bg-red-500/10 hover:border-red-500/40" 
                              : "border-primary/40 bg-zinc-900/40 text-primary hover:bg-primary/10 shadow-[0_0_10px_rgba(var(--primary-rgb),0.1)]"
                          }`}
                          onClick={() => toggleBotStatus(selectedBot.id, selectedBot.status)}
                          title={selectedBot.status === "running" ? "Stop Bot" : "Start Bot"}
                        >
                          {selectedBot.status === "running" ? (
                            <Square className="h-3.5 w-3.5 fill-current" />
                          ) : (
                            <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </Card>

                  {/* MAIN CONTENT AREA - Detached from Header */}
                  <div className="grid grid-cols-1 gap-6">
                    <Card className="border-primary/40 bg-transparent shadow-none overflow-hidden flex flex-col rounded-2xl">

                      {/* Inline Bot Settings Panel */}
                      {botSettingsPanelId === selectedBot.id && (() => {
                        const scd = botSettingsDraft.strategyConfigDraft;
                        const stratType = scd?.strategy_type ?? 'scalping';

                        // Helper: update an indicator field by indicator type name
                        const updateIndicator = (indType: string, field: string, value: number) => {
                          setBotSettingsDraft((p) => {
                            if (!p.strategyConfigDraft) return p;
                            const indicators = p.strategyConfigDraft.indicators.map((ind) =>
                              ind.type === indType ? { ...ind, [field]: value } : ind
                            );
                            return { ...p, strategyConfigDraft: { ...p.strategyConfigDraft, indicators } };
                          });
                        };

                        // Helper: update exit condition value by type
                        const updateExitCondition = (exitType: string, field: string, value: number) => {
                          setBotSettingsDraft((p) => {
                            if (!p.strategyConfigDraft) return p;
                            const exit_conditions = p.strategyConfigDraft.exit_conditions.map((ec) =>
                              ec.type === exitType ? { ...ec, [field]: value } : ec
                            );
                            return { ...p, strategyConfigDraft: { ...p.strategyConfigDraft, exit_conditions } };
                          });
                        };

                        // Helper: update entry condition right-value by left operand
                        const updateEntryCondition = (left: string, value: number) => {
                          setBotSettingsDraft((p) => {
                            if (!p.strategyConfigDraft) return p;
                            const entry_conditions = p.strategyConfigDraft.entry_conditions.map((ec) =>
                              ec.left === left ? { ...ec, right: value } : ec
                            );
                            return { ...p, strategyConfigDraft: { ...p.strategyConfigDraft, entry_conditions } };
                          });
                        };

                        // Helper: update risk_management field
                        const updateRisk = (field: string, value: number) => {
                          setBotSettingsDraft((p) => {
                            if (!p.strategyConfigDraft) return p;
                            return { ...p, strategyConfigDraft: { ...p.strategyConfigDraft, risk_management: { ...p.strategyConfigDraft.risk_management, [field]: value } } };
                          });
                        };

                        // Helper: update execution field
                        const updateExecution = (field: string, value: number) => {
                          setBotSettingsDraft((p) => {
                            if (!p.strategyConfigDraft) return p;
                            return { ...p, strategyConfigDraft: { ...p.strategyConfigDraft, execution: { ...p.strategyConfigDraft.execution, [field]: value } } };
                          });
                        };

                        // Get indicator by type
                        const getInd = (type: string) => scd?.indicators?.find((i) => i.type === type);
                        // Get exit condition by type
                        const getExit = (type: string) => scd?.exit_conditions?.find((e) => e.type === type);
                        // Get entry condition by left operand
                        const getEntry = (left: string) => scd?.entry_conditions?.find((e) => e.left === left);

                        const inputCls = "w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-primary/50";
                        const labelCls = "text-[10px] font-bold uppercase text-zinc-500";
                        const descCls = "text-[10px] text-zinc-600";

                        return (
                          <div className="animate-in slide-in-from-top-2 duration-200 border-b border-primary/10 bg-black/30 px-6 py-4 space-y-4">

                            {/* Strategy badge */}
                            <div className="flex items-center gap-2">
                              <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border ${getStrategyColor(stratType)}`}>
                                {getStrategyIcon(stratType, "h-3 w-3")}
                                {stratType.replace('_', ' ').toUpperCase()}
                              </span>
                              <span className="text-[10px] text-zinc-500">{scd?.strategy_name ?? 'Range Spike Scalper'}</span>
                            </div>

                            {/* ── SCALPING PARAMS ── */}
                            {stratType === 'scalping' && (
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="space-y-1">
                                  <label className={labelCls}>Floor Window</label>
                                  <input type="number" min={5} max={100} className={inputCls}
                                    value={botSettingsDraft.floorWindow ?? ""}
                                    onChange={(e) => setBotSettingsDraft((p) => ({ ...p, floorWindow: parseInt(e.target.value) || p.floorWindow }))} />
                                  <p className={descCls}>Ticks (5–100)</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>Spike Threshold</label>
                                  <input type="number" min={0.1} max={5} step={0.05} className={inputCls}
                                    value={botSettingsDraft.spikeThreshold ?? ""}
                                    onChange={(e) => setBotSettingsDraft((p) => ({ ...p, spikeThreshold: parseFloat(e.target.value) || p.spikeThreshold }))} />
                                  <p className={descCls}>% (0.1–5.0)</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>Sell Drop Threshold</label>
                                  <input type="number" min={0.05} max={1} step={0.01} className={inputCls}
                                    value={botSettingsDraft.sellDropThreshold ?? ""}
                                    onChange={(e) => setBotSettingsDraft((p) => ({ ...p, sellDropThreshold: parseFloat(e.target.value) || p.sellDropThreshold }))} />
                                  <p className={descCls}>% (0.05–1.0)</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>Cooldown Ticks</label>
                                  <input type="number" min={0} max={50} className={inputCls}
                                    value={botSettingsDraft.cooldownTicks ?? ""}
                                    onChange={(e) => setBotSettingsDraft((p) => ({ ...p, cooldownTicks: parseInt(e.target.value) ?? p.cooldownTicks }))} />
                                  <p className={descCls}>Ticks (0–50)</p>
                                </div>
                              </div>
                            )}

                            {/* ── EMA TREND PARAMS ── */}
                            {stratType === 'trend' && scd && (
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="space-y-1">
                                  <label className={labelCls}>EMA Fast Period</label>
                                  <input type="number" min={2} max={200} className={inputCls}
                                    value={getInd('EMA_20')?.period ?? getInd('EMA')?.period ?? 20}
                                    onChange={(e) => updateIndicator('EMA_20', 'period', parseInt(e.target.value) || 20)} />
                                  <p className={descCls}>Candles</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>EMA Slow Period</label>
                                  <input type="number" min={2} max={500} className={inputCls}
                                    value={getInd('EMA_50')?.period ?? 50}
                                    onChange={(e) => updateIndicator('EMA_50', 'period', parseInt(e.target.value) || 50)} />
                                  <p className={descCls}>Candles</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>RSI Period</label>
                                  <input type="number" min={2} max={50} className={inputCls}
                                    value={getInd('RSI_14')?.period ?? 14}
                                    onChange={(e) => updateIndicator('RSI_14', 'period', parseInt(e.target.value) || 14)} />
                                  <p className={descCls}>Candles</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>RSI Max Entry</label>
                                  <input type="number" min={30} max={90} step={1} className={inputCls}
                                    value={typeof getEntry('RSI_14')?.right === 'number' ? getEntry('RSI_14')!.right as number : 65}
                                    onChange={(e) => updateEntryCondition('RSI_14', parseFloat(e.target.value) || 65)} />
                                  <p className={descCls}>Entry if RSI &lt; value</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>Take Profit</label>
                                  <input type="number" min={0.005} max={0.5} step={0.005} className={inputCls}
                                    value={((getExit('take_profit')?.value ?? 0.04) * 100).toFixed(1)}
                                    onChange={(e) => updateExitCondition('take_profit', 'value', (parseFloat(e.target.value) || 4) / 100)} />
                                  <p className={descCls}>% profit target</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>Stop Loss</label>
                                  <input type="number" min={0.005} max={0.3} step={0.005} className={inputCls}
                                    value={((getExit('stop_loss')?.value ?? 0.02) * 100).toFixed(1)}
                                    onChange={(e) => updateExitCondition('stop_loss', 'value', (parseFloat(e.target.value) || 2) / 100)} />
                                  <p className={descCls}>% max loss</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>Position Size</label>
                                  <input type="number" min={1} max={100} step={1} className={inputCls}
                                    value={((scd.risk_management.position_size ?? 0.15) * 100).toFixed(0)}
                                    onChange={(e) => updateRisk('position_size', (parseFloat(e.target.value) || 15) / 100)} />
                                  <p className={descCls}>% of balance</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>Slippage</label>
                                  <input type="number" min={0.01} max={5} step={0.05} className={inputCls}
                                    value={((scd.execution.slippage_tolerance ?? 0.002) * 100).toFixed(2)}
                                    onChange={(e) => updateExecution('slippage_tolerance', (parseFloat(e.target.value) || 0.2) / 100)} />
                                  <p className={descCls}>% max slippage</p>
                                </div>
                              </div>
                            )}

                            {/* ── RSI MEAN REVERSION PARAMS ── */}
                            {stratType === 'mean_reversion' && scd && (
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="space-y-1">
                                  <label className={labelCls}>RSI Period</label>
                                  <input type="number" min={2} max={50} className={inputCls}
                                    value={getInd('RSI_14')?.period ?? 14}
                                    onChange={(e) => updateIndicator('RSI_14', 'period', parseInt(e.target.value) || 14)} />
                                  <p className={descCls}>Candles</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>BB Period</label>
                                  <input type="number" min={5} max={200} className={inputCls}
                                    value={getInd('BB_20')?.period ?? 20}
                                    onChange={(e) => updateIndicator('BB_20', 'period', parseInt(e.target.value) || 20)} />
                                  <p className={descCls}>Candles</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>BB Std Dev</label>
                                  <input type="number" min={0.5} max={4} step={0.1} className={inputCls}
                                    value={getInd('BB_20')?.std_dev ?? 2}
                                    onChange={(e) => updateIndicator('BB_20', 'std_dev', parseFloat(e.target.value) || 2)} />
                                  <p className={descCls}>Standard deviations</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>RSI Oversold Entry</label>
                                  <input type="number" min={10} max={50} step={1} className={inputCls}
                                    value={typeof getEntry('RSI_14')?.right === 'number' ? getEntry('RSI_14')!.right as number : 32}
                                    onChange={(e) => updateEntryCondition('RSI_14', parseFloat(e.target.value) || 32)} />
                                  <p className={descCls}>Entry if RSI &lt; value</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>RSI Overbought Exit</label>
                                  <input type="number" min={50} max={90} step={1} className={inputCls}
                                    value={(() => { const ec = scd.exit_conditions.find((e) => e.type === 'indicator' && e.condition?.left === 'RSI_14'); return ec?.condition?.right ?? 55; })()}
                                    onChange={(e) => {
                                      const val = parseFloat(e.target.value) || 55;
                                      setBotSettingsDraft((p) => {
                                        if (!p.strategyConfigDraft) return p;
                                        const exit_conditions = p.strategyConfigDraft.exit_conditions.map((ec) =>
                                          ec.type === 'indicator' && (ec.condition as {left:string})?.left === 'RSI_14'
                                            ? { ...ec, condition: { ...(ec.condition as object), right: val } }
                                            : ec
                                        );
                                        return { ...p, strategyConfigDraft: { ...p.strategyConfigDraft!, exit_conditions } };
                                      });
                                    }} />
                                  <p className={descCls}>Exit if RSI &ge; value</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>Take Profit</label>
                                  <input type="number" min={0.005} max={0.5} step={0.005} className={inputCls}
                                    value={((getExit('take_profit')?.value ?? 0.035) * 100).toFixed(1)}
                                    onChange={(e) => updateExitCondition('take_profit', 'value', (parseFloat(e.target.value) || 3.5) / 100)} />
                                  <p className={descCls}>% profit target</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>Stop Loss</label>
                                  <input type="number" min={0.005} max={0.3} step={0.005} className={inputCls}
                                    value={((getExit('stop_loss')?.value ?? 0.02) * 100).toFixed(1)}
                                    onChange={(e) => updateExitCondition('stop_loss', 'value', (parseFloat(e.target.value) || 2) / 100)} />
                                  <p className={descCls}>% max loss</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>Position Size</label>
                                  <input type="number" min={1} max={100} step={1} className={inputCls}
                                    value={((scd.risk_management.position_size ?? 0.12) * 100).toFixed(0)}
                                    onChange={(e) => updateRisk('position_size', (parseFloat(e.target.value) || 12) / 100)} />
                                  <p className={descCls}>% of balance</p>
                                </div>
                              </div>
                            )}

                            {/* ── BREAKOUT PARAMS ── */}
                            {stratType === 'breakout' && scd && (
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="space-y-1">
                                  <label className={labelCls}>BB Period</label>
                                  <input type="number" min={5} max={200} className={inputCls}
                                    value={getInd('BB_20')?.period ?? 20}
                                    onChange={(e) => updateIndicator('BB_20', 'period', parseInt(e.target.value) || 20)} />
                                  <p className={descCls}>Candles</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>BB Std Dev</label>
                                  <input type="number" min={0.5} max={4} step={0.1} className={inputCls}
                                    value={getInd('BB_20')?.std_dev ?? 2}
                                    onChange={(e) => updateIndicator('BB_20', 'std_dev', parseFloat(e.target.value) || 2)} />
                                  <p className={descCls}>Standard deviations</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>ATR Period</label>
                                  <input type="number" min={2} max={100} className={inputCls}
                                    value={getInd('ATR_14')?.period ?? 14}
                                    onChange={(e) => updateIndicator('ATR_14', 'period', parseInt(e.target.value) || 14)} />
                                  <p className={descCls}>Candles</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>RSI Min Entry</label>
                                  <input type="number" min={30} max={80} step={1} className={inputCls}
                                    value={typeof getEntry('RSI_14')?.right === 'number' ? getEntry('RSI_14')!.right as number : 50}
                                    onChange={(e) => updateEntryCondition('RSI_14', parseFloat(e.target.value) || 50)} />
                                  <p className={descCls}>Entry if RSI &gt; value</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>Take Profit</label>
                                  <input type="number" min={0.005} max={0.5} step={0.005} className={inputCls}
                                    value={((getExit('take_profit')?.value ?? 0.05) * 100).toFixed(1)}
                                    onChange={(e) => updateExitCondition('take_profit', 'value', (parseFloat(e.target.value) || 5) / 100)} />
                                  <p className={descCls}>% profit target</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>Stop Loss</label>
                                  <input type="number" min={0.005} max={0.3} step={0.005} className={inputCls}
                                    value={((getExit('stop_loss')?.value ?? 0.025) * 100).toFixed(1)}
                                    onChange={(e) => updateExitCondition('stop_loss', 'value', (parseFloat(e.target.value) || 2.5) / 100)} />
                                  <p className={descCls}>% max loss</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>Trailing Stop</label>
                                  <input type="number" min={0.005} max={0.2} step={0.005} className={inputCls}
                                    value={((getExit('trailing_stop')?.trailing_pct ?? 0.015) * 100).toFixed(1)}
                                    onChange={(e) => updateExitCondition('trailing_stop', 'trailing_pct', (parseFloat(e.target.value) || 1.5) / 100)} />
                                  <p className={descCls}>% trail from peak</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>Position Size</label>
                                  <input type="number" min={1} max={100} step={1} className={inputCls}
                                    value={((scd.risk_management.position_size ?? 0.1) * 100).toFixed(0)}
                                    onChange={(e) => updateRisk('position_size', (parseFloat(e.target.value) || 10) / 100)} />
                                  <p className={descCls}>% of balance</p>
                                </div>
                              </div>
                            )}

                            {/* ── MOMENTUM PARAMS ── */}
                            {stratType === 'momentum' && scd && (
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="space-y-1">
                                  <label className={labelCls}>MACD Fast</label>
                                  <input type="number" min={2} max={100} className={inputCls}
                                    value={getInd('MACD')?.fast_period ?? 12}
                                    onChange={(e) => updateIndicator('MACD', 'fast_period', parseInt(e.target.value) || 12)} />
                                  <p className={descCls}>Candles</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>MACD Slow</label>
                                  <input type="number" min={2} max={200} className={inputCls}
                                    value={getInd('MACD')?.slow_period ?? 26}
                                    onChange={(e) => updateIndicator('MACD', 'slow_period', parseInt(e.target.value) || 26)} />
                                  <p className={descCls}>Candles</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>MACD Signal</label>
                                  <input type="number" min={2} max={100} className={inputCls}
                                    value={getInd('MACD')?.signal_period ?? 9}
                                    onChange={(e) => updateIndicator('MACD', 'signal_period', parseInt(e.target.value) || 9)} />
                                  <p className={descCls}>Candles</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>EMA Period</label>
                                  <input type="number" min={2} max={500} className={inputCls}
                                    value={getInd('EMA_50')?.period ?? 50}
                                    onChange={(e) => updateIndicator('EMA_50', 'period', parseInt(e.target.value) || 50)} />
                                  <p className={descCls}>Candles</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>RSI Max Entry</label>
                                  <input type="number" min={30} max={90} step={1} className={inputCls}
                                    value={typeof getEntry('RSI_14')?.right === 'number' ? getEntry('RSI_14')!.right as number : 70}
                                    onChange={(e) => updateEntryCondition('RSI_14', parseFloat(e.target.value) || 70)} />
                                  <p className={descCls}>Entry if RSI &lt; value</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>Take Profit</label>
                                  <input type="number" min={0.005} max={0.5} step={0.005} className={inputCls}
                                    value={((getExit('take_profit')?.value ?? 0.045) * 100).toFixed(1)}
                                    onChange={(e) => updateExitCondition('take_profit', 'value', (parseFloat(e.target.value) || 4.5) / 100)} />
                                  <p className={descCls}>% profit target</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>Stop Loss</label>
                                  <input type="number" min={0.005} max={0.3} step={0.005} className={inputCls}
                                    value={((getExit('stop_loss')?.value ?? 0.02) * 100).toFixed(1)}
                                    onChange={(e) => updateExitCondition('stop_loss', 'value', (parseFloat(e.target.value) || 2) / 100)} />
                                  <p className={descCls}>% max loss</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>Position Size</label>
                                  <input type="number" min={1} max={100} step={1} className={inputCls}
                                    value={((scd.risk_management.position_size ?? 0.12) * 100).toFixed(0)}
                                    onChange={(e) => updateRisk('position_size', (parseFloat(e.target.value) || 12) / 100)} />
                                  <p className={descCls}>% of balance</p>
                                </div>
                              </div>
                            )}

                            {/* ── DCA PARAMS ── */}
                            {stratType === 'dca' && scd && (
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="space-y-1">
                                  <label className={labelCls}>RSI Period</label>
                                  <input type="number" min={2} max={50} className={inputCls}
                                    value={getInd('RSI_14')?.period ?? 14}
                                    onChange={(e) => updateIndicator('RSI_14', 'period', parseInt(e.target.value) || 14)} />
                                  <p className={descCls}>Candles</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>EMA Period</label>
                                  <input type="number" min={2} max={500} className={inputCls}
                                    value={getInd('EMA_100')?.period ?? 100}
                                    onChange={(e) => updateIndicator('EMA_100', 'period', parseInt(e.target.value) || 100)} />
                                  <p className={descCls}>Candles</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>RSI Entry Threshold</label>
                                  <input type="number" min={10} max={60} step={1} className={inputCls}
                                    value={typeof getEntry('RSI_14')?.right === 'number' ? getEntry('RSI_14')!.right as number : 40}
                                    onChange={(e) => updateEntryCondition('RSI_14', parseFloat(e.target.value) || 40)} />
                                  <p className={descCls}>Entry if RSI &lt; value</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>Max Positions</label>
                                  <input type="number" min={1} max={20} step={1} className={inputCls}
                                    value={scd.risk_management.max_positions ?? 5}
                                    onChange={(e) => updateRisk('max_positions', parseInt(e.target.value) || 5)} />
                                  <p className={descCls}>Concurrent DCA entries</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>Take Profit</label>
                                  <input type="number" min={0.005} max={0.5} step={0.005} className={inputCls}
                                    value={((getExit('take_profit')?.value ?? 0.06) * 100).toFixed(1)}
                                    onChange={(e) => updateExitCondition('take_profit', 'value', (parseFloat(e.target.value) || 6) / 100)} />
                                  <p className={descCls}>% profit target</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>Stop Loss</label>
                                  <input type="number" min={0.005} max={0.5} step={0.005} className={inputCls}
                                    value={((getExit('stop_loss')?.value ?? 0.05) * 100).toFixed(1)}
                                    onChange={(e) => updateExitCondition('stop_loss', 'value', (parseFloat(e.target.value) || 5) / 100)} />
                                  <p className={descCls}>% max loss</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>Position Size</label>
                                  <input type="number" min={1} max={100} step={1} className={inputCls}
                                    value={((scd.risk_management.position_size ?? 0.05) * 100).toFixed(0)}
                                    onChange={(e) => updateRisk('position_size', (parseFloat(e.target.value) || 5) / 100)} />
                                  <p className={descCls}>% of balance per entry</p>
                                </div>
                                <div className="space-y-1">
                                  <label className={labelCls}>Max Drawdown</label>
                                  <input type="number" min={1} max={50} step={1} className={inputCls}
                                    value={((scd.risk_management.max_drawdown ?? 0.15) * 100).toFixed(0)}
                                    onChange={(e) => updateRisk('max_drawdown', (parseFloat(e.target.value) || 15) / 100)} />
                                  <p className={descCls}>% stop trading threshold</p>
                                </div>
                              </div>
                            )}

                            {/* Trading Config Row */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-white/5">
                              {/* Trading Mode toggle */}
                              <div className="space-y-1">
                                <label className={labelCls}>Trading Mode</label>
                                <div className="flex gap-1">
                                  <button
                                    type="button"
                                    onClick={() => setBotSettingsDraft((p) => ({ ...p, tradingMode: "fixed" }))}
                                    className={`flex-1 py-1 rounded text-[10px] font-bold border transition-colors ${botSettingsDraft.tradingMode === "fixed" ? "bg-primary/20 border-primary/40 text-primary" : "bg-zinc-800 border-zinc-700 text-zinc-400"}`}
                                  >
                                    Fixed SOL
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setBotSettingsDraft((p) => ({ ...p, tradingMode: "aggressive" }))}
                                    className={`flex-1 py-1 rounded text-[10px] font-bold border transition-colors ${botSettingsDraft.tradingMode === "aggressive" ? "bg-primary/20 border-primary/40 text-primary" : "bg-zinc-800 border-zinc-700 text-zinc-400"}`}
                                  >
                                    Aggressive
                                  </button>
                                </div>
                              </div>

                              {/* Trade Size (fixed mode) or Aggressiveness slider */}
                              {botSettingsDraft.tradingMode === "fixed" ? (
                                <div className="space-y-1">
                                  <label className={labelCls}>SOL per Trade</label>
                                  <input
                                    type="number" min={0.01} step={0.1} className={inputCls}
                                    value={botSettingsDraft.tradeSize ?? ""}
                                    onChange={(e) => setBotSettingsDraft((p) => ({ ...p, tradeSize: parseFloat(e.target.value) || p.tradeSize }))}
                                  />
                                  <p className={descCls}>Fixed amount per trade</p>
                                </div>
                              ) : (
                                <div className="space-y-1">
                                  <label className={labelCls}>
                                    Max Aggressiveness <span className="text-primary">{botSettingsDraft.aggressiveness}%</span>
                                  </label>
                                  <input
                                    type="range" min={1} max={100}
                                    value={botSettingsDraft.aggressiveness ?? 10}
                                    onChange={(e) => setBotSettingsDraft((p) => ({ ...p, aggressiveness: parseInt(e.target.value) }))}
                                    className="w-full accent-primary"
                                  />
                                  <p className={descCls}>AI operates within this limit</p>
                                </div>
                              )}

                              {/* Wallet Address */}
                              <div className="space-y-1">
                                <label className={labelCls}>Wallet Address</label>
                                <input
                                  type="text"
                                  className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-primary/50"
                                  placeholder="Public key (display only)"
                                  value={botSettingsDraft.walletAddress ?? ""}
                                  onChange={(e) => setBotSettingsDraft((p) => ({ ...p, walletAddress: e.target.value }))}
                                />
                                <p className={descCls}>For tracking & display</p>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 mt-4">
                              <button
                                className="px-4 py-1.5 rounded bg-primary text-black text-sm font-bold hover:bg-primary/80 transition-colors"
                                onClick={() => saveBotSettings(selectedBot.id)}
                              >
                                Speichern
                              </button>
                              {botSettingsSaveStatus === "saved" && (
                                <span className="text-xs text-green-400 flex items-center gap-1">✓ Gespeichert</span>
                              )}
                              {botSettingsSaveStatus === "error" && (
                                <span className="text-xs text-red-400 flex items-center gap-1">✗ Fehler</span>
                              )}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Bot Details Header Card */}
                      {botInfoPanelId === selectedBot.id && (
                        <div className="animate-in slide-in-from-top-2 duration-200 px-6 py-4 space-y-4">
                          {/* Bot Key Facts Header */}
                          <Card className="border-white/5 bg-gradient-to-br from-zinc-900 via-zinc-900/95 to-zinc-800/80">
                            <CardHeader className="p-3 pb-2">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Info className="h-4 w-4 text-primary" />
                                  <h3 className="text-xs font-bold text-white uppercase">Bot Key Facts</h3>
                                </div>
                              </div>
                            </CardHeader>
                            <CardContent className="p-3 pt-0">
                              {/* Key Facts Grid */}
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {/* Total Trades */}
                                <div className="rounded-lg bg-zinc-900/50 border border-zinc-800 p-3 space-y-1">
                                  <div className="flex items-center gap-1.5">
                                    <Activity className="h-3 w-3 text-blue-400" />
                                    <span className="text-[9px] font-bold uppercase text-zinc-500">Total Trades</span>
                                  </div>
                                  <div className="text-lg font-black text-white">{selectedBot.stats?.totalTrades ?? 0}</div>
                                </div>
                                
                                {/* Win Rate */}
                                <div className="rounded-lg bg-zinc-900/50 border border-zinc-800 p-3 space-y-1">
                                  <div className="flex items-center gap-1.5">
                                    <TrendingUp className="h-3 w-3 text-emerald-400" />
                                    <span className="text-[9px] font-bold uppercase text-zinc-500">Win Rate</span>
                                  </div>
                                  <div className={`text-lg font-black ${(selectedBot.stats?.wins ?? 0) / Math.max((selectedBot.stats?.totalTrades ?? 1), 1) * 100 >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {((selectedBot.stats?.wins ?? 0) / Math.max((selectedBot.stats?.totalTrades ?? 1), 1) * 100).toFixed(1)}%
                                  </div>
                                </div>
                                
                                {/* Total PnL */}
                                <div className="rounded-lg bg-zinc-900/50 border border-zinc-800 p-3 space-y-1">
                                  <div className="flex items-center gap-1.5">
                                    {((selectedBot.stats?.totalPnlPercent ?? 0) >= 0) ? (
                                      <TrendingUp className="h-3 w-3 text-emerald-400" />
                                    ) : (
                                      <TrendingDown className="h-3 w-3 text-red-400" />
                                    )}
                                    <span className="text-[9px] font-bold uppercase text-zinc-500">Total PnL</span>
                                  </div>
                                  <div className={`text-lg font-black ${(selectedBot.stats?.totalPnlPercent ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {((selectedBot.stats?.totalPnlPercent ?? 0) >= 0 ? '+' : '')}{(selectedBot.stats?.totalPnlPercent ?? 0).toFixed(2)}%
                                  </div>
                                </div>
                                
                                {/* Uptime */}
                                <div className="rounded-lg bg-zinc-900/50 border border-zinc-800 p-3 space-y-1">
                                  <div className="flex items-center gap-1.5">
                                    <Flame className="h-3 w-3 text-orange-400" />
                                    <span className="text-[9px] font-bold uppercase text-zinc-500">Uptime</span>
                                  </div>
                                  <div className="text-lg font-black text-white">{formatUptime(selectedBot.startTime)}</div>
                                </div>
                              </div>
                              
                              {/* Data Categories Row */}
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                                {/* Price Data */}
                                <div className="rounded-lg bg-zinc-900/50 border border-zinc-800 p-3 space-y-2">
                                  <div className="flex items-center gap-1.5">
                                    <Database className="h-3 w-3 text-cyan-400" />
                                    <span className="text-[9px] font-bold uppercase text-zinc-500">Preisdaten</span>
                                  </div>
                                  <div className="flex flex-wrap gap-1.5">
                                    <span className="inline-flex items-center gap-1 bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 px-2 py-0.5 rounded text-[10px] font-mono">
                                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
                                      {selectedBot.priceHistory?.length ?? 0} Ticks
                                    </span>
                                    <span className="inline-flex items-center gap-1 bg-zinc-800 text-zinc-400 border border-zinc-700 px-2 py-0.5 rounded text-[10px] font-mono">
                                      Last: ${(selectedBot.stats?.lastPrice ?? 0).toFixed(6)}
                                    </span>
                                  </div>
                                </div>
                                
                                {/* Trade Data */}
                                <div className="rounded-lg bg-zinc-900/50 border border-zinc-800 p-3 space-y-2">
                                  <div className="flex items-center gap-1.5">
                                    <Activity className="h-3 w-3 text-purple-400" />
                                    <span className="text-[9px] font-bold uppercase text-zinc-500">Trade-Historie</span>
                                  </div>
                                  <div className="flex flex-wrap gap-1.5">
                                    <span className="inline-flex items-center gap-1 bg-purple-500/10 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded text-[10px] font-mono">
                                      {selectedBot.recentTrades?.length ?? 0} Trades
                                    </span>
                                    <span className="inline-flex items-center gap-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded text-[10px] font-mono">
                                      W: {selectedBot.stats?.wins ?? 0}
                                    </span>
                                    <span className="inline-flex items-center gap-1 bg-red-500/10 text-red-400 border border-red-500/30 px-2 py-0.5 rounded text-[10px] font-mono">
                                      L: {(selectedBot.stats?.totalTrades ?? 0) - (selectedBot.stats?.wins ?? 0)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                          
                          {/* Bot Config Card */}
                          <Card className="border-white/5 bg-gradient-to-br from-zinc-900 via-zinc-900/95 to-zinc-800/80">
                            <CardHeader className="p-3 pb-2">
                              <div className="flex items-center gap-2">
                                <Settings className="h-4 w-4 text-yellow-400" />
                                <h3 className="text-xs font-bold text-white uppercase">Bot Konfiguration</h3>
                              </div>
                            </CardHeader>
                            <CardContent className="p-3 pt-0">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {/* Trading Mode */}
                                <div className="rounded-lg bg-zinc-900/50 border border-zinc-800 p-3 space-y-2">
                                  <div className="flex items-center gap-1.5">
                                    <SlidersHorizontal className="h-3 w-3 text-yellow-400" />
                                    <span className="text-[9px] font-bold uppercase text-zinc-500">Trading Modus</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {selectedBot.tradingMode === "aggressive" ? (
                                      <span className="inline-flex items-center gap-1 bg-gradient-to-r from-purple-500/20 to-cyan-500/20 text-white border border-purple-500/30 px-2 py-0.5 rounded text-[10px] font-bold">
                                        <BrainCircuit className="h-2.5 w-2.5" />
                                        AI Aggressive {selectedBot.aiAggressiveness ?? selectedBot.aggressiveness ?? 10}%
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 bg-zinc-800 text-zinc-300 border border-zinc-700 px-2 py-0.5 rounded text-[10px] font-mono">
                                        Fixed {selectedBot.tradeSize ?? 1} SOL
                                      </span>
                                    )}
                                  </div>
                                </div>
                                
                                {/* Pattern Settings */}
                                <div className="rounded-lg bg-zinc-900/50 border border-zinc-800 p-3 space-y-2">
                                  <div className="flex items-center gap-1.5">
                                    <Settings className="h-3 w-3 text-primary/60" />
                                    <span className="text-[9px] font-bold uppercase text-zinc-500">Pattern Settings</span>
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    <span className="inline-flex items-center bg-zinc-800 text-zinc-400 border border-zinc-700 px-1.5 py-0.5 rounded text-[9px] font-mono">
                                      Floor: {selectedBot.settings?.floorWindow ?? 20}
                                    </span>
                                    <span className="inline-flex items-center bg-zinc-800 text-zinc-400 border border-zinc-700 px-1.5 py-0.5 rounded text-[9px] font-mono">
                                      Spike: {(selectedBot.settings?.spikeThreshold ?? 0.3) * 100}%
                                    </span>
                                    <span className="inline-flex items-center bg-zinc-800 text-zinc-400 border border-zinc-700 px-1.5 py-0.5 rounded text-[9px] font-mono">
                                      Drop: {(selectedBot.settings?.sellDropThreshold ?? 0.15) * 100}%
                                    </span>
                                    <span className="inline-flex items-center bg-zinc-800 text-zinc-400 border border-zinc-700 px-1.5 py-0.5 rounded text-[9px] font-mono">
                                      CD: {selectedBot.settings?.cooldownTicks ?? 5}
                                    </span>
                                  </div>
                                </div>
                                
                                {/* Wallet */}
                                <div className="rounded-lg bg-zinc-900/50 border border-zinc-800 p-3 space-y-2">
                                  <div className="flex items-center gap-1.5">
                                    <Server className="h-3 w-3 text-green-400" />
                                    <span className="text-[9px] font-bold uppercase text-zinc-500">Wallet</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="inline-flex items-center gap-1 bg-zinc-800 text-zinc-300 border border-zinc-700 px-2 py-0.5 rounded text-[10px] font-mono">
                                      {selectedBot.walletAddress?.slice(0, 6) ?? '???'}...{selectedBot.walletAddress?.slice(-4) ?? '???'}
                                    </span>
                                    <span className="inline-flex items-center gap-1 bg-green-500/10 text-green-400 border border-green-500/30 px-2 py-0.5 rounded text-[10px] font-mono">
                                      {(selectedBot.stats?.balanceSOL ?? 0).toFixed(3)} SOL
                                    </span>
                                  </div>
                                </div>
                                
                                {/* Strategy */}
                                <div className="rounded-lg bg-zinc-900/50 border border-zinc-800 p-3 space-y-2">
                                  <div className="flex items-center gap-1.5">
                                    <BrainCircuit className="h-3 w-3 text-purple-400" />
                                    <span className="text-[9px] font-bold uppercase text-zinc-500">Strategie</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="inline-flex items-center gap-1 bg-purple-500/10 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded text-[10px] font-mono capitalize">
                                      {selectedBot.strategyType ?? 'Scalping'}
                                    </span>
                                    {botSettingsChanges[selectedBot.id] && (
                                      <span className="inline-flex items-center gap-1 bg-gradient-to-r from-purple-600 to-cyan-500 text-white px-2 py-0.5 rounded text-[9px] font-bold animate-pulse">
                                        AI UPDATED
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </CardContent>
                      </Card>
                    </div>
                  )}

                  {/* Bot Info Panel Content */}
                  <CardContent className="p-0 relative bg-transparent">
                        {/* Left Panel — determines container height (60% width, flows normally) */}
                        <div className="w-[60%] border-r border-white/5 p-2.5 flex flex-col gap-2">
                          {/* Price & Trade Stats Header */}
                          <div className={`bg-primary/5 rounded-lg border-0 shadow-lg relative overflow-hidden trade-flash-target-${selectedBot.id} ai-flash-target-${selectedBot.id}`}>
                            <div className="scanline"></div>
                            {(() => {
                              const stats = selectedBot.stats;
                              const wins = stats?.wins ?? 0;
                              const losses = stats?.losses ?? 0;
                              const totalTrades = stats?.totalTrades ?? 0;
                              const balanceSOL = stats?.balanceSOL ?? 0;
                              const tradeSize = selectedBot.tradeSize ?? 1;
                              const aggressiveness = selectedBot.aiAggressiveness ?? selectedBot.aggressiveness ?? 10;
                              const tradingMode = selectedBot.tradingMode ?? "fixed";

                              // PnL sums from recent trades (approximate)
                              const trades = selectedBot.recentTrades ?? [];
                              const winPnlSum = trades.filter(t => (t.pnl ?? 0) > 0).reduce((a, t) => a + (t.pnl ?? 0), 0);
                              const lossPnlSum = trades.filter(t => (t.pnl ?? 0) < 0).reduce((a, t) => a + (t.pnl ?? 0), 0);

                              // Possible trades with current balance & settings
                              const effectiveSize = tradingMode === "aggressive"
                                ? balanceSOL * (aggressiveness / 100)
                                : tradeSize;
                              const possibleTrades = effectiveSize > 0 ? Math.floor(balanceSOL / effectiveSize) : 0;

                              // Possible profit: possibleTrades * winRate * avgWinPnl
                              const winRate = totalTrades > 0 ? wins / totalTrades : 0;
                              const recentWins = trades.filter(t => (t.pnl ?? 0) > 0).length;
                              const avgWinPnl = recentWins > 0 ? winPnlSum / recentWins : 0;
                              const possibleProfit = possibleTrades * winRate * avgWinPnl;

                              return (
                                <>
                                  <div className="flex justify-between items-start p-2.5">
                                    <div>
                                      <div className="text-micro text-primary/50 mb-2 font-bold uppercase tracking-wider flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                                        Live Cluster Price
                                      </div>
                                      <div className="text-4xl font-black text-white leading-tight tracking-tighter">
                                        ${stats?.lastPrice?.toFixed(6) || "0.000000"}
                                      </div>
                                      <div className="flex items-center gap-2 mt-3 text-micro font-mono">
                                        <span className="text-muted-foreground opacity-40">PREVIOUS CLUSTER:</span>
                                        <span className="text-primary/60 font-bold">
                                          ${selectedBot.priceHistory && selectedBot.priceHistory.length > 1
                                            ? selectedBot.priceHistory[selectedBot.priceHistory.length - 2].toFixed(6)
                                            : "---"}
                                        </span>
                                      </div>
                                    </div>

                                    <div className="flex flex-col items-end gap-4">
                                      <div className="flex gap-6 pb-2 border-b border-primary/10">
                                        <div className="text-right">
                                          <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-tight">Total Trades</div>
                                          <div className="text-xl font-black text-white leading-none mt-1">
                                            {totalTrades}
                                          </div>
                                        </div>
                                        <div className="text-right">
                                          <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-tight">Win Rate</div>
                                          <div className="text-xl font-black text-green-400 leading-none mt-1">
                                            {totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(0) : 0}%
                                          </div>
                                        </div>
                                      </div>
                                      <div className="text-right">
                                        <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-tight">Total PnL</div>
                                        <div className={`text-2xl font-black leading-none mt-1 ${(stats?.totalPnlPercent ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                                          {(stats?.totalPnlPercent ?? 0) >= 0 ? "+" : ""}{stats?.totalPnlPercent?.toFixed(2) || 0}%
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Extended Stats Row */}
                                  <div className="border-t border-primary/10 px-2.5 py-2 grid grid-cols-4 gap-2">
                                    {/* Won Trades */}
                                    <div className="bg-green-500/5 border border-green-500/15 rounded-md px-2.5 py-1.5">
                                      <div className="text-[9px] font-bold uppercase tracking-tight text-zinc-500 mb-1">Won</div>
                                      <div className="text-sm font-black text-green-400 leading-none">{wins}</div>
                                      <div className="text-[9px] font-mono text-green-400/60 mt-0.5">
                                        {winPnlSum !== 0 ? `+${winPnlSum.toFixed(4)} SOL` : "—"}
                                      </div>
                                    </div>

                                    {/* Lost Trades */}
                                    <div className="bg-red-500/5 border border-red-500/15 rounded-md px-2.5 py-1.5">
                                      <div className="text-[9px] font-bold uppercase tracking-tight text-zinc-500 mb-1">Lost</div>
                                      <div className="text-sm font-black text-red-400 leading-none">{losses}</div>
                                      <div className="text-[9px] font-mono text-red-400/60 mt-0.5">
                                        {lossPnlSum !== 0 ? `${lossPnlSum.toFixed(4)} SOL` : "—"}
                                      </div>
                                    </div>

                                    {/* Possible Trades */}
                                    <div className="bg-zinc-800/50 border border-zinc-700/40 rounded-md px-2.5 py-1.5">
                                      <div className="text-[9px] font-bold uppercase tracking-tight text-zinc-500 mb-1">Est. Trades</div>
                                      <div className="text-sm font-black text-white leading-none">{possibleTrades}</div>
                                      <div className="text-[9px] font-mono text-zinc-500 mt-0.5">
                                        {tradingMode === "aggressive" ? `${aggressiveness}% per trade` : `${tradeSize} SOL fixed`}
                                      </div>
                                    </div>

                                    {/* Possible Profit */}
                                    <div className="bg-primary/5 border border-primary/15 rounded-md px-2.5 py-1.5">
                                      <div className="text-[9px] font-bold uppercase tracking-tight text-zinc-500 mb-1">Est. Profit</div>
                                      <div className={`text-sm font-black leading-none ${possibleProfit >= 0 ? "text-primary" : "text-red-400"}`}>
                                        {possibleProfit >= 0 ? "+" : ""}{possibleProfit.toFixed(4)}
                                      </div>
                                      <div className="text-[9px] font-mono text-zinc-500 mt-0.5">
                                        SOL est.
                                      </div>
                                    </div>
                                  </div>
                                </>
                              );
                            })()}
                          </div>

                          {/* Scanner Pulse Component */}
                          <ScannerPulse bot={selectedBot} tickDuration={2000} className="h-48" />

                          {/* 2x2 Info Grid */}
                          <div className="grid grid-cols-2 gap-2">
                            {/* Performance */}
                            <div className="bg-primary/5 border-0 p-2.5 rounded-lg flex flex-col gap-1.5 shadow-md justify-between">
                              <div className="text-micro text-primary/50 font-bold uppercase tracking-wider flex justify-between items-center">
                                Performance <Zap className="h-2.5 w-2.5" />
                              </div>
                              {/* SIGNAL Badge */}
                              {(() => {
                                const lastTrade = selectedBot.recentTrades?.slice(-1)[0];
                                const inPosition = lastTrade?.action === "BUY" && !lastTrade?.exitPrice;
                                const signal = selectedBot.status !== "running" ? "HOLD" : inPosition ? "SELL" : "BUY";
                                const signalStyle = signal === "BUY"
                                  ? "text-green-400 bg-green-500/15 border-green-500/30"
                                  : signal === "SELL"
                                  ? "text-orange-400 bg-orange-500/15 border-orange-500/30"
                                  : "text-zinc-400 bg-zinc-500/15 border-zinc-500/30";
                                return (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">Signal</span>
                                    <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border ${signalStyle}`}>{signal}</span>
                                  </div>
                                );
                              })()}
                              <div className={`text-2xl font-black font-mono leading-none ${selectedBot.stats?.totalPnlPercent >= 0 ? "text-green-400" : "text-red-400"}`}>
                                {selectedBot.stats?.totalPnlPercent >= 0 ? "+" : ""}{selectedBot.stats?.totalPnlPercent?.toFixed(2) || 0}%
                              </div>
                              <div className="pt-1.5 border-t border-primary/10">
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="flex flex-col gap-0.5">
                                    <span className="text-[9px] font-bold uppercase text-zinc-500">Win Rate</span>
                                    <span className="text-label font-bold text-primary">
                                      {selectedBot.stats?.totalTrades > 0 ? ((selectedBot.stats.wins / selectedBot.stats.totalTrades) * 100).toFixed(0) : 0}%
                                    </span>
                                  </div>
                                  <div className="flex flex-col gap-0.5">
                                    <span className="text-[9px] font-bold uppercase text-zinc-500">Trades</span>
                                    <span className="text-label font-bold text-white">{selectedBot.stats?.totalTrades || 0}</span>
                                  </div>
                                  {selectedBot.recentTrades && selectedBot.recentTrades.length > 0 && (() => {
                                    const lastClosed = [...selectedBot.recentTrades].reverse().find((t) => t.pnl !== undefined);
                                    return lastClosed && lastClosed.pnl !== undefined ? (
                                      <div className="flex flex-col gap-0.5">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">Last PnL</span>
                                        <span className={`text-label font-bold font-mono ${lastClosed.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                                          {lastClosed.pnl >= 0 ? "+" : ""}{lastClosed.pnl.toFixed(4)}
                                        </span>
                                      </div>
                                    ) : null;
                                  })()}
                                </div>
                              </div>
                              {selectedTokenInfo && (() => {
                                const fmtUsd = (v: number) =>
                                  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M`
                                  : v >= 1_000 ? `$${(v / 1_000).toFixed(0)}K`
                                  : `$${v.toFixed(0)}`;
                                return (
                                  <div className="pt-1.5 border-t border-primary/10">
                                    <div className="grid grid-cols-2 gap-2">
                                      <div className="flex flex-col gap-0.5">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">Token</span>
                                        <span className="text-label font-bold text-white font-mono">{selectedTokenInfo.symbol}</span>
                                      </div>
                                      {selectedTokenInfo.priceChange24h !== undefined && (
                                        <div className="flex flex-col gap-0.5">
                                          <span className="text-[9px] font-bold uppercase text-zinc-500">24h Δ</span>
                                          <span className={`text-label font-bold font-mono ${(selectedTokenInfo.priceChange24h ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                                            {(selectedTokenInfo.priceChange24h ?? 0) >= 0 ? "+" : ""}{selectedTokenInfo.priceChange24h?.toFixed(2)}%
                                          </span>
                                        </div>
                                      )}
                                      {selectedTokenInfo.volume24h !== undefined && (
                                        <div className="flex flex-col gap-0.5">
                                          <span className="text-[9px] font-bold uppercase text-zinc-500">Vol 24h</span>
                                          <span className="text-label font-bold text-zinc-300">{fmtUsd(selectedTokenInfo.volume24h)}</span>
                                        </div>
                                      )}
                                      {selectedTokenInfo.liquidity !== undefined && (
                                        <div className="flex flex-col gap-0.5">
                                          <span className="text-[9px] font-bold uppercase text-zinc-500">Liq.</span>
                                          <span className="text-label font-bold text-zinc-300">{fmtUsd(selectedTokenInfo.liquidity)}</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>

                            {/* Strategy Config */}
                            <div className={`bg-zinc-800/60 border-0 p-2.5 rounded-lg flex flex-col gap-1.5 shadow-md justify-between ai-flash-target-${selectedBot.id}`}>
                              <div className="text-micro text-primary/50 font-bold uppercase tracking-wider flex justify-between items-center gap-1.5">
                                <span className="flex items-center gap-1.5">
                                  Strategy Config
                                </span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {selectedBot.strategyType && (() => {
                                    const st = selectedBot.strategyType;
                                    const desc = st === 'trend' ? "Trend Strategy: Folgt dem Markttrend für längerfristige Positionen." : 
                                                st === 'mean_reversion' ? "Mean Reversion: Setzt auf die Rückkehr zum Durchschnittspreis." :
                                                st === 'breakout' ? "Breakout Strategy: Nutzt massive Ausbrüche aus Preiszonen." :
                                                st === 'momentum' ? "Momentum Strategy: Exploits the speed of price movements." :
                                                "Scalping Strategy: Exploits small price spikes for quick profits.";
                                    return (
                                      <span 
                                        className={`flex items-center gap-0.5 text-[8px] font-bold px-1.5 py-0.5 rounded border cursor-help ${getStrategyColor(st)}`}
                                        onMouseEnter={(e) => tooltip.show(desc, e)}
                                        onMouseMove={(e) => tooltip.move(e)}
                                        onMouseLeave={() => tooltip.hide()}
                                      >
                                        {getStrategyIcon(st, "h-2 w-2")}
                                        {st}
                                      </span>
                                    );
                                  })()}
                                  {botSettingsChanges[selectedBot.id] ? (
                                    <span className={`flex items-center gap-1 bg-linear-to-r from-purple-600 to-cyan-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded shadow-sm shrink-0 shadow-purple-500/30`}>
                                      <BrainCircuit className="h-2 w-2" /> AI UPDATED · {new Date(botSettingsChanges[selectedBot.id][0]?.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                    </span>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={() => openBotSettingsPanel(selectedBot)}
                                    className={`p-0.5 rounded transition-colors ${botSettingsPanelId === selectedBot.id ? "text-primary" : "text-zinc-600 hover:text-zinc-300"}`}
                                    title="Bot Settings öffnen"
                                  >
                                    <SlidersHorizontal className="h-3 w-3" />
                                  </button>
                                </div>

                              </div>

                              {/* Dynamic strategy-type-specific params */}
                              {(() => {
                                const sType = selectedBot.strategyType ?? 'scalping';
                                const indVals = botIndicators[selectedBot.id]?.latestValues ?? {};
                                const fmt = (v: number | undefined) => v === undefined || isNaN(v) ? <span className="text-zinc-600 text-[9px]">WARM</span> : <span className="text-primary font-mono text-label">{v.toFixed(6)}</span>;
                                const _pct = (v: number | undefined) => v === undefined || isNaN(v) ? <span className="text-zinc-600 text-[9px]">WARM</span> : <span className="text-primary font-mono text-label">{(v * 100).toFixed(2)}%</span>; void _pct;
                                const condBadge = (ok: boolean | undefined) => ok === undefined ? null : ok
                                  ? <span className="text-[9px] text-emerald-400 font-bold">✓</span>
                                  : <span className="text-[9px] text-zinc-600 font-bold">✗</span>;

                                if (sType === 'scalping' || !selectedBot.strategyType) {
                                  // Fallback to top-level settings for scalping if config not fully populated
                                  const cfg = selectedBot.strategyConfig;
                                  const floor = cfg?.indicators?.find((i: any) => i.type === 'FLOOR')?.window ?? selectedBot.settings?.floorWindow;
                                  // @ts-ignore
                                  const spike = cfg?.entry_conditions?.find((e: any) => e.type === 'spike')?.threshold ?? selectedBot.settings?.spikeThreshold;
                                  // @ts-ignore
                                  const drop = cfg?.exit_conditions?.find((e: any) => e.type === 'drop')?.threshold ?? selectedBot.settings?.sellDropThreshold;
                                  // @ts-ignore
                                  const cooldown = cfg?.execution?.cooldown_ticks ?? selectedBot.settings?.cooldownTicks;

                                  return (
                                    <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 mt-1">
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">Floor Window</span>
                                        <span className={`text-label font-bold ${botSettingsChanges[selectedBot.id]?.some(c => c.key === 'floorWindow') ? 'text-cyan-400 animate-pulse' : 'text-primary'}`}>{floor} ticks</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">Spike Trigger</span>
                                        <span className={`text-label font-bold ${botSettingsChanges[selectedBot.id]?.some(c => c.key === 'spikeThreshold') ? 'text-cyan-400 animate-pulse' : 'text-primary'}`}>{spike}% rise</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">Sell on Drop</span>
                                        <span className={`text-label font-bold ${botSettingsChanges[selectedBot.id]?.some(c => c.key === 'sellDropThreshold') ? 'text-cyan-400 animate-pulse' : 'text-primary'}`}>{drop}% fall</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">Cooldown</span>
                                        <span className={`text-label font-bold ${botSettingsChanges[selectedBot.id]?.some(c => c.key === 'cooldownTicks') ? 'text-cyan-400 animate-pulse' : 'text-primary'}`}>{cooldown} ticks</span>
                                      </div>
                                    </div>
                                  );
                                }

                                if (sType === 'trend') {
                                  const cfg = selectedBot.strategyConfig;
                                  const fast = cfg?.indicators?.find((i: any) => i.type === 'EMA' && i.period < 30)?.period ?? 20;
                                  const slow = cfg?.indicators?.find((i: any) => i.type === 'EMA' && i.period >= 30)?.period ?? 50;
                                  const rsi = cfg?.indicators?.find((i: any) => i.type === 'RSI')?.period ?? 14;
                                  const rsiMax = cfg?.entry_conditions?.find((e: any) => e.left === 'RSI_14')?.right ?? 65;
                                  const tp = cfg?.exit_conditions?.find((e: any) => e.type === 'take_profit')?.value ?? 0.04;

                                  return (
                                    <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 mt-1">
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">Fast EMA</span>
                                        <span className="text-label font-bold text-primary">{fast} periods</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">Slow EMA</span>
                                        <span className="text-label font-bold text-primary">{slow} periods</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">RSI Filter</span>
                                        <span className="text-label font-bold text-primary">RSI({rsi}) &lt; {rsiMax}</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">Take Profit</span>
                                        <span className="text-label font-bold text-emerald-400">+{(tp * 100).toFixed(0)}%</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">Trend Condition</span>
                                        <span className="text-label font-bold text-primary">EMA Cross</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">Status</span>
                                        <div className="flex items-center gap-1">
                                          {condBadge(!isNaN(indVals['EMA_20']) && !isNaN(indVals['EMA_50']) ? indVals['EMA_20'] > indVals['EMA_50'] : undefined)}
                                          <span className="text-[9px] text-zinc-400">Stable</span>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                }

                                if (sType === 'mean_reversion') {
                                  const cfg = selectedBot.strategyConfig;
                                  const rsi = cfg?.indicators?.find((i: any) => i.type === 'RSI')?.period ?? 14;
                                  const bb = cfg?.indicators?.find((i: any) => i.type === 'BB')?.period ?? 20;
                                  const std = cfg?.indicators?.find((i: any) => i.type === 'BB')?.std_dev ?? 2;
                                  const oversold = cfg?.entry_conditions?.find((e: any) => e.left === 'RSI_14')?.right ?? 32;
                                  const tp = cfg?.exit_conditions?.find((e: any) => e.type === 'take_profit')?.value ?? 0.035;

                                  return (
                                    <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 mt-1">
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">RSI Period</span>
                                        <span className="text-label font-bold text-primary">{rsi} periods</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">Oversold</span>
                                        <span className="text-label font-bold text-emerald-400">RSI &lt; {oversold}</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">Bollinger</span>
                                        <span className="text-label font-bold text-primary">{bb}, {std}σ</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">Take Profit</span>
                                        <span className="text-label font-bold text-emerald-400">+{(tp * 100).toFixed(1)}%</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">RSI Current</span>
                                        <div className="flex items-center gap-1">
                                          {fmt(indVals['RSI_14'])}
                                          {indVals['RSI_14'] < 30 && <span className="text-[8px] text-emerald-400 font-bold animate-pulse">BUY</span>}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                }

                                if (sType === 'breakout') {
                                  const cfg = selectedBot.strategyConfig;
                                  const bb = cfg?.indicators?.find((i: any) => i.type === 'BB')?.period ?? 20;
                                  const rsiMin = cfg?.entry_conditions?.find((e: any) => e.left === 'RSI_14')?.right ?? 50;
                                  const atr = cfg?.indicators?.find((i: any) => i.type === 'ATR')?.period ?? 14;
                                  const tp = cfg?.exit_conditions?.find((e: any) => e.type === 'take_profit')?.value ?? 0.05;

                                  return (
                                    <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 mt-1">
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">BB Breakout</span>
                                        <span className="text-label font-bold text-primary">{bb} periods</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">Momentum</span>
                                        <span className="text-label font-bold text-primary">RSI &gt; {rsiMin}</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">ATR Filter</span>
                                        <span className="text-label font-bold text-primary">Period {atr}</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">Take Profit</span>
                                        <span className="text-label font-bold text-emerald-400">+{(tp * 100).toFixed(0)}%</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">Upper Band</span>
                                        <span className="text-label font-bold text-cyan-400 flex items-center gap-1">
                                          {condBadge(!isNaN(indVals['price']) && !isNaN(indVals['BB_upper']) ? indVals['price'] > indVals['BB_upper'] : undefined)}
                                          Break?
                                        </span>
                                      </div>
                                    </div>
                                  );
                                }

                                if (sType === 'momentum') {
                                  const cfg = selectedBot.strategyConfig;
                                  const macd = `${cfg?.indicators?.find((i: any) => i.type === 'MACD')?.fast_period ?? 12}/${cfg?.indicators?.find((i: any) => i.type === 'MACD')?.slow_period ?? 26}`;
                                  const rsiMax = cfg?.entry_conditions?.find((e: any) => e.left === 'RSI_14')?.right ?? 70;
                                  const tp = cfg?.exit_conditions?.find((e: any) => e.type === 'take_profit')?.value ?? 0.045;

                                  return (
                                    <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 mt-1">
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">MACD Fast/Slow</span>
                                        <span className="text-label font-bold text-primary">{macd}</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">RSI Limit</span>
                                        <span className="text-label font-bold text-primary">RSI &lt; {rsiMax}</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">Take Profit</span>
                                        <span className="text-label font-bold text-emerald-400">+{(tp * 100).toFixed(1)}%</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">Momentum</span>
                                        <div className="flex items-center gap-1">
                                          {condBadge(!isNaN(indVals['MACD_histogram']) ? indVals['MACD_histogram'] > 0 : undefined)}
                                          <span className="text-[9px] text-zinc-400">Bullish?</span>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                }

                                if (sType === 'grid') {
                                  const cfg = selectedBot.strategyConfig;
                                  // @ts-ignore
                                  const levels = cfg?.grid_levels ?? cfg?.risk_management?.max_positions ?? '–';
                                  const posSize = cfg?.risk_management?.position_size ?? 0.05;
                                  const maxPos = cfg?.risk_management?.max_positions ?? '–';
                                  return (
                                    <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 mt-1">
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">Grid Levels</span>
                                        <span className="text-label font-bold text-primary">{levels}</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">Max Positions</span>
                                        <span className="text-label font-bold text-primary">{maxPos} slots</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">Position Size</span>
                                        <span className="text-label font-bold text-primary">{(posSize * 100).toFixed(0)}% bal</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">Mode</span>
                                        <span className="text-label font-bold text-zinc-400">Auto Grid</span>
                                      </div>
                                    </div>
                                  );
                                }

                                if (sType === 'dca') {
                                  const cfg = selectedBot.strategyConfig;
                                  const rsi = cfg?.indicators?.find((i: any) => i.type === 'RSI')?.period ?? 14;
                                  const ema = cfg?.indicators?.find((i: any) => i.type === 'EMA')?.period ?? 100;
                                  const posSize = cfg?.risk_management?.position_size ?? 0.05;
                                  const maxPos = cfg?.risk_management?.max_positions ?? 5;
                                  const tp = cfg?.exit_conditions?.find((e: any) => e.type === 'take_profit')?.value ?? 0.06;
                                  const sl = cfg?.exit_conditions?.find((e: any) => e.type === 'stop_loss')?.value ?? 0.05;
                                  const rsiEntry = cfg?.entry_conditions?.find((e: any) => e.left === 'RSI_14');
                                  const rsiThreshold = rsiEntry ? rsiEntry.right : 40;
                                  return (
                                    <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 mt-1">
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">RSI Period</span>
                                        <span className="text-label font-bold text-primary">{rsi} periods</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">RSI Entry</span>
                                        <span className="text-label font-bold text-primary">RSI &lt; {rsiThreshold}</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">EMA Filter</span>
                                        <span className="text-label font-bold text-primary">EMA {ema}</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">Max Positions</span>
                                        <span className="text-label font-bold text-primary">{maxPos} slots</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">Position Size</span>
                                        <span className="text-label font-bold text-primary">{(posSize * 100).toFixed(0)}% bal</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">Take Profit</span>
                                        <span className="text-label font-bold text-emerald-400">+{(tp * 100).toFixed(0)}%</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">Stop Loss</span>
                                        <span className="text-label font-bold text-red-400">−{(sl * 100).toFixed(0)}%</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase text-zinc-500">Indicators</span>
                                        <span className="text-label font-bold text-primary">RSI + EMA</span>
                                      </div>
                                    </div>
                                  );
                                }

                                return null;
                              })()}

                              {/* AI Change Details - below settings grid */}
                              {(() => {
                                const liveChanges = botSettingsChanges[selectedBot.id];
                                const histEntry = [...agentHistory].find(h => h.botId === selectedBot.id);
                                const getRegimeBadge = (r: string) => {
                                  const c = r === "RANGING" ? "bg-blue-500/20 text-blue-300 border-blue-500/30" : r === "TRENDING" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : r === "VOLATILE" ? "bg-amber-500/20 text-amber-300 border-amber-500/30" : "bg-red-500/20 text-red-300 border-red-500/30";
                                  return <span className={`text-[8px] font-black uppercase tracking-wider px-1 py-0.5 rounded border ${c}`}>{r}</span>;
                                };
                                const displayNames: Record<string, string> = { spikeThreshold: "Spike", sellDropThreshold: "Sell Drop", floorWindow: "Floor Win", cooldownTicks: "Cooldown" };
                                if (liveChanges && liveChanges.length > 0) {
                                  const adv = agentAdvice.find(a => a.botId === selectedBot.id);
                                  const regime = adv?.advice?.regime;
                                  const conf = adv?.advice?.confidence;
                                  return (
                                    <div className="bg-purple-500/10 border border-purple-500/30 rounded px-2 py-1.5 mt-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
                                      <div className="text-[9px] font-bold uppercase tracking-wider mb-1.5 flex items-center justify-between text-purple-400">
                                        <span className="flex items-center gap-1"><BrainCircuit className="h-3 w-3" /> AI Updated</span>
                                        <div className="flex items-center gap-1.5">
                                          {regime && getRegimeBadge(regime)}
                                          {conf !== undefined && <span className="text-[8px] font-mono text-purple-300">{(conf * 100).toFixed(0)}%</span>}
                                        </div>
                                      </div>
                                      <div className="space-y-1">
                                        {liveChanges.map((change, idx) => (
                                          <div key={idx} className="flex items-center gap-1.5 text-[10px] font-mono">
                                            <span className="text-zinc-400 w-14 shrink-0 truncate font-semibold">{displayNames[change.key] ?? change.key}</span>
                                            <span className="text-zinc-300 tabular-nums">{change.oldValue}</span>
                                            <span className="text-zinc-400 text-[9px] mx-0.5">→</span>
                                            <span className="text-cyan-400 font-bold tabular-nums">{change.newValue}</span>
                                            <span className={`ml-auto text-[9px] font-bold px-1 rounded ${change.changePercent > 0 ? "text-green-400 bg-green-500/15" : change.changePercent < 0 ? "text-red-400 bg-red-500/15" : "text-zinc-300 bg-zinc-500/25"}`}>
                                              {change.changePercent > 0 ? "+" : ""}{change.changePercent.toFixed(1)}%
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                }
                                if (histEntry) {
                                  const adj = typeof histEntry.adjustedSettings === "string" ? JSON.parse(histEntry.adjustedSettings) : (histEntry.adjustedSettings ?? {});
                                  const keys = Object.keys(adj);
                                  if (keys.length === 0) return null;
                                  const ago = Math.round((Date.now() - histEntry.timestamp) / 60000);
                                  return (
                                    <div className="border border-purple-500/20 rounded px-2 py-1.5 mt-1.5 bg-purple-500/5">
                                      <div className="text-[9px] font-bold uppercase tracking-wider mb-1.5 flex items-center justify-between text-purple-400/70">
                                        <span className="flex items-center gap-1"><BrainCircuit className="h-3 w-3" /> Last Run · {ago}m ago</span>
                                        <div className="flex items-center gap-1.5">
                                          {histEntry.regime && getRegimeBadge(histEntry.regime)}
                                          {histEntry.confidence !== undefined && <span className="text-[8px] font-mono text-purple-300">{(histEntry.confidence * 100).toFixed(0)}%</span>}
                                        </div>
                                      </div>
                                      <div className="space-y-1">
                                        {keys.map((k, i) => (
                                          <div key={i} className="flex items-center gap-1.5 text-[10px] font-mono">
                                            <span className="text-zinc-400 w-14 shrink-0 truncate font-semibold">{displayNames[k] ?? k}</span>
                                            <span className="text-cyan-400/90 font-bold tabular-nums">{adj[k]}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                }
                                return null;
                              })()}
                            </div>

                            {/* Oracle Analysis */}
                            <div className="bg-cyan-500/10 border border-cyan-500/20 p-3 rounded-lg flex flex-col gap-2.5 shadow-md justify-between">
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-[11px] font-bold text-cyan-300 flex items-center gap-1.5 shrink-0">
                                  <BrainCircuit className="h-3.5 w-3.5" /> Oracle Analysis
                                </div>
                                <button
                                  onClick={triggerAgentAnalysis}
                                  disabled={isTriggering}
                                  onMouseEnter={(e) => tooltip.show(
                                    <div className="space-y-1">
                                      <div className="font-semibold text-cyan-300 flex items-center gap-1.5">
                                        <Zap className="h-3 w-3" /> Trigger Oracle Analysis
                                      </div>
                                      <div className="text-zinc-400 text-[11px] leading-relaxed">
                                        Immediately starts an AI analysis cycle for this bot.
                                      </div>
                                      <div className="text-zinc-500 text-[10px] pt-0.5 border-t border-white/5 mt-1">
                                        Normal duty cycle: every 21 minutes
                                      </div>
                                    </div>
                                  , e, { maxWidth: 320 })}
                                  onMouseMove={(e) => tooltip.move(e)}
                                  onMouseLeave={() => tooltip.hide()}
                                  className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-md bg-cyan-500/25 hover:bg-cyan-500/40 text-cyan-200 hover:text-white border border-cyan-500/40 hover:border-cyan-400/70 transition-all disabled:opacity-40 cursor-pointer shrink-0 shadow-sm hover:shadow-cyan-500/20"
                                >
                                  {isTriggering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                                  {isTriggering ? "Analyzing…" : "Run Analysis"}
                                </button>
                              </div>
                              {(() => {
                                const latest = agentAdvice.find((a) => a.botId === selectedBot.id);
                                if (latest?.advice) {
                                  const { regime, confidence, reason, analysis } = latest.advice;
                                  const regimeColor = regime === "RANGING" ? "bg-blue-500/25 text-blue-300 border-blue-500/40" : regime === "TRENDING" ? "bg-emerald-500/25 text-emerald-300 border-emerald-500/40" : regime === "VOLATILE" ? "bg-amber-500/25 text-amber-300 border-amber-500/40" : "bg-red-500/25 text-red-300 border-red-500/40";
                                  return (
                                    <>
                                      <div className="flex items-center gap-2">
                                        <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded border shrink-0 ${regimeColor}`}>{regime}</span>
                                        <div className="flex-1 flex items-center gap-2">
                                          <div className="flex-1 h-[4px] bg-zinc-700/80 rounded-full overflow-hidden">
                                            <div className="h-full bg-gradient-to-r from-cyan-500 to-cyan-300 rounded-full transition-all duration-500" style={{ width: `${((confidence ?? 0) * 100).toFixed(0)}%` }} />
                                          </div>
                                          <span className="text-[11px] text-cyan-300 font-mono font-bold tabular-nums">{((confidence ?? 0) * 100).toFixed(0)}%</span>
                                        </div>
                                      </div>
                                      {reason && (
                                        <p
                                          className="text-[12px] text-zinc-300 leading-relaxed truncate cursor-help max-w-full"
                                          onMouseEnter={(e) => tooltip.show(
                                            <div className="space-y-0.5">
                                              <div className="font-semibold text-zinc-100 not-italic">Reason</div>
                                              <div className="text-zinc-300 italic text-[11px] leading-relaxed">{reason}</div>
                                            </div>
                                          , e, { maxWidth: 450 })}
                                          onMouseMove={(e) => tooltip.move(e)}
                                          onMouseLeave={() => tooltip.hide()}
                                        >
                                          <span className="font-semibold text-zinc-500 mr-1">Reason:</span>
                                          {reason}
                                        </p>
                                      )}
                                      {analysis && (
                                        <p
                                          className="text-[12px] leading-relaxed text-cyan-100 line-clamp-2 cursor-help max-w-full"
                                          onMouseEnter={(e) => tooltip.show(
                                            <div className="space-y-1">
                                              <div className="font-semibold text-cyan-200 flex items-center gap-1.5">
                                                <BrainCircuit className="h-3 w-3" /> Analysis
                                              </div>
                                              <div className="text-zinc-100 text-[11px] leading-relaxed whitespace-pre-wrap">{analysis}</div>
                                            </div>
                                          , e, { maxWidth: 500 })}
                                          onMouseMove={(e) => tooltip.move(e)}
                                          onMouseLeave={() => tooltip.hide()}
                                        >
                                          <span className="font-semibold text-cyan-400/70 mr-1">Analysis:</span>
                                          {analysis}
                                        </p>
                                      )}
                                    </>
                                  );
                                }
                                return <p className="text-[11px] leading-relaxed italic text-cyan-200/50">Quantum analysis in progress (21 min duty cycle)…</p>;
                              })()}
                            </div>

                            {/* Engine Status */}
                            <div className="p-2.5 bg-zinc-900/80 border-0 rounded-lg flex flex-col gap-1.5 shadow-md justify-between">
                              <div className="flex justify-between items-center">
                                <div className="text-micro text-primary/50 font-bold uppercase tracking-wider">Engine Status</div>
                                <Activity className="h-2.5 w-2.5 text-primary animate-pulse" />
                              </div>
                              <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 mt-0.5">
                                <div className="flex flex-col">
                                  <span className="text-[9px] font-bold uppercase text-zinc-500">Price Ticks</span>
                                  <span className="text-label font-bold">{selectedBot.totalTicks || 0}</span>
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-[9px] font-bold uppercase text-zinc-500">Sync State</span>
                                  <span className="text-label font-bold text-green-400">Synced</span>
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-[9px] font-bold uppercase text-zinc-500">Buffer Fill</span>
                                  <span className="text-label font-bold">{Math.min(selectedBot.totalTicks || 0, selectedBot.settings?.floorWindow || 20)}/{selectedBot.settings?.floorWindow || 20}</span>
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-[9px] font-bold uppercase text-zinc-500">Bot Mode</span>
                                  <button
                                    onClick={async () => {
                                      const newMode = !selectedBot.paperMode;
                                      await fetch(`${getApiBase()}/api/bots/${selectedBot.id}/paperMode`, {
                                        method: 'PUT',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ paperMode: newMode }),
                                      });
                                    }}
                                    className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-label font-bold transition-all ${
                                      selectedBot.paperMode 
                                        ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30' 
                                        : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                                    }`}
                                    title={selectedBot.paperMode ? 'Click to switch to LIVE mode' : 'Click to switch to PAPER mode'}
                                  >
                                    {selectedBot.paperMode ? (
                                      <>
                                        <FlaskConical className="h-3 w-3" />
                                        <span>Paper</span>
                                      </>
                                    ) : (
                                      <>
                                        <Flame className="h-3 w-3" />
                                        <span>Live</span>
                                      </>
                                    )}
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Right Panel: absolutely positioned — takes height from left panel */}
                        <div className="absolute top-0 right-0 w-[40%] h-full grid grid-rows-[auto_1fr] p-2.5 gap-2 overflow-hidden">
                          <LastActivityCard bot={selectedBot} />
                          <div className="overflow-hidden">
                            <LiveFeedListCard 
                              bot={selectedBot} 
                              agentAdvice={agentAdvice.filter(a => a.botId === selectedBot.id)} 
                              agentHistory={agentHistory.filter(h => h.botId === selectedBot.id)}
                              terminalLogs={terminalLogs[selectedBot.id] ?? []}
                            />
                          </div>
                        </div>
                      </CardContent>

                      {/* Glass Footer */}
                      <div className="px-6 py-2 border-t border-white/5 bg-transparent flex justify-between items-center text-micro font-mono text-muted-foreground">
                        <div className="flex items-center gap-4">
                          <span className="flex items-center gap-1"><Server className="h-3 w-3" /> Node: Local Daemon</span>
                          <span className="flex items-center gap-1"><Activity className="h-3 w-3 text-primary" /> TPS: 4.8K</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="h-1 w-1 rounded-full bg-primary animate-ping"></span>
                          Scalpatron Core Redesign Alpha
                        </div>
                      </div>
                    </Card>

                    {/* Trade History + Chart side-by-side */}
                    <div className="grid grid-cols-2 gap-3">

                      {/* Trade History Card */}
                      <Card className={`relative overflow-hidden border border-primary/40 bg-transparent shadow-none transition-all duration-300 rounded-2xl trade-flash-target-${selectedBot.id} ai-flash-target-${selectedBot.id}`}>
                        {/* Particle overlay on flash */}
                        {(tradeFlash[selectedBot.id] || aiFlash[selectedBot.id]) && (
                          <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-xl">
                            {Array.from({ length: 12 }).map((_, pi) => {
                              const particleColor = aiFlash[selectedBot.id]
                                ? "rgba(168, 85, 247, 0.9)" // purple for AI update
                                : tradeFlash[selectedBot.id] === "buy"
                                  ? "rgba(34, 197, 94, 0.9)" // green for buy
                                  : "rgba(239, 68, 68, 0.9)"; // red for sell
                              return (
                                <div
                                  key={pi}
                                  className="absolute rounded-full"
                                  style={{
                                    width: `${4 + Math.random() * 6}px`,
                                    height: `${4 + Math.random() * 6}px`,
                                    left: `${10 + Math.random() * 80}%`,
                                    top: `${20 + Math.random() * 60}%`,
                                    background: particleColor,
                                    animation: `particle-burst ${0.8 + Math.random() * 0.8}s ease-out forwards`,
                                    animationDelay: `${Math.random() * 0.3}s`,
                                  }}
                                />
                              );
                            })}
                          </div>
                        )}
                        <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-white/5">
                          <TrendingUp className="h-3.5 w-3.5 text-primary" />
                          <span className="text-xs font-semibold tracking-wide text-zinc-300">Trade History</span>
                          <span className="ml-auto text-[10px] font-mono text-zinc-500">{selectedBot.recentTrades?.length ?? 0} trades</span>
                        </div>
                        <div className="p-2 overflow-auto max-h-[280px] custom-scrollbar">
                          {(() => {
                            const tradeRows: LogFeedRowData[] = (selectedBot.recentTrades || []).map((t: { timestamp: number; action: string; price: number; pnlPercent?: number }, i: number) => {
                              const pnlNode = t.pnlPercent != null
                                ? <span className={`font-mono font-bold ${t.pnlPercent >= 0 ? "text-green-400" : "text-red-400"}`}>{t.pnlPercent >= 0 ? "+" : ""}{t.pnlPercent.toFixed(2)}%</span>
                                : undefined;
                              return {
                                id: i,
                                timestamp: new Date(t.timestamp).toLocaleTimeString([], { hour12: false }),
                                badge: { text: t.action, variant: (t.action === "BUY" ? "green" : "red") as BadgeVariant },
                                mainContent: `$${t.price?.toFixed(8) ?? "—"}`,
                                rightContent: pnlNode,
                                accent: i === 0 ? (t.action === "BUY" ? "green" : "red") : undefined,
                                hoverText: `${t.action}  $${t.price?.toFixed(8)}${t.pnlPercent != null ? `  PnL: ${t.pnlPercent >= 0 ? "+" : ""}${t.pnlPercent.toFixed(2)}%` : ""}`,
                              };
                            });
                            return <LogFeedList rows={tradeRows} emptyMessage="No trades recorded yet." showFadeGradient />;
                          })()}
                        </div>
                      </Card>

                      {/* Chart Card */}
                      <Card className={`relative overflow-hidden border border-primary/40 bg-transparent shadow-none transition-all duration-300 rounded-2xl trade-flash-target-${selectedBot.id} ai-flash-target-${selectedBot.id}`}>
                        <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-white/5">
                          <Activity className="h-3.5 w-3.5 text-primary" />
                          <span className="text-xs font-semibold tracking-wide text-zinc-300">Price Chart</span>
                          <span className="ml-auto text-[10px] font-mono text-zinc-500">{selectedBot.priceHistory?.length ?? 0} ticks</span>
                        </div>
                        <div className="h-[280px] p-1">
                          {selectedBot.priceHistory && selectedBot.priceHistory.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={selectedBot.priceHistory.map((price, i) => ({ index: i, price }))}>
                                <defs>
                                  <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3}/>
                                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/>
                                  </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                                <XAxis
                                  dataKey="index"
                                  stroke="#52525b"
                                  tick={{ fontSize: 9, fill: "#71717a" }}
                                  tickFormatter={(val) => val % 10 === 0 ? val : ''}
                                />
                                <YAxis
                                  stroke="#52525b"
                                  tick={{ fontSize: 9, fill: "#71717a" }}
                                  domain={['auto', 'auto']}
                                  tickFormatter={(val) => `$${val.toFixed(5)}`}
                                  width={72}
                                />
                                <Tooltip
                                  contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '8px', fontSize: '11px' }}
                                  labelStyle={{ color: '#71717a' }}
                                  formatter={(value) => [`$${Number(value).toFixed(8)}`, 'Price']}
                                  labelFormatter={(label) => `Tick #${label}`}
                                />
                                <Area
                                  type="monotone"
                                  dataKey="price"
                                  stroke="#06b6d4"
                                  strokeWidth={1.5}
                                  fillOpacity={1}
                                  fill="url(#colorPrice)"
                                />
                              </AreaChart>
                            </ResponsiveContainer>
                          ) : (
                            <div className="h-full flex flex-col items-center justify-center gap-3 opacity-30">
                              <Activity className="h-10 w-10 text-primary animate-pulse" />
                              <p className="text-muted-foreground font-mono text-xs">Awaiting price data…</p>
                            </div>
                          )}
                        </div>
                      </Card>

                    </div>
                  </div>
                </div>
                );
              })()}
            </div>
          ) : activeTab === "tokens" ? (
            // TOKEN MANAGEMENT VIEW
            <div className="space-y-6 max-w-7xl mx-auto">
              {/* Einheitlicher Header */}
              <div className="flex items-center gap-3 mb-6">
                <Database className="h-8 w-8 text-primary" />
                <div>
                  <h1 className="text-3xl font-bold tracking-tighter">Token Whitelist</h1>
                  <p className="text-muted-foreground mt-1">
                    Manage tokens available for trading and charting.
                  </p>
                </div>
              </div>

              {/* Header Actions */}
              <div className="flex justify-end">
                <Button onClick={() => setIsAddTokenDialogOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" /> Add Token
                </Button>
              </div>
              
              {/* Token List Table */}
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Mint Address</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">24h Volume</TableHead>
                      <TableHead className="text-right">24h Change</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tokens.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                          <Database className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                          <p>No tokens in whitelist. Click "Add Token" to get started.</p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      tokens.map((token) => (
                        <TableRow key={token.mintAddress}>
                          <TableCell className="font-bold text-primary">{token.symbol}</TableCell>
                          <TableCell className="text-muted-foreground">{token.name}</TableCell>
                          <TableCell className="font-mono text-xs">
                            <span className="bg-muted px-2 py-1 rounded">{token.mintAddress.slice(0, 8)}...{token.mintAddress.slice(-8)}</span>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            <span className={token.priceUsd ? "text-white" : "text-muted-foreground"}>
                              {formatPrice(token.priceUsd)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">
                            {formatVolume(token.volume24h)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {token.priceChange24h !== undefined && token.priceChange24h !== null ? (
                              <span className={token.priceChange24h >= 0 ? "text-green-400" : "text-red-400"}>
                                {token.priceChange24h >= 0 ? "+" : ""}{token.priceChange24h.toFixed(2)}%
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                              onClick={() => handleRemoveToken(token.mintAddress)}
                            >
                              Remove
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </Card>
              
              {/* Add Token Dialog */}
              <Dialog open={isAddTokenDialogOpen} onOpenChange={setIsAddTokenDialogOpen}>
                <DialogContent className="sm:max-w-[500px]">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <Database className="h-5 w-5 text-primary" />
                      Add Token to Whitelist
                    </DialogTitle>
                    <DialogDescription>
                      Enter a Solana token mint address to add it to your whitelist.
                      Token info will be fetched from DexScreener.
                    </DialogDescription>
                  </DialogHeader>
                  
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="mintAddress">Mint Address *</Label>
                      <div className="flex gap-2">
                        <Input
                          id="mintAddress"
                          placeholder="Enter Solana mint address (e.g., UGoRwdj9SK78V6Pq9YMz9BvmNuJTLNqPZyS5WnGd8uW)"
                          value={newTokenMintAddress}
                          onChange={(e) => setNewTokenMintAddress(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleLookupToken()}
                          className="font-mono text-sm"
                        />
                        <Button
                          variant="outline"
                          onClick={handleLookupToken}
                          disabled={isLookingUp || !newTokenMintAddress.trim()}
                        >
                          {isLookingUp ? (
                            <Activity className="h-4 w-4 animate-spin" />
                          ) : (
                            <Zap className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      {lookupError && (
                        <p className="text-sm text-red-400">{lookupError}</p>
                      )}
                    </div>
                    
                    {/* Token Info Preview */}
                    {lookupResult && (
                      <Card className="border-primary/20 bg-primary/5">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-lg flex items-center gap-2">
                            <span className="text-primary">{lookupResult.symbol}</span>
                            <span className="text-muted-foreground font-normal">{lookupResult.name}</span>
                          </CardTitle>
                          <CardDescription>Token details from DexScreener</CardDescription>
                        </CardHeader>
                        <CardContent className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">Price:</span>
                            <span className="ml-2 font-mono text-white">{formatPrice(lookupResult.priceUsd)}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">24h Volume:</span>
                            <span className="ml-2 font-mono text-white">{formatVolume(lookupResult.volume24h)}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">24h Change:</span>
                            <span className={`ml-2 font-mono ${lookupResult.priceChange24h && lookupResult.priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {lookupResult.priceChange24h ? `${lookupResult.priceChange24h >= 0 ? '+' : ''}${lookupResult.priceChange24h.toFixed(2)}%` : '-'}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Decimals:</span>
                            <span className="ml-2 font-mono text-white">{lookupResult.decimals || '-'}</span>
                          </div>
                          {lookupResult.liquidity && (
                            <div className="col-span-2">
                              <span className="text-muted-foreground">Liquidity:</span>
                              <span className="ml-2 font-mono text-white">{formatVolume(lookupResult.liquidity)}</span>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )}
                  </div>
                  
                  <DialogFooter>
                    <Button variant="outline" onClick={() => {
                      setIsAddTokenDialogOpen(false);
                      setNewTokenMintAddress("");
                      setLookupResult(null);
                      setLookupError(null);
                    }}>
                      Cancel
                    </Button>
                    <Button
                      onClick={handleAddToken}
                      disabled={!lookupResult || isLookingUp}
                    >
                      <Plus className="mr-2 h-4 w-4" /> Add to Whitelist
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          ) : activeTab === "strategies" ? (
            // STRATEGIEN MANAGEMENT VIEW
            <div className="space-y-6 animate-in fade-in duration-300 max-w-7xl mx-auto">
              {/* Einheitlicher Header */}
              <div className="flex items-center gap-3 mb-6">
                <Puzzle className="h-8 w-8 text-primary" />
                <div>
                  <h1 className="text-3xl font-bold tracking-tighter">Strategien</h1>
                  <p className="text-muted-foreground mt-1">Strategy Management — Templates, eigene Strategien, JSON-Editor</p>
                </div>
              </div>

              {/* Sub-Tab Bar */}
              <div className="flex gap-1 bg-zinc-900/60 border border-white/10 rounded-lg p-1 w-fit">
                {(["templates", "saved", "editor"] as const).map(tab => (
                  <button key={tab} onClick={() => setStrategySubTab(tab)}
                    className={`px-4 py-1.5 rounded text-xs font-semibold transition-colors ${strategySubTab === tab ? "bg-primary text-black" : "text-zinc-400 hover:text-white"}`}>
                    {tab === "templates" ? "Templates" : tab === "saved" ? "Gespeichert" : "Neu erstellen"}
                  </button>
                ))}
              </div>

              {strategySubTab === "templates" && (
                <div className="space-y-4">
                  {/* Filter chips */}
                  <div className="flex flex-wrap gap-2">
                    {["all", "scalping", "trend", "mean_reversion", "breakout", "momentum", "dca", "grid"].map(f => (
                      <button key={f} onClick={() => setStrategyFilter(f)}
                        className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors ${strategyFilter === f ? "bg-primary/20 border-primary text-primary" : "border-zinc-700 text-zinc-400 hover:border-zinc-500"}`}>
                        {f === "all" ? "Alle" : f}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {strategyTemplates
                      .filter(t => strategyFilter === "all" || t.strategy_type === strategyFilter)
                      .map(t => (
                        <Card key={t.id} className="border-white/10 bg-zinc-900/60">
                          <CardContent className="p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-bold text-white">{t.strategy_name}</span>
                              <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border ${getStrategyColor(t.strategy_type)}`}>
                                {getStrategyIcon(t.strategy_type, "h-2.5 w-2.5")}
                                {t.strategy_type}
                              </span>
                            </div>
                            {t.description && <p className="text-[11px] text-zinc-500">{t.description}</p>}
                            <div className="flex flex-wrap gap-1">
                              {t.indicators?.map((ind) => (
                                <span key={`${ind.type}_${ind.period ?? ''}`} className="text-[10px] bg-zinc-800 text-zinc-400 border border-zinc-700 px-1.5 py-0.5 rounded font-mono">
                                  {ind.type}{ind.period ? `(${ind.period})` : ""}
                                </span>
                              ))}
                            </div>
                            <div className="flex items-center justify-between pt-1 border-t border-white/5">
                              <p className="text-[10px] text-zinc-600">Zuweisung beim Bot-Erstellen</p>
                              <button
                                className="text-[11px] px-3 py-1 rounded bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 font-semibold transition-colors"
                                onClick={() => {
                                  const full = t as Record<string, unknown>;
                                  const skip = new Set(['id', 'isTemplate', 'createdAt', 'system_prompt']);
                                  const rest = Object.fromEntries(Object.entries(full).filter(([k]) => !skip.has(k)));
                                  setStrategyEditorJson(JSON.stringify(rest, null, 2));
                                  setStrategyEditorSystemPrompt((full.system_prompt as string) ?? '');
                                  setStrategyEditorError('');
                                  setStrategyEditorValid(false);
                                  setStrategySubTab('editor');
                                }}
                              >Als Basis verwenden →</button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                  </div>
                </div>
              )}

              {strategySubTab === "saved" && (
                <div className="space-y-4">
                  {savedStrategies.filter(s => !s.isTemplate).length === 0 ? (
                    <div className="text-center py-12 text-zinc-500 text-sm">
                      Noch keine eigenen Strategien gespeichert.<br />
                      <button onClick={() => setStrategySubTab("editor")} className="mt-2 text-primary hover:underline text-xs">Jetzt eine erstellen →</button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {savedStrategies.filter(s => !s.isTemplate).map(s => (
                        <Card key={s.id} className="border-white/10 bg-zinc-900/60">
                          <CardContent className="p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-bold text-white">{s.strategy_name}</span>
                              <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border ${getStrategyColor(s.strategy_type)}`}>
                                {getStrategyIcon(s.strategy_type, "h-2.5 w-2.5")}
                                {s.strategy_type}
                              </span>
                            </div>
                            <div className="flex gap-2 mt-2">
                              <button
                                className="text-[11px] px-3 py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700"
                                onClick={() => {
                                  setStrategyEditorJson(JSON.stringify(s, null, 2));
                                  setStrategySubTab("editor");
                                }}
                              >Bearbeiten</button>
                              <button
                                className="text-[11px] px-3 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30"
                                onClick={() => {
                                  fetch(`${getApiBase()}/api/strategies/${s.id}`, { method: "DELETE" })
                                    .then(() => setSavedStrategies(prev => prev.filter(x => x.id !== s.id)));
                                }}
                              >Löschen</button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {strategySubTab === "editor" && (
                <div className="space-y-4 max-w-2xl">
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase text-zinc-400">Strategie JSON</Label>
                    <p className="text-[11px] text-zinc-500">Definiere eine Strategie im JSON-Format. Pflichtfelder: strategy_name, strategy_type, market, indicators, entry_conditions, exit_conditions, risk_management, execution.</p>
                    <textarea
                      rows={20}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs font-mono text-zinc-200 focus:outline-none focus:border-primary/50 resize-none"
                      placeholder={`{\n  "strategy_name": "Meine Strategie",\n  "strategy_type": "trend",\n  "market": { "symbol": "UGOR/SOL", "timeframe": "5m", "exchange": "solana" },\n  "indicators": [{ "type": "EMA", "period": 20 }, { "type": "EMA", "period": 50 }],\n  "entry_conditions": [{ "left": "EMA_20", "operator": ">", "right": "EMA_50" }],\n  "exit_conditions": [{ "type": "take_profit", "value": 0.05 }, { "type": "stop_loss", "value": 0.02 }],\n  "risk_management": { "position_size": 0.1, "max_positions": 1, "leverage": 1 },\n  "execution": { "order_type": "market", "slippage_tolerance": 0.001 }\n}`}
                      value={strategyEditorJson}
                      onChange={(e) => {
                        setStrategyEditorJson(e.target.value);
                        setStrategyEditorError("");
                        setStrategyEditorValid(false);
                      }}
                    />
                    {strategyEditorError && <p className="text-[11px] text-red-400">{strategyEditorError}</p>}
                    {strategyEditorValid && <p className="text-[11px] text-emerald-400">✓ JSON valid</p>}
                  </div>

                  {/* Optional: Custom System Prompt for this strategy */}
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase text-zinc-400">System Prompt (optional)</Label>
                    <p className="text-[11px] text-zinc-500">
                      Benutzerdefinierter Ollama-System-Prompt für diese Strategie. Leer lassen = auto-generiert aus Strategie-Typ.
                    </p>
                    <textarea
                      rows={6}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs font-mono text-zinc-200 focus:outline-none focus:border-primary/50 resize-y"
                      placeholder={`Du bist ein Trading-Agent für die ${"{strategy_type}"}-Strategie...\n\nDeine Aufgabe: ...`}
                      value={strategyEditorSystemPrompt}
                      onChange={e => setStrategyEditorSystemPrompt(e.target.value)}
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      className="px-4 py-2 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700 text-xs font-semibold"
                      onClick={() => {
                        try {
                          JSON.parse(strategyEditorJson);
                          setStrategyEditorValid(true);
                          setStrategyEditorError("");
                        } catch (e: unknown) {
                          setStrategyEditorError("JSON Fehler: " + (e instanceof Error ? e.message : String(e)));
                          setStrategyEditorValid(false);
                        }
                      }}
                    >Validieren</button>
                    <button
                      disabled={strategySaveStatus === "saving"}
                      className="px-4 py-2 rounded bg-primary text-black hover:bg-primary/80 text-xs font-bold disabled:opacity-50"
                      onClick={async () => {
                        try {
                          const parsed = JSON.parse(strategyEditorJson);
                          if (strategyEditorSystemPrompt.trim()) {
                            parsed.system_prompt = strategyEditorSystemPrompt.trim();
                          }
                          setStrategySaveStatus("saving");
                          const res = await fetch(`${getApiBase()}/api/strategies`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(parsed),
                          });
                          if (!res.ok) throw new Error(await res.text());
                          setStrategySaveStatus("saved");
                          setStrategyEditorJson("");
                          setStrategyEditorSystemPrompt("");
                          fetch(`${getApiBase()}/api/strategies`)
                            .then(r => r.json()).then(d => { if (Array.isArray(d)) setSavedStrategies(d); });
                          setTimeout(() => setStrategySaveStatus("idle"), 2000);
                        } catch (e: unknown) {
                          setStrategyEditorError(e instanceof Error ? e.message : String(e));
                          setStrategySaveStatus("error");
                          setTimeout(() => setStrategySaveStatus("idle"), 3000);
                        }
                      }}
                    >
                      {strategySaveStatus === "saving" ? "Speichern..." : strategySaveStatus === "saved" ? "✓ Gespeichert" : "Strategie speichern"}
                    </button>
                  </div>
                </div>
              )}

            </div>

          ) : activeTab === "agent" ? (
            // STRATEGY ASSISTANT (KI AGENT) VIEW
            <div className="space-y-6 max-w-7xl mx-auto">
              {/* Einheitlicher Header */}
              <div className="flex items-center gap-3 mb-6">
                <BrainCircuit className="h-8 w-8 text-primary" />
                <div>
                  <h1 className="text-3xl font-bold tracking-tighter">Strategy Assistant</h1>
                  <p className="text-muted-foreground mt-1">
                    Lokaler LLM-Agent (Ollama) analysiert den Markt zyklisch und passt Pattern Detection Settings dynamisch an.
                  </p>
                </div>
              </div>

              {/* Status Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Status</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className={`text-2xl font-bold ${agentStatus?.running ? 'text-green-500' : 'text-red-500'}`}>
                      {agentStatus?.running ? '● Laufend' : '○ Gestoppt'}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Modell</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-purple-400">
                      {agentStatus?.model || agentConfig?.model || '--'}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Regime</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-cyan-400">
                      {agentStatus?.regime || '--'}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Analysen</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {agentHistory.length}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Control Buttons */}
              <div className="flex gap-3">
                <Button
                  variant="default"
                  className="bg-green-600 hover:bg-green-700"
                  onClick={startAgent}
                  disabled={agentStatus?.running}
                >
                  <Play className="mr-2 h-4 w-4" /> Agent Starten
                </Button>
                <Button
                  variant="destructive"
                  onClick={stopAgent}
                  disabled={!agentStatus?.running}
                >
                  <Square className="mr-2 h-4 w-4" /> Stoppen
                </Button>
                <Button
                  variant="secondary"
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                  onClick={triggerAgentAnalysis}
                >
                  <Zap className="mr-2 h-4 w-4" /> Jetzt Analysieren
                </Button>
                {configStatus && (
                  <span className="text-sm text-muted-foreground self-center">{configStatus}</span>
                )}
              </div>

              {/* Configuration Section */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Settings className="h-5 w-5" /> Konfiguration
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Provider</label>
                      <select
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={agentConfig?.provider || 'ollama'}
                        onChange={(e) => agentConfig && updateAgentConfig({ ...agentConfig, provider: e.target.value as any })}
                      >
                        <option value="ollama">Ollama (Lokal / API)</option>
                        <option value="opencode">Opencode (Lokal / CLI)</option>
                      </select>
                    </div>

                    {/* Model Selection */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">LLM Modell</label>
                      <div className="flex gap-2">
                        <select
                          id="agentModel"
                          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
                          value={agentConfig?.model || ''}
                          disabled={agentConfig?.provider === 'opencode'}
                          onChange={(e) => agentConfig && updateAgentConfig({ ...agentConfig, model: e.target.value })}
                        >
                          {agentConfig?.provider === 'opencode' ? (
                            <option value="">Lokal Konfiguriertes Modell (Opencode)</option>
                          ) : agentModels.length === 0 ? (
                            <option value="">Lade Modelle...</option>
                          ) : (
                            agentModels.map((m) => (
                              <option key={m} value={m}>{m}</option>
                            ))
                          )}
                        </select>
                        <Button variant="outline" size="sm" onClick={loadAgentModels} disabled={agentConfig?.provider === 'opencode'}>
                          &#8635;
                        </Button>
                      </div>
                    </div>

                    {/* Cycle Minutes */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Zyklus (Minuten)</label>
                      <input
                        type="number"
                        min="1"
                        max="120"
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={agentConfig?.cycleMinutes || 21}
                        onChange={(e) => agentConfig && updateAgentConfig({ ...agentConfig, cycleMinutes: parseInt(e.target.value) })}
                      />
                      <p className="text-xs text-muted-foreground">Wie oft analysiert wird</p>
                    </div>

                    {/* Temperature */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Temperature: {agentConfig ? (agentConfig.temperature / 100).toFixed(2) : '0.30'}</label>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        className="w-full"
                        value={agentConfig?.temperature || 30}
                        onChange={(e) => agentConfig && updateAgentConfig({ ...agentConfig, temperature: parseInt(e.target.value) })}
                      />
                    </div>

                    {/* Max Tokens */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Max Tokens</label>
                      <input
                        type="number"
                        min="128"
                        max="2048"
                        step="64"
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={agentConfig?.maxTokens || 512}
                        onChange={(e) => agentConfig && updateAgentConfig({ ...agentConfig, maxTokens: parseInt(e.target.value) })}
                      />
                    </div>

                    {/* Min Confidence */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Min. Confidence: {agentConfig ? (agentConfig.minConfidence / 100).toFixed(2) : '0.40'}</label>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        className="w-full"
                        value={agentConfig?.minConfidence || 40}
                        onChange={(e) => agentConfig && updateAgentConfig({ ...agentConfig, minConfidence: parseInt(e.target.value) })}
                      />
                    </div>

                    {/* Auto Apply */}
                    <div className="flex items-center gap-2 pt-6">
                      <input
                        type="checkbox"
                        id="agentAutoApply"
                        checked={agentConfig?.autoApply ?? true}
                        onChange={(e) => agentConfig && updateAgentConfig({ ...agentConfig, autoApply: e.target.checked })}
                        className="h-4 w-4"
                      />
                      <label htmlFor="agentAutoApply" className="text-sm">
                        Auto-Apply <span className="text-muted-foreground">(Settings automatisch anwenden)</span>
                      </label>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* System Prompt (merged: per-bot manager) */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BrainCircuit className="h-5 w-5" /> System Prompt
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Bot-spezifischer Prompt für das LLM. Priorität: Eigener Prompt → Strategie-Prompt → Auto-generiert aus Strategie-Typ. Marktdaten werden automatisch angehängt.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Bot Picker */}
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={assistentBotId}
                    onChange={e => { setAssistentBotId(e.target.value); setAssistentEditMode(false); }}
                  >
                    <option value="">— Bot auswählen —</option>
                    {bots.map(b => (
                      <option key={b.id} value={b.id}>{b.name} ({b.strategyType ?? 'scalping'})</option>
                    ))}
                  </select>

                  {!assistentBotId && (
                    <p className="text-sm text-muted-foreground text-center py-4">Wähle einen Bot um seinen System Prompt zu verwalten.</p>
                  )}

                  {assistentBotId && !assistentPromptInfo && (
                    <p className="text-sm text-muted-foreground">Lade...</p>
                  )}

                  {assistentBotId && assistentPromptInfo && (
                    <div className="space-y-3">
                      {/* Strategy info row */}
                      {(assistentPromptInfo.strategyName || assistentPromptInfo.strategyType) && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/30 border text-xs flex-wrap">
                          <span className="text-muted-foreground">Strategie:</span>
                          {assistentPromptInfo.strategyType && (
                            <span className={`flex items-center gap-1 font-bold px-1.5 py-0.5 rounded border ${getStrategyColor(assistentPromptInfo.strategyType)}`}>
                              {getStrategyIcon(assistentPromptInfo.strategyType, "h-3 w-3")}
                              {assistentPromptInfo.strategyType}
                            </span>
                          )}
                          {assistentPromptInfo.strategyName && (
                            <span className="text-foreground font-medium">{assistentPromptInfo.strategyName}</span>
                          )}
                        </div>
                      )}

                      {/* Source + Actions Row */}
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-xs text-muted-foreground">Aktive Quelle:</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                          assistentPromptInfo.source === 'custom'   ? 'bg-purple-500/20 text-purple-300 border-purple-500/30' :
                          assistentPromptInfo.source === 'strategy' ? 'bg-blue-500/20 text-blue-300 border-blue-500/30' :
                          'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'
                        }`}>
                          {assistentPromptInfo.source === 'custom'   ? '✎ Eigener Prompt' :
                           assistentPromptInfo.source === 'strategy' ? '📋 Strategie-Prompt' :
                           '⚡ Auto-generiert'}
                        </span>
                        {assistentPromptInfo.source === 'custom' && (
                          <button
                            className="text-xs text-muted-foreground hover:text-red-400 underline ml-auto"
                            onClick={async () => {
                              await fetch(`${getApiBase()}/api/bots/${assistentBotId}/system-prompt`, {
                                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ systemPrompt: null }),
                              });
                              const d = await fetch(`${getApiBase()}/api/bots/${assistentBotId}/system-prompt`).then(r => r.json());
                              setAssistentPromptInfo(d);
                              setAssistentEditMode(false);
                            }}
                          >Delete Custom Prompt</button>
                        )}
                      </div>

                      {/* View mode */}
                      {!assistentEditMode ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Effektiver Prompt</span>
                            <Button variant="outline" size="sm"
                              onClick={() => {
                                setAssistentEditValue(assistentPromptInfo.customPrompt ?? assistentPromptInfo.strategyPrompt ?? assistentPromptInfo.autoPrompt);
                                setAssistentEditMode(true);
                              }}
                            >✎ Anpassen</Button>
                          </div>
                          <pre className="w-full rounded-md border bg-muted/30 px-3 py-3 text-xs font-mono text-muted-foreground whitespace-pre-wrap overflow-auto max-h-72">
                            {assistentPromptInfo.effectivePrompt}
                          </pre>
                          {assistentPromptInfo.source !== 'auto' && (
                            <details>
                              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">Auto-generierter Default anzeigen</summary>
                              <pre className="mt-2 w-full rounded-md border bg-muted/20 px-3 py-3 text-xs font-mono text-muted-foreground/60 whitespace-pre-wrap overflow-auto max-h-48">
                                {assistentPromptInfo.autoPrompt}
                              </pre>
                            </details>
                          )}
                        </div>
                      ) : (
                        /* Edit mode */
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Prompt bearbeiten</span>
                            <button
                              className="text-xs text-muted-foreground hover:text-amber-400 underline"
                              onClick={() => setAssistentEditValue(assistentPromptInfo.strategyPrompt ?? assistentPromptInfo.autoPrompt)}
                            >↺ Standard laden</button>
                          </div>
                          <textarea
                            rows={16}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary resize-y"
                            value={assistentEditValue}
                            onChange={e => setAssistentEditValue(e.target.value)}
                          />
                          <div className="flex gap-2">
                            <Button variant="outline" onClick={() => setAssistentEditMode(false)}>Abbrechen</Button>
                            <Button
                              disabled={assistentSaveStatus === "saving"}
                              onClick={async () => {
                                setAssistentSaveStatus("saving");
                                try {
                                  await fetch(`${getApiBase()}/api/bots/${assistentBotId}/system-prompt`, {
                                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ systemPrompt: assistentEditValue }),
                                  });
                                  const d = await fetch(`${getApiBase()}/api/bots/${assistentBotId}/system-prompt`).then(r => r.json());
                                  setAssistentPromptInfo(d);
                                  setAssistentEditMode(false);
                                  setAssistentSaveStatus("saved");
                                  setTimeout(() => setAssistentSaveStatus("idle"), 2000);
                                } catch {
                                  setAssistentSaveStatus("error");
                                  setTimeout(() => setAssistentSaveStatus("idle"), 2000);
                                }
                              }}
                            >
                              {assistentSaveStatus === "saving" ? "Speichern..." : assistentSaveStatus === "saved" ? "✓ Gespeichert" : "Speichern"}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Regime Performance Table */}
              {regimePerformance.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Regime Performance (historical)</CardTitle>
                    <CardDescription className="text-xs">Trade results by active market regime at time of AI analysis</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Regime</TableHead>
                          <TableHead className="text-xs text-right">Win-Rate</TableHead>
                          <TableHead className="text-xs text-right">Ø PnL</TableHead>
                          <TableHead className="text-xs text-right">Trades</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {regimePerformance.map((r) => {
                          const regimeColor = r.regime === "RANGING" ? "text-blue-400" : r.regime === "TRENDING" ? "text-emerald-400" : r.regime === "VOLATILE" ? "text-amber-400" : "text-zinc-400";
                          return (
                            <TableRow key={r.regime}>
                              <TableCell><span className={`text-xs font-bold ${regimeColor}`}>{r.regime}</span></TableCell>
                              <TableCell className="text-right text-xs">
                                <span className={r.winRate >= 60 ? "text-emerald-400" : r.winRate >= 45 ? "text-yellow-400" : "text-red-400"}>
                                  {r.winRate}%
                                </span>
                              </TableCell>
                              <TableCell className="text-right text-xs font-mono">
                                <span className={r.avgPnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                                  {r.avgPnl >= 0 ? "+" : ""}{r.avgPnl.toFixed(3)}%
                                </span>
                              </TableCell>
                              <TableCell className="text-right text-xs text-zinc-400">{r.totalTrades}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {/* History Section */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>Analyse-Historie</span>
                    <select
                      className="rounded-md border border-input bg-background px-3 py-1 text-sm"
                      value={selectedHistoryBot}
                      onChange={(e) => setSelectedHistoryBot(e.target.value)}
                    >
                      <option value="all">Alle Bots</option>
                      {bots.map((bot) => (
                        <option key={bot.id} value={bot.id}>{bot.name}</option>
                      ))}
                    </select>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="max-h-96 overflow-y-auto space-y-3">
                    {agentHistory.length === 0 ? (
                      <p className="text-muted-foreground text-center py-8">
                        Noch keine Analysen vorhanden
                      </p>
                    ) : (
                      agentHistory.map((entry, idx) => (
                        <div
                          key={idx}
                          className="rounded-lg border bg-card p-4 space-y-2"
                        >
                          <div className="flex justify-between items-start">
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-1 rounded text-xs font-bold ${
                                entry.regime === 'RANGING' ? 'bg-blue-500/20 text-blue-400' :
                                entry.regime === 'TRENDING' ? 'bg-green-500/20 text-green-400' :
                                entry.regime === 'DEAD' ? 'bg-gray-500/20 text-gray-400' :
                                'bg-orange-500/20 text-orange-400'
                              }`}>
                                {entry.regime}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                Bot: {entry.botId?.substring(0, 8)}...
                              </span>
                            </div>
                            <div className="flex items-center gap-3 flex-wrap">
                              <span className="text-xs text-muted-foreground">
                                {new Date(entry.timestamp).toLocaleString()}
                              </span>
                              <span className={`text-xs font-bold ${
                                ((entry.confidence ?? 0) * 100) >= 70 ? 'text-green-500' :
                                ((entry.confidence ?? 0) * 100) >= 40 ? 'text-yellow-500' : 'text-red-500'
                              }`}>
                                {((entry.confidence ?? 0) * 100).toFixed(0)}% Conf.
                              </span>
                              {entry.aggressivenessAdvice !== undefined && entry.aggressivenessAdvice !== null && (
                                <span className="text-xs font-mono bg-purple-500/10 text-purple-300 border border-purple-500/30 px-1.5 py-0.5 rounded">
                                  AI Aggr: {entry.aggressivenessAdvice}%
                                </span>
                              )}
                              {entry.outcomeTradeCount !== undefined && entry.outcomeTradeCount > 0 && (
                                <span className={`text-xs font-mono px-1.5 py-0.5 rounded border ${
                                  entry.outcomeTotalPnl !== undefined && entry.outcomeTotalPnl / entry.outcomeTradeCount >= 0
                                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                                    : 'bg-red-500/10 text-red-300 border-red-500/30'
                                }`}>
                                  {entry.outcomeTradeCount}T · {entry.outcomeTotalPnl !== undefined ? (entry.outcomeTotalPnl / entry.outcomeTradeCount >= 0 ? '+' : '') + (entry.outcomeTotalPnl / entry.outcomeTradeCount).toFixed(3) + '%' : '–'}
                                </span>
                              )}
                            </div>
                          </div>
                          <p className="text-sm text-muted-foreground">{entry.reason}</p>
                          {entry.analysis && (
                            <p className="text-sm italic text-muted-foreground border-l-2 border-primary/50 pl-3">
                              {entry.analysis}
                            </p>
                          )}
                          {entry.adjustedSettings && (
                            <pre className="text-xs bg-black/50 p-2 rounded overflow-x-auto">
                              {JSON.stringify(entry.adjustedSettings, null, 2)}
                            </pre>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : activeTab === "docs" ? (
            // DOCS VIEW
            <Documentation />
          ) : activeTab === "settings" ? (
            <GlobalSettings theme={theme} onThemeChange={setTheme} onSaved={(s) => setGlobalSettings((prev) => ({ ...prev, ...s }))} />
          ) : null}
        </div>
      </main>

      {/* Reset Bot Dialog */}
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className={`h-5 w-5 ${isResetting ? 'animate-spin' : ''}`} />
              Bot zurücksetzen
            </DialogTitle>
            <DialogDescription>
              Wähle die Optionen zum Zurücksetzen des Bots. Diese Aktion kann nicht rückgängig gemacht werden.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between">
              <label htmlFor="clearTrades" className="text-sm font-medium">
                Clear Trades
                <p className="text-xs text-muted-foreground">Clears the entire trade history</p>
              </label>
              <input
                id="clearTrades"
                type="checkbox"
                checked={resetOptions.clearTrades}
                onChange={(e) => setResetOptions({ ...resetOptions, clearTrades: e.target.checked })}
                className="h-4 w-4 rounded border-input"
              />
            </div>
            
            <div className="flex items-center justify-between">
              <label htmlFor="clearPrices" className="text-sm font-medium">
                Clear Price Data
                <p className="text-xs text-muted-foreground">Clears saved price data from SQLite</p>
              </label>
              <input
                id="clearPrices"
                type="checkbox"
                checked={resetOptions.clearPrices}
                onChange={(e) => setResetOptions({ ...resetOptions, clearPrices: e.target.checked })}
                className="h-4 w-4 rounded border-input"
              />
            </div>
            
            <div className="flex items-center justify-between">
              <label htmlFor="resetSettings" className="text-sm font-medium">
                Reset Settings
                <p className="text-xs text-muted-foreground">Resets pattern settings to default values</p>
              </label>
              <input
                id="resetSettings"
                type="checkbox"
                checked={resetOptions.resetSettings}
                onChange={(e) => setResetOptions({ ...resetOptions, resetSettings: e.target.checked })}
                className="h-4 w-4 rounded border-input"
              />
            </div>
            
            <div className="flex items-center justify-between">
              <label htmlFor="restartBot" className="text-sm font-medium">
                Restart Bot
                <p className="text-xs text-muted-foreground">Restarts the bot after reset</p>
              </label>
              <input
                id="restartBot"
                type="checkbox"
                checked={resetOptions.restartBot}
                onChange={(e) => setResetOptions({ ...resetOptions, restartBot: e.target.checked })}
                className="h-4 w-4 rounded border-input"
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setResetDialogOpen(false)}
              disabled={isResetting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => resetBotId && handleBotReset(resetBotId, resetOptions)}
              disabled={isResetting}
            >
              {isResetting ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Resetting...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Reset
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </>
  );
}
