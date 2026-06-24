import { useState, useEffect, useRef, useCallback } from "react";
import gsap from "gsap";
import { CSSPlugin } from "gsap/CSSPlugin";
gsap.registerPlugin(CSSPlugin);
import {
  loadAnimationConfig,
  type AnimationConfig,
} from "@/lib/animationConfig";
import { configureGSAP } from "@/lib/gsapConfig";
import { useAnimationVisibility } from "@/hooks/useAnimationVisibility";
import { useAtTop } from "@/hooks/useAtTop";
import { useLocalStorage } from "@/hooks/useLocalStorage";
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
  Bot,
  Zap,
  Trash2,
  SlidersHorizontal,
  FlaskConical,
  Flame,
  Loader2,
  TrendingUp,
  TrendingDown,
  LineChart as LineChartIcon,
  Info,
  ArrowDown,
  Puzzle,
  Check,
  Wand2,
  Wallet,
} from "lucide-react";
import { EquityCurveChart } from "@/components/performance/EquityCurveChart";
import { PriceChart } from "@/components/performance/PriceChart";
import Documentation from "@/components/Documentation";
import GlobalSettings from "@/components/GlobalSettings";
import { SelfCorrectionInsightsTab } from "@/components/tabs/SelfCorrectionInsightsTab";
import { AdvisorTab, type AdvisorSuggestion, type AdvisorScalpingSettings } from "@/components/tabs/AdvisorTab";
import { LogFeedList } from "@/components/LogFeedList";
import type { LogFeedRowData, BadgeVariant } from "@/components/LogFeedList";
import { useConfirm } from "@/components/ConfirmDialog";
import { StatCard } from "@/components/StatCard";
import { LiveClusterPricePanel } from "@/components/LiveClusterPricePanel";
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
import { getStrategyIcon, getStrategyColor, getStrategyDescription } from "@/lib/botUtils";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SubTabs } from "@/components/ui/sub-tabs";
import { CreateBotDialog } from "@/components/CreateBotDialog";
import { OracleAnalysisDialog } from "@/components/OracleAnalysisDialog";
import { BotChipGrid } from "@/components/BotChipGrid";
import { BackgroundPulse } from "@/components/BackgroundPulse";
import { GlobalBotStatsBar } from "@/components/GlobalBotStatsBar";
import { PerformanceSection } from "@/components/PerformanceSection";
import { WalletPage } from "@/components/wallet/WalletPage";
import { formatUptime } from "@/lib/botUtils";
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
  takeProfitThreshold?: number;
  startDelayTicks?: number;
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
  balanceToken: number;
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
  applied?: boolean;
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

export type AgentHistoryEntry = {
  botId: string;
  timestamp: number;
  regime?: string;
  confidence?: number;
  reason?: string;
  analysis?: string;
  adjustedSettings?: BotSettings | string;
  applied?: boolean | number;
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
  entry_conditions: Array<{ left: string; operator: string; right: string | number; type?: string; threshold?: number }>;
  exit_conditions: Array<{ type: string; value?: number; trailing_pct?: number; condition?: { left: string; operator: string; right: string | number } }>;
  risk_management: { position_size: number; max_positions: number; leverage: number; max_drawdown?: number };
  execution: { order_type: string; slippage_tolerance: number };
  scalping_settings?: { floorWindow?: number; spikeThreshold?: number; sellDropThreshold?: number; cooldownTicks?: number; takeProfitThreshold?: number; startDelayTicks?: number };
  paet_settings?: { stl_seasonal_period?: number; stl_trend_window?: number; volatility_sigma_multiplier?: number; collapse_threshold_pct?: number; evacuation_ticks?: number; safety_coefficient_k?: number; false_alarm_penalty_omega?: number; min_history_candles?: number; acceleration_ema_period?: number; entry_mode?: 'once' | 'paet_plus'; entry_cooldown_ticks?: number };
  system_prompt?: string;
  isTemplate?: boolean;
  grid_levels?: number | string;
};

export type KillSwitchRule = {
  enabled: boolean;
  value: number;
};

export type KillSwitchConfig = {
  enabled: boolean;                 // Master-Switch
  maxDrawdown?: KillSwitchRule;             // 0.15 = 15%
  maxDailyLoss?: KillSwitchRule;            // 0.05 = 5%
  maxConsecutiveLosses?: KillSwitchRule;    // 5
  sessionTakeProfit?: KillSwitchRule;       // 0.10 = 10%
  maxTotalTrades?: KillSwitchRule;          // 100
};

export type KillSwitchRuntime = {
  config: KillSwitchConfig;
  status: 'armed' | 'tripped';
  reason?: string;
  trippedAt?: number;
  peakEquity: number;
  currentEquity: number;
  drawdownPct: number;
  sessionStartEquity: number;
  sessionPnlPct: number;
  consecutiveLosses: number;
  totalTrades: number;
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
  // priceHistory is now optional and fetched separately to reduce SSE payload size
  priceHistory?: number[];
  lastPoll?: number;
  totalTicks?: number;
  startTime?: number;
  strategyId?: string;
  strategyType?: string;
  strategyConfig?: StrategyConfig;
  warmupProgress?: number;
  killSwitch?: KillSwitchRuntime;
};

// Strategie-abhängige Standard-Kill-Switch-Konfiguration (globale Trading-Regel)
const KILL_SWITCH_DEFAULTS: Record<string, Record<string, number>> = {
  scalping:           { maxDrawdown: 0.08, maxDailyLoss: 0.04, maxConsecutiveLosses: 6, sessionTakeProfit: 0.06, maxTotalTrades: 200 },
  "scalping-adaptive": { maxDrawdown: 0.08, maxDailyLoss: 0.04, maxConsecutiveLosses: 6, sessionTakeProfit: 0.06, maxTotalTrades: 200 },
  trend:              { maxDrawdown: 0.15, maxDailyLoss: 0.06, maxConsecutiveLosses: 5, sessionTakeProfit: 0.12, maxTotalTrades: 150 },
  mean_reversion: { maxDrawdown: 0.10, maxDailyLoss: 0.04, maxConsecutiveLosses: 7, sessionTakeProfit: 0.08, maxTotalTrades: 200 },
  breakout:       { maxDrawdown: 0.18, maxDailyLoss: 0.08, maxConsecutiveLosses: 4, sessionTakeProfit: 0.15, maxTotalTrades: 120 },
  momentum:       { maxDrawdown: 0.20, maxDailyLoss: 0.08, maxConsecutiveLosses: 4, sessionTakeProfit: 0.18, maxTotalTrades: 120 },
  dca:            { maxDrawdown: 0.25, maxDailyLoss: 0.10, maxConsecutiveLosses: 8, sessionTakeProfit: 0.20, maxTotalTrades: 100 },
  grid:           { maxDrawdown: 0.12, maxDailyLoss: 0.05, maxConsecutiveLosses: 6, sessionTakeProfit: 0.10, maxTotalTrades: 300 },
  ml:             { maxDrawdown: 0.12, maxDailyLoss: 0.05, maxConsecutiveLosses: 5, sessionTakeProfit: 0.10, maxTotalTrades: 150 },
};

function defaultKillSwitchConfig(strategyType?: string): KillSwitchConfig {
  const base = KILL_SWITCH_DEFAULTS[strategyType ?? 'scalping'] ?? KILL_SWITCH_DEFAULTS.scalping;
  return {
    enabled: false,
    maxDrawdown: { enabled: true, value: base.maxDrawdown },
    maxDailyLoss: { enabled: true, value: base.maxDailyLoss },
    maxConsecutiveLosses: { enabled: true, value: base.maxConsecutiveLosses },
    sessionTakeProfit: { enabled: true, value: base.sessionTakeProfit },
    maxTotalTrades: { enabled: true, value: base.maxTotalTrades },
  };
}

export type TokenInfo = {
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
  localStorage.getItem('scalpatron_api_url') ?? '';

// EMA-Perioden-Konstanten für Trend-Strategie-Anzeige
const EMA_PERIOD_THRESHOLD = 30;
const DEFAULT_FAST_EMA = 20;
const DEFAULT_SLOW_EMA = 50;

const GHOST_BOTS = [
  { name: "SCALP-α", pnl: "+12.4%", trades: 38, status: "running", color: "text-green-400" },
  { name: "SOL-β", pnl: "-3.1%", trades: 14, status: "stopped", color: "text-red-400" },
  { name: "BONK-γ", pnl: "+8.7%", trades: 61, status: "running", color: "text-green-400" },
  { name: "WIF-δ", pnl: "+0.2%", trades: 5, status: "stopped", color: "text-zinc-400" },
];

function GhostBotGrid() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full max-w-2xl opacity-40 pointer-events-none select-none">
      {GHOST_BOTS.map((ghost, i) => (
        <div
          key={i}
          className="relative rounded-lg border border-white/10 bg-zinc-900/60 px-4 py-3 flex flex-col gap-2"
          style={{ animationDelay: `${i * 120}ms` }}
        >
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
              <span className={`w-2 h-2 rounded-full shrink-0 ${ghost.status === "running" ? "bg-green-500 animate-pulse shadow-[0_0_6px_#22c55e]" : "bg-muted-foreground/40"}`}></span>
              <span className="font-bold text-sm text-white/70">{ghost.name}</span>
            </div>
            <span className="text-tiny font-bold px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">{ghost.status}</span>
          </div>
          <span className={`text-xl font-black tabular-nums ${ghost.color}`}>{ghost.pnl}</span>
          <span className="text-xs-custom font-mono text-zinc-600">{ghost.trades} trades</span>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const confirm = useConfirm();
  const tooltip = useTooltip();
  
  // Initialize GSAP configuration for background tab optimization
  useEffect(() => {
    configureGSAP();
  }, []);
  
  // Hook for managing animations based on tab visibility
  useAnimationVisibility();
  const isAtTop = useAtTop();

  const [bots, setBots] = useState<BotState[]>([]);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [assistantSubTab, setAssistantSubTab] = useState<"advisor" | "assistant" | "selfcorrection">("advisor");
  const [chartTab, setChartTab] = useState<"equity" | "price">("equity");
  const [settingsInitialTab, setSettingsInitialTab] = useState<"appearance" | "trading" | "wallet" | "animation" | "danger" | undefined>(undefined);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [deletingBotId, setDeletingBotId] = useState<string | null>(null);
  const [serverStatus, setServerStatus] = useState<
    "connected" | "disconnected"
  >("disconnected");
  const [isConnecting, setIsConnecting] = useState(true);

  // Separate state for price histories to avoid memory bloat via SSE
  const [botPriceHistories, setBotPriceHistories] = useState<Record<string, number[]>>({});

  const [theme, setTheme] = useLocalStorage<"dark" | "light">("scalpatron_theme", "dark");
  const [agentAdvice, setAgentAdvice] = useState<AgentAdviceEntry[]>([]);
  const [terminalLogs, setTerminalLogs] = useState<Record<string, LogEntry[]>>({});

  // AI Settings Changes pro Bot
  const [botSettingsChanges, setBotSettingsChanges] = useState<BotSettingsChanges>({});

  // Strategy Assistant States
  const [agentStatus, setAgentStatus] = useState<{ status: string; model: string; regime: string; cycle: number; running: boolean; analyzing: boolean; lastAnalysisTime: number | null; nextAnalysisTime: number | null } | null>(null);
  const [agentConfig, setAgentConfig] = useState<AgentConfigType | null>(null);
  const [agentHistory, setAgentHistory] = useState<AgentHistoryEntry[]>([]);
  const [agentModels, setAgentModels] = useState<string[]>([]);
  const [selectedHistoryBot, setSelectedHistoryBot] = useState<string>("all");
  const [configStatus, setConfigStatus] = useState<string>("");
  const [isTriggering, setIsTriggering] = useState(false);
  const [isOracleDialogOpen, setIsOracleDialogOpen] = useState(false);
  const [regimePerformance, setRegimePerformance] = useState<RegimePerformance[]>([]);
  const [strategyTemplates, setStrategyTemplates] = useState<StrategyTemplate[]>([]);
  const [newBotStrategyId, setNewBotStrategyId] = useState<string>("");

  // Smart Advisor States (manuelle Aktualisierung — kein Auto-Fetch, persistent über Tab-Wechsel)
  const [advisorSuggestions, setAdvisorSuggestions] = useState<AdvisorSuggestion[]>([]);
  const [advisorHistory, setAdvisorHistory] = useState<AdvisorSuggestion[]>([]);
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [advisorError, setAdvisorError] = useState<string | null>(null);
  const [advisorFetchedAt, setAdvisorFetchedAt] = useState<number | null>(null);

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

  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [selectedTokenInfo, setSelectedTokenInfo] = useState<Partial<TokenInfo> | null>(null);
  const [tokenSearchText, setTokenSearchText] = useState("");
  const [tokenSort, setTokenSort] = useState<{ col: "symbol" | "name" | "price" | "volume" | "change"; dir: "asc" | "desc" }>({ col: "symbol", dir: "asc" });
  const [isRefreshingTokens, setIsRefreshingTokens] = useState(false);

  // Create Bot Dialog State
  const [newBotName, setNewBotName] = useState("");
  const [newBotMintAddress, setNewBotMintAddress] = useState("");
  const [showTokenWhitelist, setShowTokenWhitelist] = useState(false);
  const [newBotWalletAddress, setNewBotWalletAddress] = useState("");
  const [newBotTradingMode, setNewBotTradingMode] = useState<"fixed" | "aggressive">("fixed");
  const [newBotTradeSize, setNewBotTradeSize] = useState(1);
  const [newBotAggressiveness, setNewBotAggressiveness] = useState(10);
  const [newBotAutoStart, setNewBotAutoStart] = useState(true);
  const [isCreateBotDialogOpen, setIsCreateBotDialogOpen] = useState(false);
  const [pendingAdvisorToken, setPendingAdvisorToken] = useState<{ name: string; symbol: string; priceUsd?: number; volume24h?: number; liquidity?: number } | null>(null);
  // ADR-014: advisor-recommended scalping settings, forwarded to the backend as
  // the bot's `settings` payload so the created bot actually trades with the
  // values the advisor computed (instead of discarding them).
  const [pendingAdvisorSettings, setPendingAdvisorSettings] = useState<AdvisorScalpingSettings | null>(null);

  // Global Settings (cached for CreateBot dialog defaults)
  const [globalSettings, setGlobalSettings] = useState({ initialSOL: 10, tradeSize: 1, paperMode: true });

  // Inline Bot Settings Panel
  const [botSettingsPanelId, setBotSettingsPanelId] = useState<string | null>(null);
  const [botSettingsDraft, setBotSettingsDraft] = useState<{ floorWindow: number; spikeThreshold: number; sellDropThreshold: number; cooldownTicks: number; takeProfitThreshold: number; startDelayTicks: number; tradeSize: number; aggressiveness: number; tradingMode: "fixed" | "aggressive"; walletAddress: string; strategyConfigDraft: StrategyConfig | null; aggPreset: number; killSwitchDraft: KillSwitchConfig }>({ floorWindow: 20, spikeThreshold: 0.3, sellDropThreshold: 5, cooldownTicks: 5, takeProfitThreshold: 0.10, startDelayTicks: 30, tradeSize: 1, aggressiveness: 10, tradingMode: "fixed", walletAddress: "", strategyConfigDraft: null, aggPreset: 50, killSwitchDraft: defaultKillSwitchConfig() });
  const [botSettingsSaveStatus, setBotSettingsSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [tradeFlash, setTradeFlash] = useState<Record<string, "buy" | "sell" | null>>({});
  const [aiFlash, setAiFlash] = useState<Record<string, boolean>>({});
  const aiFlashTimeoutRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const prevTradeCountRef = useRef<Record<string, number>>({});
  const lastTickPulseRef = useRef<number>(0);

  // Throttling refs for SSE updates to prevent excessive re-renders
  const sseThrottleRef = useRef<Record<string, number>>({});
  const pendingBotsUpdateRef = useRef<BotState[] | null>(null);
  const botsUpdateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Performance: Batch log updates to prevent re-render floods
  const logBufferRef = useRef<Record<string, LogEntry[]>>({});
  const logFlushIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce ref for agent history loading to prevent rapid fetches
  const agentHistoryDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ref to store the bot order for SSE updates
  const botOrderRef = useRef<string[] | null>(null);

  // Reset Dialog State
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetBotId, setResetBotId] = useState<string | null>(null);
  const [resetOptions, setResetOptions] = useState({ clearTrades: true, clearPrices: false, resetSettings: false, restartBot: true });
  const [isResetting, setIsResetting] = useState(false);
  const [isAllActionLoading, setIsAllActionLoading] = useState(false);

  // Bot Info Panel State
  const [botInfoPanelId, setBotInfoPanelId] = useState<string | null>(null);

  const logEndRef = useRef<HTMLDivElement>(null);
  const tradeFlashTimeoutRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Detect new trades and trigger flash animation - optimized with ref-based comparison
  // to avoid iterating over all bots on every render
  useEffect(() => {
    let hasChanges = false;

    bots.forEach((bot) => {
      const latestTrade = bot.recentTrades?.[0];
      const currTs = latestTrade?.timestamp ?? 0;
      const prevTs = prevTradeCountRef.current[bot.id];

      if (prevTs === undefined) {
        // First SSE update: initialize without flashing
        prevTradeCountRef.current[bot.id] = currTs;
        return;
      }

      if (currTs > prevTs && latestTrade) {
        hasChanges = true;
        const flashType = latestTrade.action === "BUY" ? "buy" : "sell";
        const existingTimeout = tradeFlashTimeoutRef.current[bot.id];
        if (existingTimeout) clearTimeout(existingTimeout);

        tradeFlashTimeoutRef.current[bot.id] = setTimeout(
          () => setTradeFlash((f) => ({ ...f, [bot.id]: null })),
          1700,
        );

        setTradeFlash((f) => ({ ...f, [bot.id]: flashType }));
        prevTradeCountRef.current[bot.id] = currTs;
      }
    });

    // Only trigger re-render if there are actual changes
    if (!hasChanges) return;
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
  const [animConfig, setAnimConfig] = useState<AnimationConfig>(loadAnimationConfig());

  useEffect(() => {
    const sse = new EventSource(`${getApiBase()}/api/stream`);

    sse.onopen = () => {
      setServerStatus("connected");
      setIsConnecting(false);
    };
    // Close immediately on error — prevents the browser's built-in reconnect loop from
    // accumulating open HTTP connections and listener callbacks in memory.
    sse.onerror = () => {
      setServerStatus("disconnected");
      setIsConnecting(false);
      sse.close();
    };

    // Throttled bot state update - batches rapid SSE updates to prevent excessive re-renders
    const throttledSetBots = (data: BotState[]) => {
      const now = Date.now();
      const lastUpdate = sseThrottleRef.current['bots'] || 0;
      const minInterval = 150; // Performance: Lower throttle for faster UI feedback

      // Apply saved bot order if available
      let orderedData = data;
      if (botOrderRef.current && botOrderRef.current.length > 0) {
        const orderMap = new Map<string, number>(botOrderRef.current.map((id: string, index: number): [string, number] => [id, index]));
        orderedData = [...data].sort((a, b) => {
          const aIndex = orderMap.get(a.id) ?? Infinity;
          const bIndex = orderMap.get(b.id) ?? Infinity;
          return aIndex - bIndex;
        });
      }

      // Preserve priceHistory from current state when updating via SSE (cap at 500 to prevent unbounded growth)
      setBots(prevBots => {
        const priceHistoryMap = new Map(prevBots.map(b => [b.id, b.priceHistory || []]));
        const updatedWithHistory = orderedData.map(bot => {
          const hist = priceHistoryMap.get(bot.id) || [];
          return {
            ...bot,
            priceHistory: hist.length > 500 ? hist.slice(-500) : hist
          };
        });
        
        if (now - lastUpdate >= minInterval) {
          // Immediate update if throttle interval has passed
          sseThrottleRef.current['bots'] = now;
          return updatedWithHistory;
        } else {
          // Queue update for later batching
          pendingBotsUpdateRef.current = updatedWithHistory;
          if (botsUpdateTimeoutRef.current) return prevBots;

          botsUpdateTimeoutRef.current = setTimeout(() => {
            if (pendingBotsUpdateRef.current) {
              sseThrottleRef.current['bots'] = Date.now();
              setBots(pendingBotsUpdateRef.current);
              pendingBotsUpdateRef.current = null;
            }
            botsUpdateTimeoutRef.current = null;
          }, minInterval - (now - lastUpdate));
          return prevBots;
        }
      });
    };

    sse.addEventListener("state", (e) => {
      try {
        const data = JSON.parse(e.data);
        throttledSetBots(data);
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
              applied: data.applied ?? false,
            };
            return [newEntry, ...prev].slice(0, 100);
          });
        }

        // AI-Flash Animation triggern — immer wenn eine Analyse für einen Bot eintrifft,
        // unabhängig davon ob adjustedSettings (scalping) oder strategyAdjustments (indicator)
        if (data.botId && data.advice) {
          setAiFlash((f) => ({ ...f, [data.botId]: true }));
          // Clear any existing timeout for this bot before creating a new one
          if (aiFlashTimeoutRef.current[data.botId]) clearTimeout(aiFlashTimeoutRef.current[data.botId]);
          aiFlashTimeoutRef.current[data.botId] = setTimeout(() => {
            setAiFlash((f) => ({ ...f, [data.botId]: false }));
            delete aiFlashTimeoutRef.current[data.botId];
          }, 1500);
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
          }
        }
      } catch (err) {
        console.error("SSE Parse Error Agent", err);
      }
    });

    sse.addEventListener("agent_status", (e) => {
      try {
        const data = JSON.parse(e.data);
        setAgentStatus({
          running: data.running ?? false,
          analyzing: data.analyzing ?? false,
          model: data.config?.model ?? '-',
          cycle: data.config?.cycleMinutes ?? 0,
          regime: '-',
          status: data.running ? 'running' : 'stopped',
          lastAnalysisTime: data.lastAnalysisTime ?? null,
          nextAnalysisTime: data.nextAnalysisTime ?? null,
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

    // Tracks consecutive empty-buffer flushes to auto-stop the interval when idle
    let emptyFlushCount = 0;
    const MAX_EMPTY_FLUSHES = 3; // Stop interval after 3 empty checks (~9s idle)

    const flushLogs = () => {
      if (Object.keys(logBufferRef.current).length === 0) {
        emptyFlushCount++;
        if (emptyFlushCount >= MAX_EMPTY_FLUSHES && logFlushIntervalRef.current) {
          clearInterval(logFlushIntervalRef.current);
          logFlushIntervalRef.current = null;
        }
        return;
      }

      emptyFlushCount = 0;
      setTerminalLogs(prev => {
        const next = { ...prev };
        for (const [botId, newEntries] of Object.entries(logBufferRef.current)) {
          const existing = next[botId] || [];
          // Prepend new messages and cap at 100
          const updated = [...newEntries, ...existing].slice(0, 100);
          next[botId] = updated;
        }
        return next;
      });

      logBufferRef.current = {};
    };

    sse.addEventListener("terminal_log", (e) => {
      try {
        const entry = JSON.parse(e.data);
        if (!logBufferRef.current[entry.botId]) {
          logBufferRef.current[entry.botId] = [];
        }
        logBufferRef.current[entry.botId].unshift(entry); // Newest first
        // Cap per-bot buffer to prevent unbounded growth between flushes
        if (logBufferRef.current[entry.botId].length > 200) {
          logBufferRef.current[entry.botId].length = 200;
        }

        // Restart interval if it was stopped during an idle period
        if (!logFlushIntervalRef.current) {
          emptyFlushCount = 0;
          logFlushIntervalRef.current = setInterval(flushLogs, 3000);
        }
      } catch (err) {
        console.error("SSE Parse Error Terminal", err);
      }
    });

    return () => {
      sse.close();
      if (botsUpdateTimeoutRef.current) {
        clearTimeout(botsUpdateTimeoutRef.current);
      }
      if (logFlushIntervalRef.current) {
        clearInterval(logFlushIntervalRef.current);
        logFlushIntervalRef.current = null;
      }
      if (agentHistoryDebounceRef.current) {
        clearTimeout(agentHistoryDebounceRef.current);
        agentHistoryDebounceRef.current = null;
      }
      // Clear all pending aiFlash timeouts
      Object.values(aiFlashTimeoutRef.current).forEach(clearTimeout);
      aiFlashTimeoutRef.current = {};
    };
  }, []);

  // Initial Fetch Fallback - Load bots and their order
  useEffect(() => {
    const fetchBotsAndOrder = async () => {
      try {
        const [botsRes, orderRes] = await Promise.all([
          fetch(`${getApiBase()}/api/bots`),
          fetch(`${getApiBase()}/api/bots/order`).catch(() => null),
        ]);
        const botsData = await botsRes.json();
        const orderData = await orderRes?.json().catch(() => null);

        if (orderData?.order && Array.isArray(orderData.order)) {
          // Store order in ref for SSE updates
          botOrderRef.current = orderData.order;
          // Sortiere Bots according to saved order
          const orderMap = new Map<string, number>(orderData.order.map((id: string, index: number): [string, number] => [id, index]));
          const orderedBots = [...botsData].sort((a, b) => {
            const aIndex = orderMap.get(a.id) ?? Infinity;
            const bIndex = orderMap.get(b.id) ?? Infinity;
            return aIndex - bIndex;
          });
          setBots(orderedBots);
          console.log("[Init] Bots initial geladen mit Order:", orderedBots.length);
        } else {
          setBots(botsData);
          console.log("[Init] Bots initial geladen:", botsData.length);
        }
      } catch (err) {
        console.error("[Init] Fetch error:", err);
      }
    };
    fetchBotsAndOrder();
  }, []);

  // Load price history for each bot when bots change (memory optimization: fetch separately instead of via SSE)
  useEffect(() => {
    const fetchAllHistories = async () => {
      const histories: Record<string, number[]> = {};
      await Promise.all(
        bots.map(async (bot) => {
          try {
            const res = await fetch(`${getApiBase()}/api/bots/${bot.id}/history?limit=100`);
            const data = await res.json();
            // API returns objects { timestamp, price }, but we need number[] for charts
            histories[bot.id] = (data.history || []).map((item: { price: number }) => item.price);
          } catch (err) {
            console.error(`[Init] Price History Fetch error for bot ${bot.id}:`, err);
            histories[bot.id] = [];
          }
        })
      );
      setBotPriceHistories(histories);
      // Update bots with their price histories
      setBots(prev => prev.map(bot => ({
        ...bot,
        priceHistory: histories[bot.id] || []
      })));
      console.log("[Init] Price histories loaded for", Object.keys(histories).length, "bots");
    };
    if (bots.length > 0) {
      fetchAllHistories();
    }
  }, [bots.length]); // Only re-fetch when bot count changes

  // Periodically re-fetch price history for the selected running bot so the chart stays live.
  // priceHistory is deliberately excluded from SSE (memory optimization), so polling is the only
  // way to update the chart after the bot has been started (especially for newly created bots).
  const selectedBotStatus = bots.find(b => b.id === selectedBotId)?.status;
  useEffect(() => {
    if (!selectedBotId || selectedBotStatus !== 'running') return;

    const fetchSelectedHistory = async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/bots/${selectedBotId}/history?limit=100`);
        if (!res.ok) return;
        const data = await res.json();
        const history: number[] = (data.history || []).map((item: { price: number }) => item.price);
        // Only update botPriceHistories (targeted update) — avoids triggering a full bots.map re-render.
        setBotPriceHistories(prev => ({ ...prev, [selectedBotId]: history }));
      } catch { /* ignore */ }
    };

    fetchSelectedHistory();
    const interval = setInterval(fetchSelectedHistory, 10000);
    return () => clearInterval(interval);
  }, [selectedBotId, selectedBotStatus]);

  // Fetch Global Settings on mount
  useEffect(() => {
    fetch(`${getApiBase()}/api/settings`)
      .then((r) => r.json())
      .then((data) => setGlobalSettings((prev) => ({ ...prev, ...data })))
      .catch(() => { });
    // Fetch strategy templates on mount so Create Bot dialog has them ready
    fetch(`${getApiBase()}/api/strategies/templates`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setStrategyTemplates(d); })
      .catch(() => { });
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
      .catch(() => { });
    return () => { cancelled = true; };
  }, [selectedBotId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load Agent data when tab changes
  // Load agent data when tab opens; reload history when bot filter changes
  useEffect(() => {
    // Cleanup function to cancel pending fetches when component unmounts or dependencies change
    return () => {
      if (agentHistoryDebounceRef.current) {
        clearTimeout(agentHistoryDebounceRef.current);
        agentHistoryDebounceRef.current = null;
      }
    };
  }, []);

  // Load agent data when tab opens; reload history when bot filter changes
  useEffect(() => {
    if (activeTab === "agent") {
      loadAgentHistory(selectedHistoryBot === "all" ? undefined : selectedHistoryBot);
      loadAgentStatus();
      loadAgentModels();
      const botId = selectedHistoryBot !== "all" ? selectedHistoryBot : undefined;
      const perfUrl = botId
        ? `${getApiBase()}/api/agent/regime-performance?botId=${botId}`
        : `${getApiBase()}/api/agent/regime-performance`;
      fetch(perfUrl).then(r => r.json()).then(d => { if (Array.isArray(d)) setRegimePerformance(d); }).catch(() => { });
      fetch(`${getApiBase()}/api/strategies/templates`).then(r => r.json()).then(d => {
        if (Array.isArray(d)) setStrategyTemplates(d);
      }).catch(() => { });
    }
  }, [activeTab, selectedHistoryBot]);

  const toggleBotStatus = async (id: string, currentStatus: string) => {
    const nextStatus = currentStatus === "running" ? "stopped" : "running";
    // Optimistic update for instant feedback
    setBots(prev => prev.map(b => b.id === id ? { ...b, status: nextStatus } : b));

    await fetch(`${getApiBase()}/api/bots/${id}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
  };

  const handleToggleAll = async (targetStatus: "running" | "stopped") => {
    if (bots.length === 0) return;
    setIsAllActionLoading(true);

    // sequential visual feedback via GSAP
    const botChips = document.querySelectorAll('.bot-chip-main');
    if (botChips.length > 0) {
      const ringColor = targetStatus === "running" ? "rgba(16, 185, 129, 0.55)" : "rgba(239, 68, 68, 0.5)";
      gsap.fromTo(
        botChips,
        { boxShadow: `0 0 0 0px ${ringColor}` },
        {
          boxShadow: `0 0 0 6px ${ringColor.replace(/[\d.]+\)$/, "0)")}`,
          scale: 1.015,
          duration: 0.4,
          stagger: 0.06,
          ease: "power2.out",
          yoyo: true,
          repeat: 1,
          overwrite: "auto",
        }
      );
    }

    // Optimistic update for all bots
    setBots(prev => prev.map(b => ({ ...b, status: targetStatus })));

    try {
      // Execute in larger batches for better speed while maintaining "sequence" feel
      const batchSize = 8;
      for (let i = 0; i < bots.length; i += batchSize) {
        const batch = bots.slice(i, i + batchSize);
        await Promise.all(batch.map(bot =>
          fetch(`${getApiBase()}/api/bots/${bot.id}/status`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: targetStatus }),
          })
        ));

        // Wait slightly between batches for the staggered look
        if (i + batchSize < bots.length) {
          await new Promise(r => setTimeout(r, 40));
        }
      }

      // Very short buffer
      await new Promise(r => setTimeout(r, 50));
    } catch (err) {
      console.error("Error toggling all bots:", err);
    } finally {
      setIsAllActionLoading(false);
    }
  };

  const deleteBot = async (id: string) => {
    const target = bots.find(b => b.id === id);
    const result = await confirm({
      title: "Delete Bot",
      message: "Are you sure? All trades for this bot will also be removed.",
      confirmLabel: "Delete",
      variant: "danger",
      toggle: { label: "Delete Token", defaultChecked: false },
    });
    if (!result.confirmed) return;

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

        // Optionally also remove the underlying token from the whitelist
        if (result.toggleValue && target?.mintAddress) {
          try {
            const tokRes = await fetch(`${getApiBase()}/api/tokens/${target.mintAddress}`, {
              method: "DELETE",
            });
            if (tokRes.ok) {
              await fetchTokens();
              console.log("[Bot] Token also removed from whitelist:", target.mintAddress);
            } else {
              console.warn("[Bot] Bot deleted but token removal failed:", tokRes.status);
            }
          } catch (tokErr) {
            console.warn("[Bot] Token removal error (bot was still deleted):", tokErr);
          }
        }
      }
    } catch (err) {
      console.error("Delete Bot Error:", err);
    } finally {
      setDeletingBotId(null);
    }
  };

  const deleteAllBots = async () => {
    if (bots.length === 0) return;
    const { confirmed } = await confirm({
      title: "Delete All Bots",
      message: `Permanently delete all ${bots.length} bot${bots.length !== 1 ? "s" : ""} and their trade history?`,
      confirmLabel: "Delete All",
      variant: "danger",
    });
    if (!confirmed) return;
    await fetch(`${getApiBase()}/api/bots`, { method: "DELETE" });
    setBots([]);
    setSelectedBotId(null);
  };

  // Handle Bot Reorder from Drag and Drop
  const handleReorderBots = useCallback(async (botIds: string[]) => {
    try {
      // Update the bot order ref so SSE updates maintain the correct order
      botOrderRef.current = botIds;

      // Optimistic update: Bots werden bereits durch localStorage in BotChipGrid aktualisiert
      // Sende die neue Reihenfolge an das Backend zur Persistenz in der Datenbank
      const res = await fetch(`${getApiBase()}/api/bots/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botIds }),
      });
      if (!res.ok) {
        console.error('Failed to save bot order to backend');
      }
    } catch (err) {
      console.error('Error saving bot order:', err);
    }
  }, []);

  const openBotSettingsPanel = (bot: BotState) => {
    if (botSettingsPanelId === bot.id) {
      setBotSettingsPanelId(null);
      return;
    }
    const isScalping = !bot.strategyConfig || bot.strategyConfig.strategy_type === 'scalping' || bot.strategyConfig.strategy_type === 'scalping-adaptive';
    const isPaet = bot.strategyConfig?.strategy_type === 'paet';

    // For scalping-adaptive: the adaptive fork updates bot.settings (scalpingDetector.settings)
    // every tick based on market context, so they differ from what the user actually configured.
    // strategyConfig.scalping_settings holds the authoritative stored base values — use those
    // so the panel always shows (and saves) what the user set, not the live runtime adaptation.
    const isAdaptive = bot.strategyConfig?.strategy_type === 'scalping-adaptive';
    const baseCfg = isAdaptive ? bot.strategyConfig?.scalping_settings : undefined;

    const fw = baseCfg?.floorWindow ?? bot.settings?.floorWindow ?? 20;
    const computedPreset = isScalping
      ? Math.round(Math.max(0, Math.min(1, (35 - fw) / 30)) * 99 + 1)
      : isPaet
        ? Math.round(Math.max(0, Math.min(1, (3.0 - (bot.strategyConfig?.paet_settings?.volatility_sigma_multiplier ?? 2.0)) / 2.0)) * 99 + 1)
        : 50;
    setBotSettingsDraft({
      floorWindow:          baseCfg?.floorWindow          ?? bot.settings?.floorWindow          ?? 20,
      spikeThreshold:       baseCfg?.spikeThreshold       ?? bot.settings?.spikeThreshold       ?? 0.3,
      sellDropThreshold:    baseCfg?.sellDropThreshold    ?? bot.settings?.sellDropThreshold    ?? 5,
      cooldownTicks:        baseCfg?.cooldownTicks        ?? bot.settings?.cooldownTicks        ?? 5,
      takeProfitThreshold:  baseCfg?.takeProfitThreshold  ?? bot.settings?.takeProfitThreshold  ?? 0.10,
      startDelayTicks:      baseCfg?.startDelayTicks      ?? bot.settings?.startDelayTicks      ?? 30,
      tradeSize: bot.tradeSize ?? 1,
      aggressiveness: bot.aggressiveness ?? 10,
      tradingMode: bot.tradingMode ?? "fixed",
      walletAddress: bot.walletAddress ?? "",
      strategyConfigDraft: bot.strategyConfig ? JSON.parse(JSON.stringify(bot.strategyConfig)) : null,
      aggPreset: computedPreset,
      killSwitchDraft: bot.killSwitch?.config
        ? JSON.parse(JSON.stringify(bot.killSwitch.config))
        : defaultKillSwitchConfig(bot.strategyConfig?.strategy_type ?? bot.strategyType),
    });
    setBotSettingsPanelId(bot.id);
    setBotSettingsSaveStatus("idle");
  };

  const saveBotSettings = async (id: string) => {
    try {
      const { tradeSize, aggressiveness, tradingMode, walletAddress,
        floorWindow, spikeThreshold, sellDropThreshold, cooldownTicks, takeProfitThreshold, startDelayTicks,
        strategyConfigDraft, killSwitchDraft } = botSettingsDraft;
      const stratType = strategyConfigDraft?.strategy_type ?? 'scalping';
      const isScalpingFamily = stratType === 'scalping' || stratType === 'scalping-adaptive';

      // Always save trade config + scalping pattern settings + kill switch
      const settingsRes = await fetch(`${getApiBase()}/api/bots/${id}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tradeSize, aggressiveness, tradingMode, walletAddress,
          killSwitch: killSwitchDraft,
          ...(isScalpingFamily ? { floorWindow, spikeThreshold, sellDropThreshold, cooldownTicks, takeProfitThreshold, startDelayTicks } : {}),
        }),
      });
      if (!settingsRes.ok) throw new Error();

      // For non-scalping strategies: also push updated strategyConfig
      if (!isScalpingFamily && strategyConfigDraft) {
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

  const resetKillSwitch = async (botId: string) => {
    try {
      const res = await fetch(`${getApiBase()}/api/bots/${botId}/killswitch/reset`, { method: "POST" });
      if (!res.ok) throw new Error();
    } catch (e) {
      console.error("Kill-Switch Reset fehlgeschlagen:", e);
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
          // ADR-014: forward advisor scalping settings as the bot's `settings`.
          ...(pendingAdvisorSettings ? { settings: pendingAdvisorSettings } : {}),
          ...(pendingAdvisorToken ? {
            tokenName: pendingAdvisorToken.name,
            tokenSymbol: pendingAdvisorToken.symbol,
            tokenPriceUsd: pendingAdvisorToken.priceUsd,
            tokenVolume24h: pendingAdvisorToken.volume24h,
            tokenLiquidity: pendingAdvisorToken.liquidity,
          } : {}),
        }),
      });

      if (res.ok) {
        const newBot = await res.json();
        if (newBot && newBot.id) {
          setBots(prev => {
            if (prev.some(b => b.id === newBot.id)) return prev;
            return [...prev, newBot];
          });
          setSelectedBotId(newBot.id);
        }
        // Immediately inject known token info into tokens state (Advisor path),
        // then sync from server to cover both Advisor and manual creation paths.
        if (pendingAdvisorToken) {
          setTokens(prev => {
            const mint = newBotMintAddress.trim();
            if (prev.some(t => t.mintAddress === mint)) return prev;
            return [...prev, {
              mintAddress: mint,
              name: pendingAdvisorToken.name,
              symbol: pendingAdvisorToken.symbol,
              decimals: 6,
              priceUsd: pendingAdvisorToken.priceUsd,
              volume24h: pendingAdvisorToken.volume24h,
              liquidity: pendingAdvisorToken.liquidity,
              isActive: true,
            }];
          });
        }
        fetchTokens();
        setIsCreateBotDialogOpen(false);

        // Auto-start: wait 1s for the bot to fully register in backend, then start
        if (newBotAutoStart && newBot?.id) {
          const startId = newBot.id;
          setTimeout(() => {
            toggleBotStatus(startId, "stopped");
          }, 1000);
        }
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
    setPendingAdvisorToken(null);
    setPendingAdvisorSettings(null);
  };

  // ==================== SMART BOT ADVISOR ====================

  // ==================== SMART BOT ADVISOR FUNCTIONS ====================

  // Wird beim ersten Öffnen der Strategy Assistant Seite automatisch aufgerufen (CACHE).
  // forceRefresh=true umgeht den Server-Cache (Klick auf "Aktualisieren").
  const fetchAdvisorSuggestions = useCallback(async (forceRefresh = false) => {
    setAdvisorLoading(true);
    setAdvisorError(null);
    try {
      const url = `${getApiBase()}/api/advisor/suggestions${forceRefresh ? '?refresh=1' : ''}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAdvisorSuggestions(data.suggestions ?? []);
      setAdvisorHistory(data.history ?? []);
      setAdvisorFetchedAt(data.fetchedAt ?? Date.now());
    } catch (e) {
      setAdvisorError(e instanceof Error ? e.message : 'Unbekannter Fehler');
    } finally {
      setAdvisorLoading(false);
    }
  }, []);

  useEffect(() => { void fetchAdvisorSuggestions(false); }, [fetchAdvisorSuggestions]);

  const handleCreateFromAdvisor = (suggestion: AdvisorSuggestion) => {
    setNewBotName(`${suggestion.tokenSymbol} ${suggestion.strategyName.split(' ')[0]}`);
    setNewBotMintAddress(suggestion.mintAddress);
    setNewBotStrategyId(suggestion.templateId);
    setPendingAdvisorToken({
      name: suggestion.tokenName,
      symbol: suggestion.tokenSymbol,
      priceUsd: suggestion.priceUsd,
      volume24h: suggestion.volume24h,
      liquidity: suggestion.liquidity,
    });
    // ADR-014: forward the advisor's scalping recommendations so the created
    // bot trades with them. Only scalping strategies carry scalpingSettings.
    setPendingAdvisorSettings(suggestion.suggestedConfig?.scalpingSettings ?? null);
    setActiveTab("dashboard");
    setIsCreateBotDialogOpen(true);
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
        lastAnalysisTime: data.lastAnalysisTime ?? null,
        nextAnalysisTime: data.nextAnalysisTime ?? null,
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

  // Load Agent History with debounce to prevent rapid fetches
  const loadAgentHistory = useCallback(async (botId?: string) => {
    // Cancel pending fetch if user quickly switches bots
    if (agentHistoryDebounceRef.current) {
      clearTimeout(agentHistoryDebounceRef.current);
    }

    // Debounce: Wait 300ms before actually fetching to avoid rapid successive calls
    agentHistoryDebounceRef.current = setTimeout(async () => {
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
      } finally {
        agentHistoryDebounceRef.current = null;
      }
    }, 300);
  }, []);

  // Load agent history for the selected bot so the Bot Details "Oracle Analysis"
  // section stays populated even when the agent tab is not open. Without this,
  // the section only renders data captured via live SSE events since page load.
  useEffect(() => {
    if (!selectedBotId) return;
    loadAgentHistory(selectedBotId);
  }, [selectedBotId]);

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
      loadAgentStatus();
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
      loadAgentStatus();
    } catch (err) {
      console.error("[Agent] Stop error:", err);
      setConfigStatus("Fehler beim Stoppen");
    }
  };

  // Trigger Analysis (ADR-012: accepts optional force multiplier 0-100)
  const triggerAgentAnalysis = async (forceMultiplier?: number) => {
    setConfigStatus("Analysiere...");
    setIsTriggering(true);
    try {
      const body: { botId?: string; forceMultiplier?: number } = {};
      if (selectedBotId) body.botId = selectedBotId;
      if (typeof forceMultiplier === "number") body.forceMultiplier = forceMultiplier;
      const res = await fetch(`${getApiBase()}/api/agent/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      console.log("[Agent] Trigger response:", data);
      setConfigStatus(`Analyse gestartet! (force=${data.forceMultiplier ?? 100}%)`);
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
        .then(r => r.json()).then(d => { if (Array.isArray(d)) setStrategyTemplates(d); }).catch(() => { });
    };
    const fetchSavedStrategies = () => {
      fetch(`${getApiBase()}/api/strategies`)
        .then(r => r.json()).then(d => { if (Array.isArray(d)) setSavedStrategies(d); }).catch(() => { });
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
        .catch(() => { });
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

  const handleRefreshTokens = async () => {
    setIsRefreshingTokens(true);
    await fetchTokens();
    setIsRefreshingTokens(false);
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
    const { confirmed } = await confirm({
      title: "Token entfernen",
      message: `Token aus der Whitelist entfernen?\n${mintAddress}`,
      confirmLabel: "Entfernen",
      variant: "warning",
    });
    if (!confirmed) return;

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
  // Prefer botPriceHistories (kept fresh by the 3s poll) over selectedBot.priceHistory
  // (embedded in bots, only updated on bots.length change). Falls back gracefully.
  const selectedPriceHistory: number[] = botPriceHistories[selectedBotId ?? ''] ?? selectedBot?.priceHistory ?? [];
  const [backgroundPulseTrigger, setBackgroundPulseTrigger] = useState<"buy" | "sell" | "ai" | "tick" | false>(false);
  const prevBotPriceRef = useRef<Record<string, number>>({});

  // Reset background pulse trigger
  useEffect(() => {
    if (backgroundPulseTrigger) {
      // Ticks are faster/shorter
      const duration = backgroundPulseTrigger === "tick" ? 400 : 800;
      const timer = setTimeout(() => setBackgroundPulseTrigger(false), duration);
      return () => clearTimeout(timer);
    }
  }, [backgroundPulseTrigger]);

  // Trigger background pulse on any trade/tick flash (any bot)
  useEffect(() => {
    let hasChanges = false;
    let tickHappened = false;

    bots.forEach((bot) => {
      const latestTrade = bot.recentTrades?.[0];
      const currTs = latestTrade?.timestamp ?? 0;
      const prevTs = prevTradeCountRef.current[bot.id];
      const currPrice = bot.stats?.lastPrice ?? 0;
      const prevPrice = prevBotPriceRef.current[bot.id] ?? 0;

      // Update price ref
      prevBotPriceRef.current[bot.id] = currPrice;

      if (prevTs === undefined) {
        prevTradeCountRef.current[bot.id] = currTs;
        return;
      }

      // Trade detection
      if (currTs > prevTs && latestTrade) {
        hasChanges = true;
        const flashType = latestTrade.action === "BUY" ? "buy" : "sell";
        const existingTimeout = tradeFlashTimeoutRef.current[bot.id];
        if (existingTimeout) clearTimeout(existingTimeout);

        tradeFlashTimeoutRef.current[bot.id] = setTimeout(
          () => setTradeFlash((f) => ({ ...f, [bot.id]: null })),
          1700,
        );

        setTradeFlash((f) => ({ ...f, [bot.id]: flashType }));
        prevTradeCountRef.current[bot.id] = currTs;
        setBackgroundPulseTrigger(flashType);
      } else if (currPrice !== prevPrice && prevPrice > 0) {
        // Price change detection: nur triggern, wenn relative Bewegung signifikant ist,
        // sonst feuert der Pulse bei jedem Mikrotick (mehrere Bots * 2s Polling = viel Churn).
        const relDelta = Math.abs(currPrice - prevPrice) / prevPrice;
        if (relDelta >= 0.002) {
          tickHappened = true;
        }
      }
    });

    // Debounce tick-Pulse: max alle 2s, damit mehrere Bots nicht 10 Pulses/Sek auslösen
    if (tickHappened) {
      const now = Date.now();
      if (now - lastTickPulseRef.current > 2000) {
        lastTickPulseRef.current = now;
        setBackgroundPulseTrigger("tick");
      }
    }

    // Solo skip redundant renders
    if (!hasChanges) return;
  }, [bots]);

  // Trigger background pulse on any AI flash (any bot)
  useEffect(() => {
    const hasAi = Object.values(aiFlash).some(Boolean);
    if (hasAi) setBackgroundPulseTrigger("ai");
  }, [aiFlash]);

  // Trigger background pulse on AI updates from terminal logs (selected bot only)
  useEffect(() => {
    if (!selectedBot) return;
    if (terminalLogs[selectedBot.id]?.length > 0) {
      const latestLog = terminalLogs[selectedBot.id][terminalLogs[selectedBot.id].length - 1];
      const isAiUpdate = latestLog?.level === "ACT" && latestLog?.message.includes("Einstellung optimiert");
      if (isAiUpdate) setBackgroundPulseTrigger("ai");
    }
  }, [terminalLogs, selectedBot]);

  const filteredSortedTokens = (() => {
    const q = tokenSearchText.trim().toLowerCase();
    return tokens
      .filter(t => !q || t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const d = tokenSort.dir === "asc" ? 1 : -1;
        switch (tokenSort.col) {
          case "price":  return d * ((a.priceUsd ?? 0) - (b.priceUsd ?? 0));
          case "volume": return d * ((a.volume24h ?? 0) - (b.volume24h ?? 0));
          case "change": return d * ((a.priceChange24h ?? 0) - (b.priceChange24h ?? 0));
          case "name":   return d * a.name.localeCompare(b.name);
          default:       return d * a.symbol.localeCompare(b.symbol);
        }
      });
  })();

  const handleTokenSort = (col: typeof tokenSort.col) =>
    setTokenSort(prev => ({ col, dir: prev.col === col && prev.dir === "asc" ? "desc" : "asc" }));

  const sortIndicator = (col: typeof tokenSort.col) =>
    tokenSort.col === col ? (tokenSort.dir === "asc" ? " ↑" : " ↓") : "";

  return (
    <>
      {/* `isolate` macht den Wrapper zum Stacking-Context. Der Pulse liegt als
          Kind mit negativem z-index darin => er wird ÜBER dem Wrapper-Hintergrund,
          aber UNTER dem eigentlichen Inhalt gezeichnet. Würde er als Sibling mit
          z-index:-20 vor dem Wrapper liegen, überdeckte ihn die deckende
          app-bg-Hintergrundfarbe komplett (Regression seit Dashboard-Redesign). */}
      <div className={`flex h-screen w-full text-foreground overflow-hidden relative isolate ${theme === "light" ? "app-bg-light" : "app-bg-dark"}`}>
        {/* GLOBAL BACKGROUND PULSE - ausgelagert in eigene Komponente */}
        {animConfig.enabled && animConfig.backgroundPulseEnabled && (
          <BackgroundPulse
            trigger={backgroundPulseTrigger}
            config={animConfig}
            bot={selectedBot}
          />
        )}
        {/* Top Navigation Bar - ersetzt Sidepanel */}
        <header className="topbar animate-in fade-in duration-1000" data-at-top={isAtTop}>
          <div className="topbar-container">
            {/* Logo links mit Tooltip */}
            <div className="topbar-logo relative group cursor-help">
              <Activity className="h-6 w-6" />
              <span>Scalpatron</span>
              {/* Tooltip */}
              <div className="logo-tooltip">
                <div className="text-sm font-semibold text-foreground mb-1">Scalpatron Trading Bot Manager</div>
                <div className="text-xs text-muted-foreground">Version 2.1 - Multi-Strategy Trading Platform für Solana SPL Tokens</div>
                <div className="logo-tooltip-arrow"></div>
              </div>
            </div>

            {/* Navigation in der Mitte - rechts ausgerichtet */}
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
                  <span className="nav-tooltip-info">Overview of all trading bots</span>
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
                  <span className="nav-tooltip-info">Manage whitelist</span>
                </div>
              </div>

              {/* Strategies Button */}
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
                  <span className="nav-tooltip-label">Strategies</span>
                  <span className="nav-tooltip-info">Strategy Management</span>
                </div>
              </div>

              <div className="topbar-nav-item">
                <button
                  className={`topbar-nav-button ${activeTab === "agent" ? "active" : ""}`}
                  onClick={() => {
                    setActiveTab("agent");
                    setAssistantSubTab("advisor");
                    setSelectedBotId(null);
                  }}
                >
                  <BrainCircuit className="h-4 w-4" />
                </button>
                <div className="nav-tooltip">
                  <span className="nav-tooltip-label">Strategy Assistant</span>
                  <span className="nav-tooltip-info">Advisor · AI Agent · Self-Correction</span>
                </div>
              </div>

              {/* Wallet Button */}
              <div className="topbar-nav-item">
                <button
                  className={`topbar-nav-button ${activeTab === "wallet" ? "active" : ""}`}
                  onClick={() => {
                    setActiveTab("wallet");
                    setSelectedBotId(null);
                  }}
                >
                  <Wallet className="h-4 w-4" />
                </button>
                <div className="nav-tooltip">
                  <span className="nav-tooltip-label">Wallet</span>
                  <span className="nav-tooltip-info">Balances & Transaktionen</span>
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
                  <span className="nav-tooltip-label">Documentation</span>
                  <span className="nav-tooltip-info">Handbooks & Guides</span>
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
              {/* Delete All Bots — only shown when bots exist */}
              {bots.length > 0 && (
                <button
                  className="flex items-center gap-1.5 text-red-400/70 hover:text-red-400 hover:bg-red-500/10 border border-red-500/20 hover:border-red-500/40 transition-colors px-2.5 py-1.5 rounded-md text-sm"
                  onClick={deleteAllBots}
                  title="Delete all bots"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}

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

              {/* Backend Status mit Tooltip - nur Icon, Text nur im Tooltip */}
              <div className="backend-indicator-wrapper relative group cursor-help">
                <div className="backend-indicator">
                  <span className={`backend-indicator-dot ${serverStatus === "connected" ? "connected" : "disconnected"}`}></span>
                </div>
                {/* Tooltip */}
                <div className="action-tooltip">
                  <div className="text-sm font-semibold text-foreground mb-1">
                    {serverStatus === "connected" ? "Connected" : "Disconnected"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {serverStatus === "connected"
                      ? "Connected to Trading Bot Daemon on port 3000"
                      : "No connection - reload page"}
                  </div>
                  {serverStatus === "disconnected" && (
                    <button
                      onClick={() => window.location.reload()}
                      className="mt-2 text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <RefreshCw className="h-3 w-3" /> Reload
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
                  <div className="text-sm font-semibold text-foreground mb-1">Change theme</div>
                  <div className="text-xs text-muted-foreground">
                    {theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
                  </div>
                  <div className="action-tooltip-arrow"></div>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content Area - Dashboard, Tokens, Agent, Docs, Settings */}
        {/* overflow-x-hidden: verhindert horizontalen Page-Scroll, der durch
            dekorative Bot-Chip-Overlays (-inset-4 Glows, ::after Pulse,
            Event-Badges) bzw. Trade-/AI-Flash-Animationen am Inhaltsrand
            ausgelöst wird. Vertikales Scrollen bleibt via overflow-y-auto. */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-8">
          <div className="w-full space-y-8">
            {activeTab === "dashboard" ? (
              // COMBINED DASHBOARD VIEW
              <div className="relative">
                <div className="relative z-10 space-y-4 animate-in fade-in duration-300">
                </div>

                {/* ── Disconnected Empty State ── */}
                {/* Zeige nur nach initialem Verbindungsaufbau wenn Verbindung verloren ging */}
                {!isConnecting && serverStatus === "disconnected" && (
                  <div className="flex flex-col items-center justify-center py-16 gap-10 animate-in fade-in duration-500 min-h-[50vh]">
                    <GhostBotGrid />

                    {/* Status Message */}
                    <div className="flex flex-col items-center gap-3 text-center z-10 -mt-10">
                      <div className="relative flex items-center justify-center w-14 h-14">
                        <span className="absolute inset-0 rounded-full bg-red-500/10 animate-ping" />
                        <span className="relative w-14 h-14 rounded-full bg-zinc-900 border border-red-500/30 flex items-center justify-center">
                          <RefreshCw className="h-5 w-5 text-red-400 animate-spin [animation-duration:3s]" />
                        </span>
                      </div>
                      <div>
                        <p className="text-base font-bold text-white/50">Connection to backend lost</p>
                        <p className="text-xs text-zinc-600 mt-1 max-w-xs">
                          The connection to the trading daemon (Port 3000) has been interrupted.
                        </p>
                      </div>
                      <button
                        onClick={() => window.location.reload()}
                        className="mt-1 flex items-center gap-2 text-xs font-bold text-primary hover:text-primary/80 border border-primary/20 hover:border-primary/40 bg-primary/5 hover:bg-primary/10 px-4 py-2 rounded-full transition-all"
                      >
                        <RefreshCw className="h-3 w-3" /> Reconnect
                      </button>
                    </div>
                  </div>
                )}

                {/* ── Connected Empty State (No Bots) ── */}
                {serverStatus === "connected" && bots.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 gap-10 animate-in fade-in duration-500 min-h-[50vh]">
                    <GhostBotGrid />

                    {/* Status Message */}
                    <div className="flex flex-col items-center gap-4 text-center z-10 -mt-20">
                      <div className="relative flex items-center justify-center w-16 h-16">
                        <span className="absolute inset-0 rounded-full bg-primary/20 animate-pulse" />
                        <span className="relative w-16 h-16 rounded-full bg-zinc-900 border border-primary/50 flex items-center justify-center shadow-[0_0_15px_oklch(from_var(--primary)_l_c_h_/_0.3)]">
                          <Bot className="h-7 w-7 text-primary" />
                        </span>
                      </div>
                      <div>
                        <h2 className="text-2xl font-black text-white tracking-tight drop-shadow-sm">Welcome to Scalpatron</h2>
                        <p className="text-sm text-zinc-400 mt-2 max-w-md mx-auto leading-relaxed">
                          Your autonomous trading agent for Solana SPL tokens. Leverage powerful strategies like Mean Reversion, Grid, or Trend-Following with integrated AI support.
                        </p>
                      </div>
                      <button
                        onClick={() => setIsCreateBotDialogOpen(true)}
                        className="mt-2 flex items-center gap-2 font-bold text-black border border-primary/20 hover:border-primary/40 bg-primary hover:bg-primary/90 px-6 py-2.5 rounded-full transition-all shadow-[0_0_12px_oklch(from_var(--primary)_l_c_h_/_0.4)]"
                      >
                        <Plus className="h-4 w-4" /> Create your first bot
                      </button>
                    </div>
                  </div>
                )}

                {/* Global Stats */}
                {bots.length > 0 && (
                  <GlobalBotStatsBar
                    bots={bots}
                    agentHistoryCount={agentHistory.length}
                    agentRunning={agentStatus?.running}
                    agentCycleMinutes={agentConfig?.cycleMinutes}
                    nextAnalysisTime={agentStatus?.nextAnalysisTime}
                    onToggleAll={handleToggleAll}
                    onStopAgent={stopAgent}
                    onStartAgent={startAgent}
                    isAllActionLoading={isAllActionLoading}
                    onOpenWalletTab={() => setActiveTab("wallet")}
                    onOpenWalletSettings={() => { setSettingsInitialTab("wallet"); setActiveTab("settings"); }}
                    getApiBase={getApiBase}
                  />
                )}

                {/* Performance Section (PnL & Risk-Analyse aller Bots) — direkt unter der ersten Zeile */}
                {bots.length > 0 && (
                  <PerformanceSection
                    bots={bots}
                    tokens={tokens}
                    selectedBotId={selectedBotId}
                    onSelectBot={setSelectedBotId}
                  />
                )}

                {/* Bot Chip Grid — bei nur einem Bot übersprungen (Auswahl trivial) */}
                {bots.length > 1 && (
                  <BotChipGrid
                    bots={bots}
                    selectedBotId={selectedBotId}
                    deletingBotId={deletingBotId}
                    tokens={tokens}
                    tradeFlash={tradeFlash}
                    aiFlash={aiFlash}
                    animConfig={animConfig}
                    backgroundPulseTrigger={backgroundPulseTrigger}
                    onSelectBot={setSelectedBotId}
                    onReorderBots={handleReorderBots}
                    onToggleBotStatus={toggleBotStatus}
                  />
                )}

                {/* Detail View — always rendered, animates on bot change */}
                {selectedBot && (() => {
                  const bot = selectedBot;
                  const tokenBSymbol = tokens.find(t => t.mintAddress === bot.mintAddress)?.symbol
                    ?? (bot.mintAddress.slice(0, 6) + "…");
                  return (
                    <div key={selectedBotId} className="animate-in fade-in slide-in-from-bottom-16 duration-600 space-y-3 mt-3">
                      {/* DETACHED PREMIUM BOT HEADER */}
                      <Card
                        className="relative rounded-l bg-card/40 backdrop-blur-md border-none overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-4 shrink-0">
                          <div className="flex items-center gap-8 flex-1 min-w-0">
                            <div className="flex items-center gap-5 flex-1 min-w-0">
                              <span className={`flex items-center justify-center w-20 h-20 rounded border transition-all overflow-hidden ${bot.status === "running"
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.15)]"
                                : "bg-zinc-500/10 text-zinc-400 border-zinc-500/30"
                                }`}>
                                {bot.status === "running" ? (
                                  <Play className="h-3 w-3 fill-current animate-status-play" />
                                ) : (
                                  <Square className="h-2.5 w-2.5 fill-current" />
                                )}
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-4 min-w-0">
                                  <span className="text-3xl font-black text-primary uppercase tracking-normal p-1.5 shrink-0">
                                    {tokens.find(t => t.mintAddress === bot.mintAddress)?.symbol || "???"}
                                  </span>
                                  <span className="text-4xl font-light tracking-normal truncate flex-1">
                                    {bot.name}
                                  </span>

                                </div>
                                <div className="flex items-center gap-4 mt-0.5 p-1.5">
                                  {(() => {
                                    const st = bot.strategyType ?? 'scalping';
                                    const sn = bot.strategyConfig?.strategy_name || "";

                                    let desc = getStrategyDescription(st);
                                    let colorCls = getStrategyColor(st);
                                    let icon = getStrategyIcon(st, "h-2 w-2");
                                    let label = st.replace('_', ' ').toUpperCase();

                                    const si = bot.strategyId || "";
                                    const isSniper = sn?.includes("Sniper") || si?.toLowerCase().includes("sniper");
                                    const isRunner = sn?.includes("Breakout") || si?.toLowerCase().includes("runner") || si?.toLowerCase().includes("breakout");
                                    const isDip = sn?.includes("Dip Buyer") || si?.toLowerCase().includes("dip");

                                    if (isSniper || isRunner || isDip) {
                                      desc = sn;
                                      if (isSniper) {
                                        colorCls = "bg-blue-500/20 text-blue-400 border-blue-500/50 shadow-[0_0_8px_rgba(59,130,246,0.3)]";
                                        icon = <Zap className={`animate-pulse h-2 w-2`} />;
                                        label = "Pulse Sniper";
                                      } else if (isRunner) {
                                        colorCls = "bg-orange-500/20 text-orange-400 border-orange-500/50 shadow-[0_0_8px_rgba(249,115,22,0.3)]";
                                        icon = <TrendingUp className={`animate-pulse h-2 w-2`} />;
                                        label = "Asym Runner";
                                      } else if (isDip) {
                                        colorCls = "bg-purple-500/20 text-purple-400 border-purple-500/50 shadow-[0_0_8px_rgba(168,85,247,0.3)]";
                                        icon = <ArrowDown className={`animate-pulse h-2 w-2`} />;
                                        label = "Dip Buyer";
                                      }
                                    }

                                    return (
                                      <span
                                        className={`flex items-center gap-1 text-[9px] uppercase tracking-widest font-black px-2 py-0.5 rounded border cursor-help ${colorCls}`}
                                        onMouseEnter={(e) => tooltip.show(desc, e)}
                                        onMouseMove={(e) => tooltip.move(e)}
                                        onMouseLeave={() => tooltip.hide()}
                                      >
                                        {icon}
                                        {label}
                                      </span>
                                    );
                                  })()}
                                  {bot.walletAddress ? (
                                    <span className="truncate max-w-[150px] text-micro font-mono text-muted-foreground" title={bot.walletAddress}>
                                      Wallet: {bot.walletAddress.slice(0, 6)}…{bot.walletAddress.slice(-4)}
                                    </span>
                                  ) : (
                                    <span className="truncate max-w-[150px] text-micro font-mono text-muted-foreground" title={selectedBot?.mintAddress}>{selectedBot?.mintAddress}</span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Telemetry Internal */}
                            <BotTelemetry
                              bot={selectedBot}
                              tokenBSymbol={tokenBSymbol}
                              className="hidden lg:flex xl:gap-1 p-5"
                            />
                          </div>

                          <div className="flex items-center gap-4">
                            <Button
                              variant="ghost"
                              size="icon"
                              className={`h-9 w-9 border transition-colors ${botSettingsPanelId === selectedBot?.id ? "border-primary/50 bg-primary/10 text-primary" : "border-border/30 hover:bg-muted/30 text-muted-foreground hover:text-foreground"}`}
                              onClick={() => openBotSettingsPanel(selectedBot)}
                              title="Bot Settings"
                            >
                              <SlidersHorizontal className="h-4 w-4" />
                            </Button>

                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 border border-border/30 hover:bg-red-500/10 hover:text-red-500 text-muted-foreground transition-colors"
                              onClick={() => deleteBot(selectedBot?.id)}
                              title="Delete Bot"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>

                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 border border-border/30 hover:bg-orange-500/10 hover:text-orange-500 text-muted-foreground transition-colors"
                              onClick={() => openResetDialog(selectedBot)}
                              title="Reset Bot"
                            >
                              <RefreshCw className="h-4 w-4" />
                            </Button>

                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 border border-border/30 hover:bg-muted/30"
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
                              className={`h-9 w-9 border transition-colors ${botInfoPanelId === selectedBot?.id ? "border-primary/50 bg-primary/10 text-primary" : "border-border/30 hover:bg-muted/30 text-muted-foreground hover:text-foreground"}`}
                              onClick={() => openBotInfoPanel(selectedBot)}
                              title="Bot Info"
                            >
                              <Info className="h-4 w-4" />
                            </Button>

                            <Button
                              variant="ghost"
                              size="icon"
                              className={`h-9 w-9 border transition-all duration-300 ${selectedBot?.status === "running"
                                ? "border-red-500/20 bg-red-500/5 text-red-500/50 hover:text-red-500 hover:bg-red-500/10 hover:border-red-500/40"
                                : "border-primary/40 bg-card text-primary hover:bg-primary/10 shadow-[0_0_10px_oklch(from_var(--primary)_l_c_h_/_0.1)]"
                                }`}
                              onClick={() => toggleBotStatus(selectedBot?.id, selectedBot?.status)}
                              title={selectedBot?.status === "running" ? "Stop Bot" : "Start Bot"}
                            >
                              {selectedBot?.status === "running" ? (
                                <Square className="h-3.5 w-3.5 fill-current" />
                              ) : (
                                <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
                              )}
                            </Button>
                          </div>
                        </div>
                        {/* Warmup strip — subtle 2px bottom edge, vanishes at 100% */}
                        {(bot.warmupProgress ?? 0) < 1 && (
                          <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-zinc-800/40">
                            <div
                              className="h-full bg-primary/50 transition-all duration-700 ease-out animate-pulse"
                              style={{ width: `${(bot.warmupProgress || 0) * 100}%` }}
                            />
                          </div>
                        )}
                      </Card>

                      {/* MAIN CONTENT AREA - Detached from Header */}
                      <div className="grid grid-cols-1 gap-6">
                        <Card className="border-primary/40 bg-card/40 backdrop-blur-md shadow-none overflow-hidden flex flex-col rounded-2xl">

                          {/* Inline Bot Settings Panel */}
                          {botSettingsPanelId === selectedBot?.id && (() => {
                            const scd = botSettingsDraft.strategyConfigDraft;
                            const stratType = scd?.strategy_type ?? 'scalping';

                            // Helper: update an indicator field by indicator type name
                            // Supports both exact type ("EMA_20") and base-type fallback ("EMA" when template uses generic names)
                            const updateIndicator = (indType: string, field: string, value: number) => {
                              setBotSettingsDraft((p) => {
                                if (!p.strategyConfigDraft) return p;
                                const inds = p.strategyConfigDraft.indicators;
                                // Exact match
                                if (inds.some(i => i.type === indType)) {
                                  return { ...p, strategyConfigDraft: { ...p.strategyConfigDraft, indicators: inds.map(i => i.type === indType ? { ...i, [field]: value } : i) } };
                                }
                                // Fuzzy: "EMA_20" → base="EMA", targetPeriod=20
                                const sep = indType.lastIndexOf('_');
                                if (sep === -1) return p;
                                const baseType = indType.slice(0, sep);
                                const targetPeriod = parseInt(indType.slice(sep + 1));
                                const withIdx = inds.map((ind, idx) => ({ ind, idx })).filter(({ ind }) => ind.type === baseType);
                                if (withIdx.length === 0) return p;
                                const targetIdx = withIdx.length === 1 ? withIdx[0].idx : withIdx.reduce((b, c) => Math.abs(((c.ind as { period?: number }).period ?? 0) - targetPeriod) < Math.abs(((b.ind as { period?: number }).period ?? 0) - targetPeriod) ? c : b).idx;
                                return { ...p, strategyConfigDraft: { ...p.strategyConfigDraft, indicators: inds.map((ind, idx) => idx === targetIdx ? { ...ind, [field]: value } : ind) } };
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

                            // Get indicator by type — exact match first, then fuzzy base-type + closest period
                            // Needed because templates use "EMA"/"RSI" but UI keys use "EMA_20"/"RSI_14"
                            const getInd = (typeKey: string): (NonNullable<typeof scd>['indicators'])[number] | undefined => {
                              if (!scd?.indicators) return undefined;
                              const exact = scd.indicators.find(i => i.type === typeKey);
                              if (exact) return exact;
                              const sep = typeKey.lastIndexOf('_');
                              if (sep === -1) return undefined;
                              const baseType = typeKey.slice(0, sep);
                              const targetPeriod = parseInt(typeKey.slice(sep + 1));
                              const candidates = scd.indicators.filter(i => i.type === baseType);
                              if (candidates.length === 0) return undefined;
                              if (candidates.length === 1) return candidates[0];
                              return candidates.reduce((best, ind) => Math.abs(((ind as { period?: number }).period ?? 0) - targetPeriod) < Math.abs(((best as { period?: number }).period ?? 0) - targetPeriod) ? ind : best);
                            };
                            // Get exit condition by type
                            const getExit = (type: string) => scd?.exit_conditions?.find((e) => e.type === type);
                            // Get entry condition by left operand
                            const getEntry = (left: string) => scd?.entry_conditions?.find((e) => e.left === left);

                            const labelCls = "text-[10px] font-bold uppercase text-muted-foreground tracking-wide";
                            const descCls = "text-[10px] text-muted-foreground/60 mt-0.5";
                            const aggPreset = botSettingsDraft.aggPreset ?? 50;
                            const presetLabel = aggPreset <= 20 ? 'Konservativ' : aggPreset <= 40 ? 'Defensiv' : aggPreset <= 60 ? 'Ausgewogen' : aggPreset <= 80 ? 'Aggressiv' : 'Max-Aggro';
                            const presetColor = aggPreset <= 33 ? 'text-blue-400' : aggPreset <= 66 ? 'text-yellow-400' : 'text-red-400';

                            const applyPreset = (v: number) => {
                              const t = (v - 1) / 99;
                              const lerp = (a: number, b: number) => Math.round(a + (b - a) * t);
                              const lerpF = (a: number, b: number, dp = 3) => parseFloat((a + (b - a) * t).toFixed(dp));
                              setBotSettingsDraft((p) => {
                                const base = { ...p, aggPreset: v };
                                if (stratType === 'scalping' || stratType === 'scalping-adaptive') {
                                  return { ...base, floorWindow: lerp(35, 5), spikeThreshold: lerpF(0.8, 0.1), sellDropThreshold: lerpF(5.0, 0.5), cooldownTicks: lerp(25, 2), takeProfitThreshold: lerpF(0.08, 0.25), startDelayTicks: lerp(40, 5) };
                                }
                                if (!p.strategyConfigDraft) return base;
                                const sc = p.strategyConfigDraft;
                                if (stratType === 'trend') {
                                  return { ...base, strategyConfigDraft: { ...sc, entry_conditions: sc.entry_conditions.map(e => e.left === 'RSI_14' ? { ...e, right: lerp(55, 80) } : e), exit_conditions: sc.exit_conditions.map(e => e.type === 'take_profit' ? { ...e, value: lerpF(0.025, 0.09) } : e.type === 'stop_loss' ? { ...e, value: lerpF(0.01, 0.05) } : e), risk_management: { ...sc.risk_management, position_size: lerpF(0.05, 0.30) }, execution: { ...sc.execution, slippage_tolerance: lerpF(0.001, 0.005) } }};
                                }
                                if (stratType === 'mean_reversion') {
                                  return { ...base, strategyConfigDraft: { ...sc, entry_conditions: sc.entry_conditions.map(e => e.left === 'RSI_14' ? { ...e, right: lerp(25, 42) } : e), exit_conditions: sc.exit_conditions.map(e => e.type === 'take_profit' ? { ...e, value: lerpF(0.02, 0.09) } : e.type === 'stop_loss' ? { ...e, value: lerpF(0.01, 0.05) } : (e.type === 'indicator' && (e.condition as {left?:string})?.left === 'RSI_14') ? { ...e, condition: { ...(e.condition as { left: string; operator: string; right: string | number }), right: lerp(58, 80) } } : e), risk_management: { ...sc.risk_management, position_size: lerpF(0.05, 0.28) } }};
                                }
                                if (stratType === 'breakout') {
                                  return { ...base, strategyConfigDraft: { ...sc, indicators: sc.indicators.map(i => (i.type === 'BB' || i.type === 'BB_20') ? { ...i, std_dev: lerpF(2.8, 1.4) } : i), entry_conditions: sc.entry_conditions.map(e => e.left === 'RSI_14' ? { ...e, right: lerp(58, 40) } : e), exit_conditions: sc.exit_conditions.map(e => e.type === 'take_profit' ? { ...e, value: lerpF(0.03, 0.12) } : e.type === 'stop_loss' ? { ...e, value: lerpF(0.015, 0.05) } : e.type === 'trailing_stop' ? { ...e, trailing_pct: lerpF(0.008, 0.07) } : e), risk_management: { ...sc.risk_management, position_size: lerpF(0.05, 0.25) } }};
                                }
                                if (stratType === 'momentum') {
                                  return { ...base, strategyConfigDraft: { ...sc, entry_conditions: sc.entry_conditions.map(e => e.left === 'RSI_14' ? { ...e, right: lerp(60, 82) } : e), exit_conditions: sc.exit_conditions.map(e => e.type === 'take_profit' ? { ...e, value: lerpF(0.03, 0.12) } : e.type === 'stop_loss' ? { ...e, value: lerpF(0.01, 0.05) } : e), risk_management: { ...sc.risk_management, position_size: lerpF(0.05, 0.25) } }};
                                }
                                if (stratType === 'dca') {
                                  return { ...base, strategyConfigDraft: { ...sc, entry_conditions: sc.entry_conditions.map(e => e.left === 'RSI_14' ? { ...e, right: lerp(30, 50) } : e), exit_conditions: sc.exit_conditions.map(e => e.type === 'take_profit' ? { ...e, value: lerpF(0.04, 0.18) } : e.type === 'stop_loss' ? { ...e, value: lerpF(0.02, 0.10) } : e), risk_management: { ...sc.risk_management, position_size: lerpF(0.02, 0.12), max_positions: lerp(1, 5), max_drawdown: lerpF(0.08, 0.25) } }};
                                }
                                if (stratType === 'paet') {
                                  // Permanent params (not touched by R1/R2/R3 adaptation):
                                  //   volatility_sigma_multiplier, safety_coefficient_k,
                                  //   acceleration_ema_period, false_alarm_penalty_omega
                                  // Start-value params (R1/R2/R3 converge these after ~30 ticks):
                                  //   stl_trend_window, collapse_threshold_pct, evacuation_ticks
                                  // All midpoints at t=0.5 align with PAET_DEFAULTS.
                                  return { ...base, strategyConfigDraft: { ...sc, paet_settings: {
                                    ...(sc.paet_settings ?? {}),
                                    collapse_threshold_pct:      lerpF(0.38, 0.12, 3),
                                    volatility_sigma_multiplier: lerpF(3.0, 1.0, 1),
                                    safety_coefficient_k:        lerpF(0.5, 3.5, 1),
                                    evacuation_ticks:            lerp(1, 5),
                                    acceleration_ema_period:     lerp(8, 2),
                                    false_alarm_penalty_omega:   lerpF(0.8, 2.2, 2),
                                    stl_trend_window:            lerp(90, 30),
                                    min_history_candles:         lerp(160, 80),
                                    entry_cooldown_ticks:        lerp(15, 5),
                                  }}};
                                }
                                return base;
                              });
                            };

                            const SR = (label: string, min: number, max: number, step: number, val: number, fmt: (n: number) => string, onChange: (n: number) => void, desc?: string) => (
                              <div className="space-y-0.5">
                                <div className="flex items-baseline justify-between gap-1">
                                  <span className={labelCls}>{label}</span>
                                  <span className="text-primary text-[11px] font-mono font-bold tabular-nums">{fmt(val)}</span>
                                </div>
                                <input type="range" min={min} max={max} step={step} value={val}
                                  onChange={(e) => onChange(Number(e.target.value))}
                                  className="w-full accent-primary cursor-pointer" style={{ height: '4px' }} />
                                {desc && <p className={descCls}>{desc}</p>}
                              </div>
                            );

                            const pct1 = (n: number) => `${n.toFixed(1)}%`;
                            const pct0 = (n: number) => `${Math.round(n)}%`;
                            const tick = (n: number) => `${Math.round(n)}`;

                            return (
                              <div className="animate-in slide-in-from-top-2 duration-200 border-b border-primary/10 bg-muted/20 px-6 py-4 space-y-4">

                                {/* Strategy badge */}
                                {(() => {
                                  const paetPlus = stratType === 'paet' && scd?.paet_settings?.entry_mode === 'paet_plus';
                                  const displayType = paetPlus ? 'paet_plus' : stratType;
                                  const displayName = paetPlus ? 'PAET+' : stratType.replace('_', ' ').toUpperCase();
                                  return (
                                    <div className="flex items-center gap-2">
                                      <span
                                        className={`flex items-center gap-1 text-xs-custom font-bold px-2 py-0.5 rounded border cursor-help ${getStrategyColor(displayType)}`}
                                        onMouseEnter={(e) => tooltip.show(getStrategyDescription(displayType), e)}
                                        onMouseMove={(e) => tooltip.move(e)}
                                        onMouseLeave={() => tooltip.hide()}
                                      >
                                        {getStrategyIcon(displayType, "h-3 w-3")}
                                        {displayName}
                                      </span>
                                      <span className="text-xs-custom text-zinc-500">{scd?.strategy_name ?? 'Range Spike Scalper'}</span>
                                    </div>
                                  );
                                })()}

                                {/* ── SETTINGS TABS ── */}
                                <Tabs defaultValue="strategy">
                                  <div className="flex items-center justify-between gap-2">
                                    <TabsList className="h-8">
                                      <TabsTrigger value="strategy" className="text-xs-custom px-3 h-6">Strategie</TabsTrigger>
                                      <TabsTrigger value="killswitch" className="text-xs-custom px-3 h-6 gap-1">
                                        Stop-Strategie
                                        {selectedBot?.killSwitch?.status === 'tripped' && (
                                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                                        )}
                                      </TabsTrigger>
                                    </TabsList>
                                  </div>

                                  <TabsContent value="strategy" className="space-y-4 mt-3">
                                {/* ── MASTER AGGRESSIVENESS PRESET ── */}
                                <div className="space-y-1.5 pb-3 border-b border-border/30">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Preset</span>
                                      <span className={`text-[10px] font-bold ${presetColor}`}>{presetLabel}</span>
                                    </div>
                                    <span className={`text-xs font-mono font-bold ${presetColor}`}>{aggPreset}</span>
                                  </div>
                                  <input
                                    type="range" min={1} max={100} value={aggPreset}
                                    onChange={(e) => applyPreset(Number(e.target.value))}
                                    className="w-full cursor-pointer"
                                    style={{ accentColor: aggPreset <= 33 ? '#60a5fa' : aggPreset <= 66 ? '#facc15' : '#f87171', height: '6px' }}
                                  />
                                  <div className="flex justify-between text-[9px] text-muted-foreground/40 select-none">
                                    <span>Konservativ</span><span>Ausgewogen</span><span>Aggressiv</span>
                                  </div>
                                </div>

                                {/* ── SCALPING PARAMS ── */}
                                {(stratType === 'scalping' || stratType === 'scalping-adaptive') && (
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    {SR('Floor Window', 5, 100, 1, botSettingsDraft.floorWindow ?? 20, tick,
                                      (n) => setBotSettingsDraft(p => ({ ...p, floorWindow: n })), 'Ticks (5–100)')}
                                    {SR('Spike Threshold', 0.05, 5, 0.05, botSettingsDraft.spikeThreshold ?? 0.3, (n) => `${n.toFixed(2)}%`,
                                      (n) => setBotSettingsDraft(p => ({ ...p, spikeThreshold: n })), '% Anstieg')}
                                    {SR('Sell Drop', 0.1, 10, 0.1, botSettingsDraft.sellDropThreshold ?? 5, (n) => `${n.toFixed(2)}%`,
                                      (n) => setBotSettingsDraft(p => ({ ...p, sellDropThreshold: n })), '% Rückgang')}
                                    {SR('Cooldown', 0, 50, 1, botSettingsDraft.cooldownTicks ?? 5, tick,
                                      (n) => setBotSettingsDraft(p => ({ ...p, cooldownTicks: n })), 'Ticks (0–50)')}
                                    {SR('Take Profit', 0.5, 50, 0.5, (botSettingsDraft.takeProfitThreshold ?? 0.10) * 100, pct1,
                                      (n) => setBotSettingsDraft(p => ({ ...p, takeProfitThreshold: n / 100 })), '% Ziel')}
                                    {SR('Start Delay', 0, 100, 1, botSettingsDraft.startDelayTicks ?? 30, tick,
                                      (n) => setBotSettingsDraft(p => ({ ...p, startDelayTicks: n })), 'Ticks nach Start')}
                                  </div>
                                )}

                                {/* ── EMA TREND PARAMS ── */}
                                {stratType === 'trend' && scd && (
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    {SR('EMA Fast', 2, 50, 1, (getInd('EMA_20') as {period?: number})?.period ?? 20, tick,
                                      (n) => updateIndicator('EMA_20', 'period', n), 'Candles')}
                                    {SR('EMA Slow', 10, 200, 1, (getInd('EMA_50') as {period?: number})?.period ?? 50, tick,
                                      (n) => updateIndicator('EMA_50', 'period', n), 'Candles')}
                                    {SR('RSI Period', 2, 30, 1, (getInd('RSI_14') as {period?: number})?.period ?? 14, tick,
                                      (n) => updateIndicator('RSI_14', 'period', n), 'Candles')}
                                    {SR('RSI Max Entry', 30, 90, 1, typeof getEntry('RSI_14')?.right === 'number' ? getEntry('RSI_14')!.right as number : 65, tick,
                                      (n) => updateEntryCondition('RSI_14', n), 'Entry wenn RSI <')}
                                    {SR('Take Profit', 0.5, 20, 0.5, (getExit('take_profit')?.value ?? 0.04) * 100, pct1,
                                      (n) => updateExitCondition('take_profit', 'value', n / 100), '% Ziel')}
                                    {SR('Stop Loss', 0.5, 15, 0.5, (getExit('stop_loss')?.value ?? 0.02) * 100, pct1,
                                      (n) => updateExitCondition('stop_loss', 'value', n / 100), '% max Verlust')}
                                    {SR('Position Size', 1, 50, 1, (scd.risk_management.position_size ?? 0.15) * 100, pct0,
                                      (n) => updateRisk('position_size', n / 100), '% des Guthabens')}
                                    {SR('Slippage', 0.05, 1, 0.05, (scd.execution.slippage_tolerance ?? 0.002) * 100, (n) => `${n.toFixed(2)}%`,
                                      (n) => updateExecution('slippage_tolerance', n / 100), '% max Slippage')}
                                  </div>
                                )}

                                {/* ── RSI MEAN REVERSION PARAMS ── */}
                                {stratType === 'mean_reversion' && scd && (
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    {SR('RSI Period', 2, 30, 1, (getInd('RSI_14') as {period?: number})?.period ?? 14, tick,
                                      (n) => updateIndicator('RSI_14', 'period', n), 'Candles')}
                                    {SR('BB Period', 5, 100, 1, (getInd('BB_20') as {period?: number})?.period ?? 20, tick,
                                      (n) => updateIndicator('BB_20', 'period', n), 'Candles')}
                                    {SR('BB Std Dev', 0.5, 4, 0.1, (getInd('BB_20') as {std_dev?: number})?.std_dev ?? 2, (n) => n.toFixed(1),
                                      (n) => updateIndicator('BB_20', 'std_dev', n), 'Standardabw.')}
                                    {SR('RSI Oversold', 10, 50, 1, typeof getEntry('RSI_14')?.right === 'number' ? getEntry('RSI_14')!.right as number : 32, tick,
                                      (n) => updateEntryCondition('RSI_14', n), 'Entry wenn RSI <')}
                                    {SR('RSI Overbought', 50, 90, 1, (() => { const ec = scd.exit_conditions.find((e) => e.type === 'indicator' && e.condition?.left === 'RSI_14'); return (ec?.condition?.right ?? 55) as number; })(), tick,
                                      (n) => { setBotSettingsDraft((p) => { if (!p.strategyConfigDraft) return p; const exit_conditions = p.strategyConfigDraft.exit_conditions.map((ec) => ec.type === 'indicator' && (ec.condition as { left: string })?.left === 'RSI_14' ? { ...ec, condition: { ...(ec.condition as { left: string; operator: string; right: string | number }), right: n } } : ec); return { ...p, strategyConfigDraft: { ...p.strategyConfigDraft!, exit_conditions } }; }); }, 'Exit wenn RSI ≥')}
                                    {SR('Take Profit', 0.5, 20, 0.5, (getExit('take_profit')?.value ?? 0.035) * 100, pct1,
                                      (n) => updateExitCondition('take_profit', 'value', n / 100), '% Ziel')}
                                    {SR('Stop Loss', 0.5, 15, 0.5, (getExit('stop_loss')?.value ?? 0.02) * 100, pct1,
                                      (n) => updateExitCondition('stop_loss', 'value', n / 100), '% max Verlust')}
                                    {SR('Position Size', 1, 50, 1, (scd.risk_management.position_size ?? 0.12) * 100, pct0,
                                      (n) => updateRisk('position_size', n / 100), '% des Guthabens')}
                                  </div>
                                )}

                                {/* ── BREAKOUT PARAMS ── */}
                                {stratType === 'breakout' && scd && (
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    {SR('BB Period', 5, 100, 1, (getInd('BB_20') as {period?: number})?.period ?? 20, tick,
                                      (n) => updateIndicator('BB_20', 'period', n), 'Candles')}
                                    {SR('BB Std Dev', 1, 4, 0.1, (getInd('BB_20') as {std_dev?: number})?.std_dev ?? 2, (n) => n.toFixed(1),
                                      (n) => updateIndicator('BB_20', 'std_dev', n), 'Standardabw.')}
                                    {SR('ATR Period', 2, 50, 1, (getInd('ATR_14') as {period?: number})?.period ?? 14, tick,
                                      (n) => updateIndicator('ATR_14', 'period', n), 'Candles')}
                                    {SR('RSI Min Entry', 30, 80, 1, typeof getEntry('RSI_14')?.right === 'number' ? getEntry('RSI_14')!.right as number : 50, tick,
                                      (n) => updateEntryCondition('RSI_14', n), 'Entry wenn RSI >')}
                                    {SR('Take Profit', 0.5, 25, 0.5, (getExit('take_profit')?.value ?? 0.05) * 100, pct1,
                                      (n) => updateExitCondition('take_profit', 'value', n / 100), '% Ziel')}
                                    {SR('Stop Loss', 0.5, 15, 0.5, (getExit('stop_loss')?.value ?? 0.025) * 100, pct1,
                                      (n) => updateExitCondition('stop_loss', 'value', n / 100), '% max Verlust')}
                                    {SR('Trailing Stop', 0.2, 15, 0.2, (getExit('trailing_stop')?.trailing_pct ?? 0.015) * 100, pct1,
                                      (n) => updateExitCondition('trailing_stop', 'trailing_pct', n / 100), '% Trailing')}
                                    {SR('Position Size', 1, 50, 1, (scd.risk_management.position_size ?? 0.1) * 100, pct0,
                                      (n) => updateRisk('position_size', n / 100), '% des Guthabens')}
                                  </div>
                                )}

                                {/* ── MOMENTUM PARAMS ── */}
                                {stratType === 'momentum' && scd && (
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    {SR('MACD Fast', 2, 30, 1, (getInd('MACD') as {fast_period?: number})?.fast_period ?? 12, tick,
                                      (n) => updateIndicator('MACD', 'fast_period', n), 'Candles')}
                                    {SR('MACD Slow', 10, 60, 1, (getInd('MACD') as {slow_period?: number})?.slow_period ?? 26, tick,
                                      (n) => updateIndicator('MACD', 'slow_period', n), 'Candles')}
                                    {SR('MACD Signal', 2, 20, 1, (getInd('MACD') as {signal_period?: number})?.signal_period ?? 9, tick,
                                      (n) => updateIndicator('MACD', 'signal_period', n), 'Candles')}
                                    {SR('EMA Period', 10, 200, 1, (getInd('EMA_50') as {period?: number})?.period ?? 50, tick,
                                      (n) => updateIndicator('EMA_50', 'period', n), 'Candles')}
                                    {SR('RSI Max Entry', 30, 90, 1, typeof getEntry('RSI_14')?.right === 'number' ? getEntry('RSI_14')!.right as number : 70, tick,
                                      (n) => updateEntryCondition('RSI_14', n), 'Entry wenn RSI <')}
                                    {SR('Take Profit', 0.5, 25, 0.5, (getExit('take_profit')?.value ?? 0.045) * 100, pct1,
                                      (n) => updateExitCondition('take_profit', 'value', n / 100), '% Ziel')}
                                    {SR('Stop Loss', 0.5, 15, 0.5, (getExit('stop_loss')?.value ?? 0.02) * 100, pct1,
                                      (n) => updateExitCondition('stop_loss', 'value', n / 100), '% max Verlust')}
                                    {SR('Position Size', 1, 50, 1, (scd.risk_management.position_size ?? 0.12) * 100, pct0,
                                      (n) => updateRisk('position_size', n / 100), '% des Guthabens')}
                                  </div>
                                )}

                                {/* ── DCA PARAMS ── */}
                                {stratType === 'dca' && scd && (
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    {SR('RSI Period', 2, 30, 1, (getInd('RSI_14') as {period?: number})?.period ?? 14, tick,
                                      (n) => updateIndicator('RSI_14', 'period', n), 'Candles')}
                                    {SR('EMA Period', 10, 300, 5, (getInd('EMA_100') as {period?: number})?.period ?? 100, tick,
                                      (n) => updateIndicator('EMA_100', 'period', n), 'Candles')}
                                    {SR('RSI Entry', 10, 60, 1, typeof getEntry('RSI_14')?.right === 'number' ? getEntry('RSI_14')!.right as number : 40, tick,
                                      (n) => updateEntryCondition('RSI_14', n), 'Entry wenn RSI <')}
                                    {SR('Max Positions', 1, 10, 1, scd.risk_management.max_positions ?? 5, tick,
                                      (n) => updateRisk('max_positions', n), 'Gleichzeitige DCA')}
                                    {SR('Take Profit', 0.5, 30, 0.5, (getExit('take_profit')?.value ?? 0.06) * 100, pct1,
                                      (n) => updateExitCondition('take_profit', 'value', n / 100), '% Ziel')}
                                    {SR('Stop Loss', 0.5, 20, 0.5, (getExit('stop_loss')?.value ?? 0.05) * 100, pct1,
                                      (n) => updateExitCondition('stop_loss', 'value', n / 100), '% max Verlust')}
                                    {SR('Position Size', 1, 25, 1, (scd.risk_management.position_size ?? 0.05) * 100, pct0,
                                      (n) => updateRisk('position_size', n / 100), '% pro Einstieg')}
                                    {SR('Max Drawdown', 1, 40, 1, (scd.risk_management.max_drawdown ?? 0.15) * 100, pct0,
                                      (n) => updateRisk('max_drawdown', n / 100), '% Handelsstopp')}
                                  </div>
                                )}

                                {/* ── PAET PARAMS ── */}
                                {stratType === 'paet' && scd && (() => {
                                  const ps = (scd.paet_settings ?? {}) as Record<string, number | string | undefined>;
                                  const entryMode = (scd.paet_settings?.entry_mode ?? 'once') as 'once' | 'paet_plus';
                                  const updatePaetSetting = (key: string, value: number | string) =>
                                    setBotSettingsDraft(p => ({
                                      ...p,
                                      strategyConfigDraft: p.strategyConfigDraft ? {
                                        ...p.strategyConfigDraft,
                                        paet_settings: { ...(p.strategyConfigDraft.paet_settings ?? {}), [key]: value },
                                      } : p.strategyConfigDraft,
                                    }));
                                  return (
                                    <div className="space-y-3">
                                      {/* ── Entry Mode ── */}
                                      <div className="space-y-1.5 pb-3 border-b border-border/20">
                                        <div className="flex items-center justify-between gap-2">
                                          <label className={labelCls}>Entry Mode</label>
                                          <div className="flex gap-1">
                                            <button type="button"
                                              onClick={() => updatePaetSetting('entry_mode', 'once')}
                                              className={`px-2 py-0.5 rounded text-xs-custom font-bold border transition-colors ${entryMode === 'once' ? 'bg-rose-500/20 border-rose-500/40 text-rose-300' : 'bg-muted border-border text-muted-foreground'}`}>
                                              PAET
                                            </button>
                                            <button type="button"
                                              onClick={() => updatePaetSetting('entry_mode', 'paet_plus')}
                                              className={`px-2 py-0.5 rounded text-xs-custom font-bold border transition-colors ${entryMode === 'paet_plus' ? 'bg-violet-500/20 border-violet-500/40 text-violet-300' : 'bg-muted border-border text-muted-foreground'}`}>
                                              PAET+
                                            </button>
                                          </div>
                                        </div>
                                        <p className={descCls}>
                                          {entryMode === 'once'
                                            ? 'Kauft automatisch nach Warmup — kein Einstiegs-Filter.'
                                            : 'PAET+: Kauft nur wenn Velocity↑ und Residual>0 (STL-Momentum-Filter).'}
                                        </p>
                                        <div className="mt-1.5">
                                          {SR('Entry Cooldown', 1, 50, 1, (ps.entry_cooldown_ticks as number ?? 10), tick,
                                            (n) => updatePaetSetting('entry_cooldown_ticks', n), 'Ticks nach SELL bis nächster BUY')}
                                        </div>
                                      </div>
                                      {/* ── Exit & Signal Parameters ── */}
                                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                        {SR('Collapse Threshold', 5, 50, 1, (ps.collapse_threshold_pct as number ?? 0.25) * 100, pct1,
                                          (n) => updatePaetSetting('collapse_threshold_pct', n / 100), '% unter Peak = Kollaps')}
                                        {SR('Evacuation Ticks', 1, 10, 1, (ps.evacuation_ticks as number ?? 3), tick,
                                          (n) => updatePaetSetting('evacuation_ticks', n), 'Candles für Exit')}
                                        {SR('Safety Buffer k', 0.5, 5, 0.5, (ps.safety_coefficient_k as number ?? 2), (n) => n.toFixed(1),
                                          (n) => updatePaetSetting('safety_coefficient_k', n), 'Sicherheitspuffer')}
                                        {SR('Sigma Multiplier', 1.0, 4.0, 0.1, (ps.volatility_sigma_multiplier as number ?? 2.0), (n) => `${n.toFixed(1)}σ`,
                                          (n) => updatePaetSetting('volatility_sigma_multiplier', n), 'Band-Breite')}
                                        {SR('Min History', 60, 300, 10, (ps.min_history_candles as number ?? 120), tick,
                                          (n) => updatePaetSetting('min_history_candles', n), 'Warmup-Candles')}
                                        {SR('Trend Window', 20, 200, 5, (ps.stl_trend_window as number ?? 60), tick,
                                          (n) => updatePaetSetting('stl_trend_window', n), 'SMA für Trend T(t)')}
                                        {SR('EMA Smoothing', 2, 20, 1, (ps.acceleration_ema_period as number ?? 5), tick,
                                          (n) => updatePaetSetting('acceleration_ema_period', n), 'Glättung vor Ableit.')}
                                        {SR('Seasonal Period', 0, 120, 1, (ps.stl_seasonal_period as number ?? 0), (n) => n === 0 ? 'Auto' : `${Math.round(n)}`,
                                          (n) => updatePaetSetting('stl_seasonal_period', n), '0 = FFT Auto-Detect')}
                                      </div>
                                    </div>
                                  );
                                })()}

                                {/* Trading Config Row */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-border/30">
                                  <div className="space-y-1">
                                    <label className={labelCls}>Trading Mode</label>
                                    <div className="flex gap-1">
                                      <button type="button"
                                        onClick={() => setBotSettingsDraft((p) => ({ ...p, tradingMode: "fixed" }))}
                                        className={`flex-1 py-1 rounded text-xs-custom font-bold border transition-colors ${botSettingsDraft.tradingMode === "fixed" ? "bg-primary/20 border-primary/40 text-primary" : "bg-muted border-border text-muted-foreground"}`}>
                                        Fixed SOL
                                      </button>
                                      <button type="button"
                                        onClick={() => setBotSettingsDraft((p) => ({ ...p, tradingMode: "aggressive" }))}
                                        className={`flex-1 py-1 rounded text-xs-custom font-bold border transition-colors ${botSettingsDraft.tradingMode === "aggressive" ? "bg-primary/20 border-primary/40 text-primary" : "bg-muted border-border text-muted-foreground"}`}>
                                        Aggressive
                                      </button>
                                    </div>
                                  </div>

                                  {botSettingsDraft.tradingMode === "fixed" ? (
                                    <div className="space-y-1">
                                      {SR('SOL per Trade', 0.01, 10, 0.01, botSettingsDraft.tradeSize ?? 1, (n) => `${n.toFixed(2)} SOL`,
                                        (n) => setBotSettingsDraft(p => ({ ...p, tradeSize: n })), 'Fixer Betrag pro Trade')}
                                    </div>
                                  ) : (
                                    <div className="space-y-1">
                                      {SR('Max Aggressiveness', 1, 100, 1, botSettingsDraft.aggressiveness ?? 10, (n) => `${n}%`,
                                        (n) => setBotSettingsDraft(p => ({ ...p, aggressiveness: n })), 'KI operiert in diesem Limit')}
                                    </div>
                                  )}

                                  <div className="space-y-1">
                                    <label className={labelCls}>Wallet Address</label>
                                    <input type="text"
                                      className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-primary/50"
                                      placeholder="Public key (display only)"
                                      value={botSettingsDraft.walletAddress ?? ""}
                                      onChange={(e) => setBotSettingsDraft((p) => ({ ...p, walletAddress: e.target.value }))}
                                    />
                                    <p className={descCls}>Für Tracking & Anzeige</p>
                                  </div>
                                </div>
                                  </TabsContent>

                                  {/* ── STOP-STRATEGIE / KILL-SWITCH TAB ── */}
                                  <TabsContent value="killswitch" className="space-y-4 mt-3">
                                    {(() => {
                                      const ks = botSettingsDraft.killSwitchDraft;
                                      const rt = selectedBot?.killSwitch;
                                      const setKs = (patch: Partial<KillSwitchConfig>) =>
                                        setBotSettingsDraft(p => ({ ...p, killSwitchDraft: { ...p.killSwitchDraft, ...patch } }));
                                      const tripped = rt?.status === 'tripped';
                                      const fmtPctSigned = (n: number) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`;

                                      // Per-Rule Zugriff (jede Regel einzeln an/aus + Wert)
                                      type RKey = 'maxDrawdown' | 'maxDailyLoss' | 'maxConsecutiveLosses' | 'sessionTakeProfit' | 'maxTotalTrades';
                                      const ruleVal = (k: RKey, fallback: number) => ks[k]?.value ?? fallback;
                                      const setRuleVal = (k: RKey, value: number) =>
                                        setKs({ [k]: { enabled: ks[k]?.enabled ?? true, value } } as Partial<KillSwitchConfig>);
                                      const toggleRule = (k: RKey) =>
                                        setKs({ [k]: { enabled: !(ks[k]?.enabled ?? true), value: ks[k]?.value ?? 0 } } as Partial<KillSwitchConfig>);
                                      const activeCount = (['maxDrawdown', 'maxDailyLoss', 'maxConsecutiveLosses', 'sessionTakeProfit', 'maxTotalTrades'] as RKey[])
                                        .filter(k => ks[k]?.enabled).length;

                                      // Regel-Zeile mit Toggle + Slider
                                      const renderRule = (k: RKey, label: string, min: number, max: number, step: number, fmt: (n: number) => string, desc: string, mul: number, fallback: number) => {
                                        const on = ks[k]?.enabled ?? true;
                                        const val = ruleVal(k, fallback);
                                        return (
                                          <div className={`rounded-lg border p-2.5 space-y-1.5 transition-opacity ${on ? 'bg-muted/30 border-border' : 'bg-muted/10 border-border/30 opacity-50'}`}>
                                            <div className="flex items-center justify-between gap-2">
                                              <div className="flex items-center gap-1.5 min-w-0">
                                                <button
                                                  type="button"
                                                  onClick={() => toggleRule(k)}
                                                  title={on ? 'Regel aktiv — klicken zum Deaktivieren' : 'Regel inaktiv — klicken zum Aktivieren'}
                                                  className={`w-7 h-3.5 rounded-full relative transition-colors shrink-0 ${on ? 'bg-emerald-500/70' : 'bg-muted-foreground/40'}`}
                                                >
                                                  <span className={`absolute top-[2px] w-2.5 h-2.5 rounded-full bg-white shadow transition-all ${on ? 'left-[14px]' : 'left-[2px]'}`} />
                                                </button>
                                                <span className="text-[10px] font-bold uppercase text-muted-foreground truncate">{label}</span>
                                              </div>
                                              <span className={`text-[11px] font-mono font-bold tabular-nums shrink-0 ${on ? 'text-primary' : 'text-muted-foreground'}`}>{fmt(val * mul)}</span>
                                            </div>
                                            <input type="range" min={min} max={max} step={step} value={val * mul}
                                              onChange={(e) => setRuleVal(k, Number(e.target.value) / mul)}
                                              disabled={!on}
                                              className={`w-full cursor-pointer ${on ? 'accent-primary' : 'accent-muted-foreground/40'}`}
                                              style={{ height: '4px' }} />
                                            <p className={descCls}>{desc}</p>
                                          </div>
                                        );
                                      };

                                      return (
                                        <div className={`space-y-4 ${ks.enabled ? '' : 'opacity-60'}`}>
                                          {/* Live-Status Banner */}
                                          {tripped ? (
                                            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 space-y-2">
                                              <div className="flex items-start justify-between gap-2">
                                                <div className="flex items-center gap-2">
                                                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                                  <span className="text-xs-custom font-bold text-red-400 uppercase">Kill-Switch ausgelöst — Trading gestoppt</span>
                                                </div>
                                                <button
                                                  className="px-2.5 py-1 rounded bg-red-500/20 border border-red-500/40 text-red-300 text-xs-custom font-bold hover:bg-red-500/30 transition-colors"
                                                  onClick={() => resetKillSwitch(selectedBot?.id ?? "")}
                                                >
                                                  Reset & Entschärfen
                                                </button>
                                              </div>
                                              <p className="text-xs-custom text-red-300/80 font-mono break-words">{rt?.reason ?? 'Grenze überschritten'}</p>
                                            </div>
                                          ) : ks.enabled ? (
                                            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2 flex items-center gap-2">
                                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                              <span className="text-xs-custom font-bold text-emerald-400 uppercase">Scharf geschaltet — {activeCount} {activeCount === 1 ? 'Regel' : 'Regeln'} überwacht</span>
                                            </div>
                                          ) : (
                                            <div className="rounded-lg border border-border/40 bg-muted/30 p-2 flex items-center gap-2">
                                              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                                              <span className="text-xs-custom font-bold text-muted-foreground uppercase">Inaktiv — aktivieren, um Trading automatisch zu stoppen</span>
                                            </div>
                                          )}

                                          {/* Master Enable + Empfehlung */}
                                          <div className="flex items-center justify-between gap-3 pb-3 border-b border-border/30">
                                            <button
                                              type="button"
                                              onClick={() => setKs({ enabled: !ks.enabled })}
                                              className={`flex items-center gap-2 px-3 py-1.5 rounded border text-xs-custom font-bold transition-colors ${ks.enabled ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400' : 'bg-muted border-border text-muted-foreground'}`}
                                            >
                                              <span className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${ks.enabled ? 'border-emerald-400' : 'border-muted-foreground/50'}`}>
                                                {ks.enabled && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                                              </span>
                                              Kill-Switch {ks.enabled ? 'AKTIV' : 'AUS'}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => setKs({ ...defaultKillSwitchConfig(stratType), enabled: ks.enabled })}
                                              className="px-2.5 py-1 rounded border border-border bg-muted text-muted-foreground text-xs-custom font-bold hover:bg-muted/60 hover:text-foreground transition-colors"
                                            >
                                              ⚙ Empfehlung ({stratType.replace('_', ' ')})
                                            </button>
                                          </div>

                                          {/* Stop-Regeln — jede Regel einzeln an/aus + Wert (responsives Grid) */}
                                          <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                              <span className="text-[10px] font-bold uppercase text-muted-foreground">Aktive Regeln</span>
                                              <span className={`text-[10px] font-mono font-bold ${activeCount > 0 ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                                                {activeCount}/5 aktiv
                                              </span>
                                            </div>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                                              {renderRule('maxDrawdown', 'Max Drawdown', 1, 50, 1, pct0, 'Stop bei Equity-Rückgang vom Hoch', 100, 0.15)}
                                              {renderRule('maxDailyLoss', 'Max Tagesverlust', 1, 30, 1, pct0, 'Stop bei Session-/Tagesverlust', 100, 0.05)}
                                              {renderRule('maxConsecutiveLosses', 'Max Folgeverluste', 1, 20, 1, tick, 'Stop nach N Verlust-Trades in Folge', 1, 5)}
                                              {renderRule('sessionTakeProfit', 'Session Take-Profit', 1, 50, 1, pct0, 'Stop bei erreichtem Session-Gewinn', 100, 0.10)}
                                              {renderRule('maxTotalTrades', 'Max Trades gesamt', 5, 1000, 5, tick, 'Stop nach N geschlossenen Trades', 1, 100)}
                                            </div>
                                          </div>

                                          {/* Live-Metriken */}
                                          {rt && (
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-3 border-t border-border/30">
                                              <div className="space-y-0.5">
                                                <span className={labelCls}>Drawdown</span>
                                                <span className={`text-xs font-mono font-bold ${ks.maxDrawdown?.enabled && rt.drawdownPct >= (ks.maxDrawdown?.value ?? 1) * 0.8 ? 'text-red-400' : 'text-foreground'}`}>{(rt.drawdownPct * 100).toFixed(1)}%</span>
                                              </div>
                                              <div className="space-y-0.5">
                                                <span className={labelCls}>Session PnL</span>
                                                <span className={`text-xs font-mono font-bold ${rt.sessionPnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtPctSigned(rt.sessionPnlPct)}</span>
                                              </div>
                                              <div className="space-y-0.5">
                                                <span className={labelCls}>Folgeverluste</span>
                                                <span className={`text-xs font-mono font-bold ${ks.maxConsecutiveLosses?.enabled && rt.consecutiveLosses >= (ks.maxConsecutiveLosses?.value ?? 99) * 0.8 ? 'text-red-400' : 'text-foreground'}`}>{rt.consecutiveLosses}</span>
                                              </div>
                                              <div className="space-y-0.5">
                                                <span className={labelCls}>Trades</span>
                                                <span className="text-xs font-mono font-bold text-foreground">{rt.totalTrades}</span>
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })()}
                                  </TabsContent>
                                </Tabs>

                                <div className="flex items-center gap-3 mt-4">
                                  <button
                                    className="px-4 py-1.5 rounded bg-primary text-black text-sm font-bold hover:bg-primary/80 transition-colors"
                                    onClick={() => saveBotSettings(selectedBot?.id)}
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
                          {botInfoPanelId === selectedBot?.id && (
                            <div className="animate-in slide-in-from-top-2 duration-200 px-6 py-4 space-y-4">
                              {/* Bot Key Facts Header */}
                              <Card className="border-border/30 bg-card">
                                <CardHeader className="p-3 pb-2">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <Info className="h-4 w-4 text-primary" />
                                      <h3 className="text-xs font-bold text-foreground uppercase">Bot Key Facts</h3>
                                    </div>
                                  </div>
                                </CardHeader>
                                <CardContent className="p-3 pt-0">
                                  {/* Key Facts Grid - Improved Layout with consistent styling */}
                                  {(() => {
                                    // Calculate stats in accessible scope
                                    const stats = selectedBot.stats;
                                    const wins = stats?.wins ?? 0;
                                    const totalTrades = stats?.totalTrades ?? 0;
                                    const winRate = totalTrades > 0 ? wins / totalTrades : 0;
                                    const winRatePercentage = winRate * 100;
                                    const totalPnlPercent = stats?.totalPnlPercent ?? 0;

                                    return (
                                      <>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                          {/* Total Trades Card */}
                                          <StatCard
                                            icon={Activity}
                                            iconColor="text-blue-400"
                                            label="Total Trades"
                                            value={totalTrades}
                                            valueColor="text-foreground"
                                          />

                                          {/* Win Rate Card */}
                                          <StatCard
                                            icon={TrendingUp}
                                            iconColor="text-emerald-400"
                                            label="Win Rate"
                                            value={`${winRatePercentage.toFixed(1)}%`}
                                            valueColor={winRatePercentage >= 50 ? 'text-emerald-400' : 'text-red-400'}
                                          />

                                          {/* Total PnL Card */}
                                          <StatCard
                                            icon={totalPnlPercent >= 0 ? TrendingUp : TrendingDown}
                                            iconColor={totalPnlPercent >= 0 ? 'text-emerald-400' : 'text-red-400'}
                                            label="Total PnL"
                                            value={`${totalPnlPercent >= 0 ? '+' : ''}${totalPnlPercent.toFixed(2)}%`}
                                            valueColor={totalPnlPercent >= 0 ? 'text-emerald-400' : 'text-red-400'}
                                          />

                                          {/* Uptime Card */}
                                          <StatCard
                                            icon={Flame}
                                            iconColor="text-orange-400"
                                            label="Uptime"
                                            value={formatUptime(selectedBot.startTime)}
                                            valueColor="text-foreground"
                                          />
                                        </div>

                                      </>
                                    );
                                  })()}

                                  {/* Exit Strategie — Fortschritt bis zur Exit-Regel (Kill-Switch) */}
                                  {(() => {
                                    const ks = selectedBot.killSwitch;

                                    // Kill-Switch deaktiviert → Hinweis
                                    if (!ks?.config?.enabled) {
                                      return (
                                        <div className="rounded-lg bg-muted/30 border border-border/50 p-2.5 mt-3">
                                          <div className="flex items-center gap-1.5 mb-1">
                                            <ArrowDown className="h-3 w-3 text-muted-foreground" />
                                            <span className="text-[9px] font-bold uppercase text-muted-foreground">Exit Strategie</span>
                                          </div>
                                          <div className="text-sm font-bold text-muted-foreground">Kill-Switch inaktiv</div>
                                          <p className="text-[10px] text-muted-foreground/60 mt-0.5">Stop-Strategie aktivieren, um den Trading-Stopp zu überwachen.</p>
                                        </div>
                                      );
                                    }

                                    // Ausgelöst → Ergebnis anzeigen
                                    if (ks.status === 'tripped') {
                                      return (
                                        <div className="rounded-lg bg-red-500/10 border border-red-500/40 p-2.5 mt-3 space-y-1">
                                          <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-1.5">
                                              <Zap className="h-3 w-3 text-red-400 animate-pulse" />
                                              <span className="text-[9px] font-bold uppercase text-red-400">Exit Regel ausgelöst</span>
                                            </div>
                                            {ks.trippedAt && (
                                              <span className="text-[9px] text-red-300/60 font-mono">
                                                {new Date(ks.trippedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                              </span>
                                            )}
                                          </div>
                                          <div className="text-sm font-black text-red-300 break-words">{ks.reason ?? 'Grenze überschritten'}</div>
                                          <p className="text-[10px] text-red-300/70">Trading gestoppt — Reset in den Stop-Strategie-Einstellungen erforderlich.</p>
                                        </div>
                                      );
                                    }

                                    // Relevanteste Exit-Regel berechnen (größter Fortschritt zur Grenze).
                                    // Nur aktivierten Einzelregeln (rule.enabled) werden berücksichtigt.
                                    type Rule = { name: string; kind: 'danger' | 'goal'; progress: number; current: string; limit: string; remaining: string; verb: string };
                                    const cfg = ks.config;
                                    const rules: Rule[] = [];
                                    if (cfg.maxDrawdown?.enabled && cfg.maxDrawdown.value > 0) {
                                      const lim = cfg.maxDrawdown.value;
                                      rules.push({ name: 'Max Drawdown', kind: 'danger', progress: ks.drawdownPct / lim, current: `${(ks.drawdownPct * 100).toFixed(1)}%`, limit: `${(lim * 100).toFixed(0)}%`, remaining: `${((lim - ks.drawdownPct) * 100).toFixed(1)}% bis Stopp`, verb: 'Stop bei Equity-Rückgang vom Hoch' });
                                    }
                                    if (cfg.maxDailyLoss?.enabled && cfg.maxDailyLoss.value > 0) {
                                      const lim = cfg.maxDailyLoss.value;
                                      const loss = Math.max(0, -ks.sessionPnlPct);
                                      rules.push({ name: 'Tagesverlust-Limit', kind: 'danger', progress: loss / lim, current: `-${(loss * 100).toFixed(1)}%`, limit: `-${(lim * 100).toFixed(0)}%`, remaining: `${((lim - loss) * 100).toFixed(1)}% bis Stopp`, verb: 'Stop bei Session-Verlust' });
                                    }
                                    if (cfg.maxConsecutiveLosses?.enabled && cfg.maxConsecutiveLosses.value > 0) {
                                      const lim = cfg.maxConsecutiveLosses.value;
                                      rules.push({ name: 'Folgeverluste', kind: 'danger', progress: ks.consecutiveLosses / lim, current: `${ks.consecutiveLosses}`, limit: `${lim}`, remaining: `${lim - ks.consecutiveLosses} weitere bis Stopp`, verb: 'Stop nach Verlust-Serie' });
                                    }
                                    if (cfg.sessionTakeProfit?.enabled && cfg.sessionTakeProfit.value > 0) {
                                      const lim = cfg.sessionTakeProfit.value;
                                      const gain = Math.max(0, ks.sessionPnlPct);
                                      rules.push({ name: 'Session Take-Profit', kind: 'goal', progress: gain / lim, current: `+${(gain * 100).toFixed(1)}%`, limit: `+${(lim * 100).toFixed(0)}%`, remaining: `+${((lim - gain) * 100).toFixed(1)}% bis Ziel`, verb: 'Gewinnmitnahme bei Session-Ziel' });
                                    }
                                    if (cfg.maxTotalTrades?.enabled && cfg.maxTotalTrades.value > 0) {
                                      const lim = cfg.maxTotalTrades.value;
                                      rules.push({ name: 'Trade-Limit', kind: 'danger', progress: ks.totalTrades / lim, current: `${ks.totalTrades}`, limit: `${lim}`, remaining: `${lim - ks.totalTrades} Trades bis Stopp`, verb: 'Lebenszeit-Trade-Kappe' });
                                    }

                                    if (rules.length === 0) {
                                      return (
                                        <div className="rounded-lg bg-muted/30 border border-border/50 p-2.5 mt-3">
                                          <div className="flex items-center gap-1.5 mb-1">
                                            <ArrowDown className="h-3 w-3 text-muted-foreground" />
                                            <span className="text-[9px] font-bold uppercase text-muted-foreground">Exit Strategie</span>
                                          </div>
                                          <div className="text-sm font-bold text-muted-foreground">Keine Regeln konfiguriert</div>
                                        </div>
                                      );
                                    }

                                    const active = rules.reduce((a, b) => (b.progress > a.progress ? b : a), rules[0]);
                                    const pct = Math.max(0, Math.min(1, active.progress));
                                    const isGoal = active.kind === 'goal';
                                    const barColor = isGoal ? 'from-emerald-500 to-teal-400' : pct >= 0.8 ? 'from-red-600 to-orange-400' : pct >= 0.5 ? 'from-amber-500 to-yellow-400' : 'from-sky-500 to-cyan-400';
                                    const valueColor = isGoal ? 'text-emerald-400' : pct >= 0.8 ? 'text-red-400' : 'text-foreground';

                                    return (
                                      <div className="rounded-lg bg-muted/30 border border-border p-2.5 mt-3">
                                        <div className="flex items-center gap-1.5 mb-1">
                                          <ArrowDown className={`h-3 w-3 ${isGoal ? 'text-emerald-400' : 'text-primary'}`} />
                                          <span className="text-[9px] font-bold uppercase text-muted-foreground">Exit Strategie</span>
                                        </div>
                                        <div className="flex items-baseline justify-between gap-2">
                                          <div className="min-w-0">
                                            <div className={`text-base font-black ${valueColor} truncate`}>{active.name}</div>
                                            <p className="text-[10px] text-muted-foreground/70 truncate">{active.verb}</p>
                                          </div>
                                          <div className="text-right shrink-0">
                                            <div className={`text-base font-black font-mono ${valueColor}`}>{active.current}</div>
                                            <div className="text-[9px] text-muted-foreground font-mono">/ {active.limit}</div>
                                          </div>
                                        </div>

                                        {/* Dünne animierte Status-Bar */}
                                        <div className="mt-2">
                                          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                                            <div
                                              className={`h-full rounded-full bg-gradient-to-r ${barColor} relative transition-[width] duration-700 ease-out`}
                                              style={{ width: `${pct * 100}%` }}
                                            >
                                              <span className="absolute inset-0 bg-white/20 animate-pulse rounded-full" />
                                            </div>
                                          </div>
                                          <div className="flex items-center justify-between mt-1">
                                            <span className="text-[9px] text-muted-foreground font-medium">{active.remaining}</span>
                                            <span className={`text-[9px] font-mono font-bold ${valueColor}`}>{Math.round(pct * 100)}%</span>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })()}
                                </CardContent>
                              </Card>

                              {/* Data Categories Row */}
                              <Card className="border-border/30 bg-card">
                                <CardHeader className="p-3 pb-2">
                                  <div className="flex items-center gap-2">
                                    <Database className="h-4 w-4 text-cyan-400" />
                                    <h3 className="text-xs font-bold text-foreground uppercase">Data Categories</h3>
                                  </div>
                                </CardHeader>
                                <CardContent className="p-3 pt-0">
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {/* Price Data */}
                                    <div className="rounded-lg bg-muted/30 border border-border p-3 space-y-2">
                                      <div className="flex items-center gap-1.5">
                                        <Database className="h-3 w-3 text-cyan-400" />
                                        <span className="text-tiny font-bold uppercase text-muted-foreground">Price Data</span>
                                      </div>
                                      <div className="flex flex-wrap gap-1.5">
                                        <span className="inline-flex items-center gap-1 bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 px-2 py-0.5 rounded text-xs-custom font-mono">
                                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
                                          {selectedPriceHistory.length} Ticks
                                        </span>
                                        <span className="inline-flex items-center gap-1 bg-muted text-muted-foreground border border-border px-2 py-0.5 rounded text-xs-custom font-mono">
                                          Last: ${(selectedBot.stats?.lastPrice ?? 0).toFixed(6)}
                                        </span>
                                      </div>
                                    </div>

                                    {/* Trade Data */}
                                    <div className="rounded-lg bg-muted/30 border border-border p-3 space-y-2">
                                      <div className="flex items-center gap-1.5">
                                        <Activity className="h-3 w-3 text-purple-400" />
                                        <span className="text-tiny font-bold uppercase text-muted-foreground">Trade History</span>
                                      </div>
                                      <div className="flex flex-wrap gap-1.5">
                                        <span className="inline-flex items-center gap-1 bg-purple-500/10 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded text-xs-custom font-mono">
                                          {selectedBot.recentTrades?.length ?? 0} Trades
                                        </span>
                                        <span className="inline-flex items-center gap-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded text-xs-custom font-mono">
                                          W: {selectedBot.stats?.wins ?? 0}
                                        </span>
                                        <span className="inline-flex items-center gap-1 bg-red-500/10 text-red-400 border border-red-500/30 px-2 py-0.5 rounded text-xs-custom font-mono">
                                          L: {selectedBot.stats?.losses ?? 0}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>

                              {/* Bot Config Card */}
                              <Card className="border-border/30 bg-card">
                                <CardHeader className="p-3 pb-2">
                                  <div className="flex items-center gap-2">
                                    <Settings className="h-4 w-4 text-yellow-400" />
                                    <h3 className="text-xs font-bold text-foreground uppercase">Bot Config</h3>
                                  </div>
                                </CardHeader>
                                <CardContent className="p-3 pt-0">
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {/* Trading Mode */}
                                    <div className="rounded-lg bg-muted/30 border border-border p-3 space-y-2">
                                      <div className="flex items-center gap-1.5">
                                        <SlidersHorizontal className="h-3 w-3 text-yellow-400" />
                                        <span className="text-tiny font-bold uppercase text-muted-foreground">Trading Mode</span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        {selectedBot.tradingMode === "aggressive" ? (
                                          <span className="inline-flex items-center gap-1 bg-gradient-to-r from-purple-500/20 to-cyan-500/20 text-white border border-purple-500/30 px-2 py-0.5 rounded text-xs-custom font-bold">
                                            <BrainCircuit className="h-2.5 w-2.5" />
                                            AI Aggressive {selectedBot.aiAggressiveness ?? selectedBot.aggressiveness ?? 10}%
                                          </span>
                                        ) : (
                                          <span className="inline-flex items-center gap-1 bg-muted text-foreground border border-border px-2 py-0.5 rounded text-xs-custom font-mono">
                                            Fixed {selectedBot.tradeSize ?? 1} SOL
                                          </span>
                                        )}
                                      </div>
                                    </div>

                                    {/* Pattern Settings */}
                                    <div className="rounded-lg bg-muted/30 border border-border p-3 space-y-2">
                                      <div className="flex items-center gap-1.5">
                                        <Settings className="h-3 w-3 text-primary/60" />
                                        <span className="text-tiny font-bold uppercase text-muted-foreground">Pattern Settings</span>
                                      </div>
                                      <div className="flex flex-wrap gap-1">
                                        <span className="inline-flex items-center bg-muted text-muted-foreground border border-border px-1.5 py-0.5 rounded text-tiny font-mono">
                                          Floor: {selectedBot.settings?.floorWindow ?? 20}
                                        </span>
                                        <span className="inline-flex items-center bg-muted text-muted-foreground border border-border px-1.5 py-0.5 rounded text-tiny font-mono">
                                          Spike: {selectedBot.settings?.spikeThreshold ?? 3}%
                                        </span>
                                        <span className="inline-flex items-center bg-muted text-muted-foreground border border-border px-1.5 py-0.5 rounded text-tiny font-mono">
                                          Drop: {selectedBot.settings?.sellDropThreshold ?? 5}%
                                        </span>
                                        <span className="inline-flex items-center bg-muted text-muted-foreground border border-border px-1.5 py-0.5 rounded text-tiny font-mono">
                                          CD: {selectedBot.settings?.cooldownTicks ?? 5}
                                        </span>
                                      </div>
                                    </div>

                                    {/* Wallet */}
                                    <div className="rounded-lg bg-muted/30 border border-border p-3 space-y-2">
                                      <div className="flex items-center gap-1.5">
                                        <Server className="h-3 w-3 text-green-400" />
                                        <span className="text-tiny font-bold uppercase text-muted-foreground">Wallet</span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <span className="inline-flex items-center gap-1 bg-muted text-foreground border border-border px-2 py-0.5 rounded text-xs-custom font-mono">
                                          {selectedBot.walletAddress?.slice(0, 6) ?? '???'}...{selectedBot.walletAddress?.slice(-4) ?? '???'}
                                        </span>
                                        <span className="inline-flex items-center gap-1 bg-green-500/10 text-green-400 border border-green-500/30 px-2 py-0.5 rounded text-xs-custom font-mono">
                                          {(selectedBot.stats?.balanceSOL ?? 0).toFixed(3)} SOL
                                        </span>
                                      </div>
                                    </div>

                                    {/* Strategy */}
                                    <div className="rounded-lg bg-muted/30 border border-border p-3 space-y-2">
                                      <div className="flex items-center gap-1.5">
                                        <BrainCircuit className="h-3 w-3 text-purple-400" />
                                        <span className="text-tiny font-bold uppercase text-muted-foreground">Strategy</span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <span className="inline-flex items-center gap-1 bg-purple-500/10 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded text-xs-custom font-mono capitalize">
                                          {selectedBot.strategyType ?? 'Scalping'}
                                        </span>
                                        {botSettingsChanges[selectedBot?.id] && (
                                          <span className="inline-flex items-center gap-1 bg-gradient-to-r from-purple-600 to-cyan-500 text-white px-2 py-0.5 rounded text-tiny font-bold animate-pulse">
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
                            <div className="relative flex min-h-[950px]">
                              {/* Left Panel (60%) — Scanner + Performance Cards */}
                              <div className="w-[60%] border-r border-border/30 p-2.5 flex flex-col gap-4 h-full">
                                {/* Nova Pulse Self-Optimization — only for scalping-adaptive */}
                                {selectedBot.strategyType === 'scalping-adaptive' && (() => {
                                  const indVals = botIndicators[selectedBot?.id]?.latestValues ?? {};
                                  const vol   = indVals['adaptive_volatility'];
                                  const range = indVals['adaptive_avgRange'];
                                  const sessionCode = indVals['adaptive_session'];

                                  const baseSettings = selectedBot.strategyConfig?.scalping_settings;
                                  const cFW = baseSettings?.floorWindow         ?? selectedBot.settings?.floorWindow         ?? 20;
                                  const cST = baseSettings?.spikeThreshold      ?? selectedBot.settings?.spikeThreshold      ?? 1.0;
                                  const cSD = baseSettings?.sellDropThreshold   ?? selectedBot.settings?.sellDropThreshold   ?? 5.0;
                                  const cTP = baseSettings?.takeProfitThreshold ?? selectedBot.settings?.takeProfitThreshold ?? 0.10;

                                  const hasData = vol > 0 && range > 0;

                                  const tFW = hasData ? Math.max(10, Math.min(50, Math.round(15 / Math.max(0.1, vol)))) : null;
                                  const tST = hasData ? Math.max(0.05, Math.min(5.0,  parseFloat((2.5 * range).toFixed(2)))) : null;
                                  const tSD = hasData ? Math.max(0.5,  Math.min(10.0, parseFloat((2.0 * range).toFixed(2)))) : null;
                                  const tTP = hasData ? Math.max(0.01, Math.min(0.5,  parseFloat((range * 2.0 / 100).toFixed(3)))) : null;

                                  const activeRules = [
                                    tFW !== null && Math.abs(tFW - cFW) > 2,
                                    tST !== null && Math.abs(tST - cST) > 0.05,
                                    tSD !== null && Math.abs(tSD - cSD) > 0.10,
                                    tTP !== null && Math.abs(tTP - cTP) > 0.005,
                                  ].filter(Boolean).length;

                                  const sessionName = ({ 1: 'Asia', 2: 'London', 3: 'NY', 4: 'Overlap', 5: 'Other' } as Record<number, string>)[sessionCode] ?? '—';

                                  const reason = !hasData
                                    ? 'Warming up — awaiting market signal data'
                                    : vol > 1.5
                                      ? 'High volatility — floor window compressed, thresholds raised to filter noise'
                                      : vol < 0.3
                                        ? 'Dead market — widening floor window, lowering entry bar'
                                        : range > 3.0
                                          ? 'Wide tick range — spike & sell-drop thresholds elevated'
                                          : range < 0.2
                                            ? 'Tick range very tight — all thresholds approaching floor'
                                            : activeRules === 0
                                              ? 'Converged — all parameters at optimal market-calibrated targets'
                                              : `${activeRules} rule${activeRules > 1 ? 's' : ''} converging toward market-calibrated targets`;

                                  const pressure = !hasData ? 0 : Math.min(100, Math.round(
                                    ((tFW ? Math.abs(tFW - cFW) / 20 : 0)
                                    + (tST ? Math.abs(tST - cST) / 2 : 0)
                                    + (tSD ? Math.abs(tSD - cSD) / 5 : 0)
                                    + (tTP ? Math.abs(tTP - cTP) / 0.2 : 0)) / 4 * 100
                                  ));

                                  const pressureColor = pressure === 0 ? 'text-zinc-500'
                                    : pressure < 25 ? 'text-emerald-400'
                                    : pressure < 60 ? 'text-amber-400'
                                    : 'text-rose-400';
                                  const pressureLabel = pressure === 0 ? 'Converged'
                                    : pressure < 25 ? 'Fine-tuning'
                                    : pressure < 60 ? 'Adapting'
                                    : 'Calibrating';
                                  const pressureBadge = pressure === 0
                                    ? 'text-zinc-400 bg-zinc-800 border-zinc-700'
                                    : pressure < 25
                                      ? 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30'
                                      : pressure < 60
                                        ? 'text-amber-400 bg-amber-500/15 border-amber-500/30'
                                        : 'text-rose-400 bg-rose-500/15 border-rose-500/30';

                                  return (
                                    <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/15 p-3 space-y-2.5">
                                      {/* Header */}
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1.5">
                                          <Wand2 className="h-3.5 w-3.5 text-emerald-400/70" />
                                          <span className="text-sm font-bold uppercase text-muted-foreground tracking-wider">Self-Optimization</span>
                                          <span className="text-[10px] font-black uppercase px-1.5 py-0.5 rounded border bg-emerald-500/20 text-emerald-300 border-emerald-500/30">Nova Pulse</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                          {hasData && (
                                            <span className={`text-[10px] font-black uppercase px-1.5 py-0.5 rounded border ${pressureBadge}`}>
                                              {pressureLabel}
                                            </span>
                                          )}
                                          <span
                                            className="text-[10px] font-mono text-muted-foreground cursor-help"
                                            onMouseEnter={(e) => tooltip.show('Anzahl Regeln mit aktiver Konvergenz. Regeln A–D laufen alle 30 Ticks und passen Floor Window, Spike-Schwelle, Sell-Drop und Take-Profit automatisch an.', e)}
                                            onMouseMove={(e) => tooltip.move(e)}
                                            onMouseLeave={() => tooltip.hide()}
                                          >{activeRules}/4 rules active</span>
                                        </div>
                                      </div>

                                      {/* Reason line */}
                                      <div className="text-xs text-muted-foreground/70 italic leading-tight pl-0.5">{reason}</div>

                                      {/* 8-col card grid — single row: market inputs + meta */}
                                      <div className="grid grid-cols-8 gap-1.5">
                                        {/* Vol σ — Rule A + C driver */}
                                        <div
                                          className="rounded bg-muted/30 border border-border/50 p-2 space-y-0.5 cursor-help"
                                          onMouseEnter={(e) => tooltip.show('Tick-zu-Tick-Volatilität (σ). Treibt Regel A (Floor Window) und C (Sell Drop). Hohe Volatilität → kürzeres Fenster, erhöhter Drop-Schwellwert.', e)}
                                          onMouseMove={(e) => tooltip.move(e)}
                                          onMouseLeave={() => tooltip.hide()}
                                        >
                                          <div className="text-[11px] font-bold uppercase text-muted-foreground">Vol σ</div>
                                          <div className={`text-base font-black font-mono ${!hasData ? 'text-zinc-600' : vol > 1.5 ? 'text-rose-400' : vol < 0.3 ? 'text-zinc-400' : 'text-amber-400'}`}>
                                            {hasData ? `${vol.toFixed(2)}%` : '—'}
                                          </div>
                                          <div className="text-[10px] text-muted-foreground/50">A + C input</div>
                                        </div>

                                        {/* Avg Range — Rule B + D driver */}
                                        <div
                                          className="rounded bg-muted/30 border border-border/50 p-2 space-y-0.5 cursor-help"
                                          onMouseEnter={(e) => tooltip.show('Durchschnittliche abs. Tick-Amplitude. Treibt Regel B (Spike-Schwelle) und D (Take-Profit). Breite Range → höhere Einstiegshürde.', e)}
                                          onMouseMove={(e) => tooltip.move(e)}
                                          onMouseLeave={() => tooltip.hide()}
                                        >
                                          <div className="text-[11px] font-bold uppercase text-muted-foreground">Avg Range</div>
                                          <div className={`text-base font-black font-mono ${!hasData ? 'text-zinc-600' : range > 3 ? 'text-rose-400' : range < 0.2 ? 'text-zinc-400' : 'text-cyan-400'}`}>
                                            {hasData ? `${range.toFixed(2)}%` : '—'}
                                          </div>
                                          <div className="text-[10px] text-muted-foreground/50">B + D input</div>
                                        </div>

                                        {/* Session */}
                                        <div
                                          className="rounded bg-muted/30 border border-border/50 p-2 space-y-0.5 cursor-help"
                                          onMouseEnter={(e) => tooltip.show('Aktuelles Handelsfenster. Der adaptive Fork multipliziert die Schwellwerte kontextabhängig — Overlap ist am liquidesten, Asia am ruhigsten.', e)}
                                          onMouseMove={(e) => tooltip.move(e)}
                                          onMouseLeave={() => tooltip.hide()}
                                        >
                                          <div className="text-[11px] font-bold uppercase text-muted-foreground">Session</div>
                                          <div className={`text-base font-black font-mono ${sessionName === 'Overlap' ? 'text-emerald-400' : sessionName === 'NY' || sessionName === 'London' ? 'text-primary' : 'text-zinc-400'}`}>
                                            {sessionName}
                                          </div>
                                          <div className="text-[10px] text-muted-foreground/50">Fork multiplier</div>
                                        </div>

                                        {/* Adapt Pressure */}
                                        <div
                                          className="rounded bg-muted/30 border border-border/50 p-2 space-y-0.5 cursor-help"
                                          onMouseEnter={(e) => tooltip.show('Aggregierter Optimierungsdruck: 0% = alle Parameter konvergiert, 100% = starke Divergenz von Soll-Werten. Blend-Raten verhindern abrupte Sprünge.', e)}
                                          onMouseMove={(e) => tooltip.move(e)}
                                          onMouseLeave={() => tooltip.hide()}
                                        >
                                          <div className="text-[11px] font-bold uppercase text-muted-foreground">Pressure</div>
                                          <div className={`text-base font-black font-mono ${pressureColor}`}>
                                            {hasData ? `${pressure}%` : '—'}
                                          </div>
                                          <div className="text-[10px] text-muted-foreground/50">Adapt intensity</div>
                                        </div>

                                        {/* Floor Window — Rule A */}
                                        <div
                                          className="rounded bg-muted/30 border border-border/50 p-2 space-y-0.5 cursor-help"
                                          onMouseEnter={(e) => tooltip.show(`Regel A — Floor Window. Ziel = round(15 / max(0.1, σ)). Kürzeres Fenster in volatilen Märkten damit der Boden schneller folgt.`, e)}
                                          onMouseMove={(e) => tooltip.move(e)}
                                          onMouseLeave={() => tooltip.hide()}
                                        >
                                          <div className="text-[11px] font-bold uppercase text-muted-foreground">Floor Win</div>
                                          <div className={`text-base font-black font-mono ${tFW !== null && Math.abs(tFW - cFW) > 2 ? 'text-cyan-400' : 'text-foreground'}`}>
                                            {cFW}
                                          </div>
                                          {tFW !== null && Math.abs(tFW - cFW) > 2
                                            ? <div className="text-[10px] text-cyan-300/60">→ {tFW} ticks</div>
                                            : <div className="text-[10px] text-muted-foreground/50">A · optimal</div>
                                          }
                                        </div>

                                        {/* Spike Threshold — Rule B */}
                                        <div
                                          className="rounded bg-muted/30 border border-border/50 p-2 space-y-0.5 cursor-help"
                                          onMouseEnter={(e) => tooltip.show(`Regel B — Spike-Schwelle. Ziel = 2.5 × AvgRange. Asymmetrischer Blend: steigt schnell (20%) wenn Markt lauter wird, fällt langsam (10%) bei Beruhigung.`, e)}
                                          onMouseMove={(e) => tooltip.move(e)}
                                          onMouseLeave={() => tooltip.hide()}
                                        >
                                          <div className="text-[11px] font-bold uppercase text-muted-foreground">Spike Thr.</div>
                                          <div className={`text-base font-black font-mono ${tST !== null && Math.abs(tST - cST) > 0.05 ? 'text-amber-400' : 'text-foreground'}`}>
                                            {cST.toFixed(2)}%
                                          </div>
                                          {tST !== null && Math.abs(tST - cST) > 0.05
                                            ? <div className="text-[10px] text-amber-300/60">→ {tST.toFixed(2)}%</div>
                                            : <div className="text-[10px] text-muted-foreground/50">B · optimal</div>
                                          }
                                        </div>

                                        {/* Sell Drop — Rule C */}
                                        <div
                                          className="rounded bg-muted/30 border border-border/50 p-2 space-y-0.5 cursor-help"
                                          onMouseEnter={(e) => tooltip.show(`Regel C — Sell-Drop. Ziel = 2.0 × AvgRange. Größere Range → mehr Raum bevor Exit, um echte Umkehrungen von Rauschen zu trennen.`, e)}
                                          onMouseMove={(e) => tooltip.move(e)}
                                          onMouseLeave={() => tooltip.hide()}
                                        >
                                          <div className="text-[11px] font-bold uppercase text-muted-foreground">Sell Drop</div>
                                          <div className={`text-base font-black font-mono ${tSD !== null && Math.abs(tSD - cSD) > 0.1 ? 'text-rose-400' : 'text-foreground'}`}>
                                            {cSD.toFixed(2)}%
                                          </div>
                                          {tSD !== null && Math.abs(tSD - cSD) > 0.1
                                            ? <div className="text-[10px] text-rose-300/60">→ {tSD.toFixed(2)}%</div>
                                            : <div className="text-[10px] text-muted-foreground/50">C · optimal</div>
                                          }
                                        </div>

                                        {/* Take Profit — Rule D */}
                                        <div
                                          className="rounded bg-muted/30 border border-border/50 p-2 space-y-0.5 cursor-help"
                                          onMouseEnter={(e) => tooltip.show(`Regel D — Take-Profit. Ziel = AvgRange × 2 / 100. Sehr langsamer Blend (10%) verhindert TP-Whipsawing in schnell wechselnden Märkten.`, e)}
                                          onMouseMove={(e) => tooltip.move(e)}
                                          onMouseLeave={() => tooltip.hide()}
                                        >
                                          <div className="text-[11px] font-bold uppercase text-muted-foreground">Take Profit</div>
                                          <div className={`text-base font-black font-mono ${tTP !== null && Math.abs(tTP - cTP) > 0.005 ? 'text-emerald-400' : 'text-foreground'}`}>
                                            {(cTP * 100).toFixed(1)}%
                                          </div>
                                          {tTP !== null && Math.abs(tTP - cTP) > 0.005
                                            ? <div className="text-[10px] text-emerald-300/60">→ {(tTP * 100).toFixed(1)}%</div>
                                            : <div className="text-[10px] text-muted-foreground/50">D · optimal</div>
                                          }
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })()}

                                <LiveClusterPricePanel selectedBot={selectedBot} selectedTokenInfo={selectedTokenInfo} indicatorValues={botIndicators[selectedBot?.id]?.latestValues} />

                                <div className="grid grid-cols-2 gap-3">

                                  {/* Strategy Config */}
                                  <div className={`bg-muted/30 border-0 p-2.5 rounded-lg flex flex-col gap-1.5 shadow-md justify-between ai-flash-target-${selectedBot?.id}`}>
                                    <div className="flex justify-between items-center gap-1.5">
                                      <span className="flex text-xs font-bold tracking-wider text-foreground uppercase items-center gap-1.5">
                                        Strategy Config
                                      </span>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        {selectedBot?.strategyType && (() => {
                                          const bot = selectedBot;
                                          const st = bot.strategyType;
                                          const sn = bot.strategyConfig?.strategy_name || "";
                                          const si = bot.strategyId || "";

                                          const isSniper = sn?.includes("Sniper") || si.toLowerCase().includes("sniper");
                                          const isRunner = sn?.includes("Breakout") || si.toLowerCase().includes("runner") || si.toLowerCase().includes("breakout");
                                          const isDip = sn?.includes("Dip Buyer") || si.toLowerCase().includes("dip");

                                          let desc = st === 'trend' ? "Trend Strategy: Folgt dem Markttrend für längerfristige Positionen." :
                                            st === 'mean_reversion' ? "Mean Reversion: Setzt auf die Rückkehr zum Durchschnittspreis." :
                                              st === 'breakout' ? "Breakout Strategy: Nutzt massive Ausbrüche aus Preiszonen." :
                                                st === 'momentum' ? "Momentum Strategy: Exploits the speed of price movements." :
                                                  "Scalping Strategy: Exploits small price spikes for quick profits.";

                                          let colorCls = getStrategyColor(st);
                                          let icon = getStrategyIcon(st, "h-2 w-2");
                                          let label = st?.replace('_', ' ').toUpperCase() || 'SCALPING';

                                          if (isSniper || isRunner || isDip) {
                                            desc = sn;
                                            if (isSniper) {
                                              colorCls = "bg-blue-500/20 text-blue-400 border-blue-500/50 shadow-[0_0_8px_rgba(59,130,246,0.3)]";
                                              icon = <Zap className={`animate-pulse h-2 w-2`} />;
                                              label = "Pulse Sniper";
                                            } else if (isRunner) {
                                              colorCls = "bg-orange-500/20 text-orange-400 border-orange-500/50 shadow-[0_0_8px_rgba(249,115,22,0.3)]";
                                              icon = <TrendingUp className={`animate-pulse h-2 w-2`} />;
                                              label = "Asym Runner";
                                            } else if (isDip) {
                                              colorCls = "bg-purple-500/20 text-purple-400 border-purple-500/50 shadow-[0_0_8px_rgba(168,85,247,0.3)]";
                                              icon = <ArrowDown className={`animate-pulse h-2 w-2`} />;
                                              label = "Dip Buyer";
                                            }
                                          }

                                          return (
                                            <span
                                              className={`flex items-center gap-0.5 text-3xs font-bold px-1.5 py-0.5 rounded border cursor-help ${colorCls}`}
                                              onMouseEnter={(e) => tooltip.show(desc, e)}
                                              onMouseMove={(e) => tooltip.move(e)}
                                              onMouseLeave={() => tooltip.hide()}
                                            >
                                              {icon}
                                              {label}
                                            </span>
                                          );
                                        })()}
                                        {botSettingsChanges[selectedBot?.id] ? (
                                          <span className={`flex items-center gap-1 bg-linear-to-r from-purple-600 to-cyan-500 text-white text-3xs font-bold px-1.5 py-0.5 rounded shadow-sm shrink-0 shadow-purple-500/30`}>
                                            <BrainCircuit className="h-2 w-2" /> AI UPDATED · {new Date(botSettingsChanges[selectedBot?.id][0]?.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                          </span>
                                        ) : (
                                          <span
                                            className="flex items-center gap-1 bg-muted text-muted-foreground text-3xs font-bold px-1.5 py-0.5 rounded border border-border cursor-help shrink-0"
                                            onMouseEnter={(e) => tooltip.show("Hier erscheinen KI-gesteuerte Parameter-Updates basierend auf den aktuellen Marktbedingungen.", e)}
                                            onMouseMove={(e) => tooltip.move(e)}
                                            onMouseLeave={() => tooltip.hide()}
                                          >
                                            <BrainCircuit className="h-2 w-2 opacity-50" /> AI STANDBY
                                          </span>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => openBotSettingsPanel(selectedBot)}
                                          className={`p-0.5 rounded transition-colors ${botSettingsPanelId === selectedBot?.id ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                                          title="Bot Settings öffnen"
                                        >
                                          <SlidersHorizontal className="h-3 w-3" />
                                        </button>
                                      </div>

                                    </div>

                                    {/* Dynamic strategy-type-specific params */}
                                    {(() => {
                                      const sType = selectedBot.strategyType ?? 'scalping';
                                      const indVals = botIndicators[selectedBot?.id]?.latestValues ?? {};
                                      const fmt = (v: number | undefined) => v == null || Number.isNaN(v) ? <span className="text-zinc-600 text-tiny">WARM</span> : <span className="text-primary font-mono text-label">{v.toFixed(6)}</span>;
                                      const _pct = (v: number | undefined) => v == null || Number.isNaN(v) ? <span className="text-zinc-600 text-tiny">WARM</span> : <span className="text-primary font-mono text-label">{(v * 100).toFixed(2)}%</span>; void _pct;
                                      const condBadge = (ok: boolean | undefined) => ok === undefined ? null : ok
                                        ? <span className="text-tiny text-emerald-400 font-bold">✓</span>
                                        : <span className="text-tiny text-zinc-600 font-bold">✗</span>;

                                      if (sType === 'scalping' || sType === 'scalping-adaptive' || !selectedBot.strategyType) {
                                        // Fallback to top-level settings for scalping if config not fully populated
                                        const cfg = selectedBot.strategyConfig;
                                        const floor = cfg?.indicators?.find((i) => i.type === 'FLOOR')?.window ?? selectedBot.settings?.floorWindow;
                                        const spike = cfg?.entry_conditions?.find((e) => e.type === 'spike')?.threshold ?? selectedBot.settings?.spikeThreshold;
                                        const drop = cfg?.exit_conditions?.find((e) => e.type === 'drop')?.value ?? selectedBot.settings?.sellDropThreshold;
                                        const cooldown = selectedBot.settings?.cooldownTicks;

                                        return (
                                          <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 mt-1">
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Floor Window</span>
                                              <span className={`text-label font-bold ${botSettingsChanges[selectedBot?.id]?.some(c => c.key === 'floorWindow') ? 'text-cyan-400 animate-pulse' : 'text-primary'}`}>{floor} ticks</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Spike Trigger</span>
                                              <span className={`text-label font-bold ${botSettingsChanges[selectedBot?.id]?.some(c => c.key === 'spikeThreshold') ? 'text-cyan-400 animate-pulse' : 'text-primary'}`}>{spike}% rise</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Sell on Drop</span>
                                              <span className={`text-label font-bold ${botSettingsChanges[selectedBot?.id]?.some(c => c.key === 'sellDropThreshold') ? 'text-cyan-400 animate-pulse' : 'text-primary'}`}>{drop}% fall</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Cooldown</span>
                                              <span className={`text-label font-bold ${botSettingsChanges[selectedBot?.id]?.some(c => c.key === 'cooldownTicks') ? 'text-cyan-400 animate-pulse' : 'text-primary'}`}>{cooldown} ticks</span>
                                            </div>
                                          </div>
                                        );
                                      }

                                      // Helper-Funktion für typsicheres Finden von Indikatoren und Konfigurationswerten
                                      const findIndicator = (
                                        indicators: StrategyConfig['indicators'] | undefined,
                                        type: string,
                                        periodCheck?: (p: number) => boolean
                                      ) => {
                                        return indicators?.find(
                                          (i) => i.type === type && typeof i.period === 'number' && (!periodCheck || periodCheck(i.period))
                                        );
                                      };
                                      
                                      const findEntryCondition = (
                                        conditions: StrategyConfig['entry_conditions'] | undefined,
                                        left: string
                                      ) => {
                                        return conditions?.find((e) => e.left === left && typeof e.right === 'number');
                                      };
                                      
                                      const findExitCondition = (
                                        conditions: StrategyConfig['exit_conditions'] | undefined,
                                        type: string
                                      ) => {
                                        return conditions?.find((e) => e.type === type && typeof e.value === 'number');
                                      };

                                      if (sType === 'trend') {
                                        const cfg = selectedBot.strategyConfig;
                                        
                                        // EMA-Perioden extrahieren (Fast: < 30, Slow: >= 30)
                                        const fastEmaIndicator = findIndicator(cfg?.indicators, 'EMA', (p) => p < EMA_PERIOD_THRESHOLD);
                                        const slowEmaIndicator = findIndicator(cfg?.indicators, 'EMA', (p) => p >= EMA_PERIOD_THRESHOLD);
                                        
                                        const fast = fastEmaIndicator?.period ?? DEFAULT_FAST_EMA;
                                        const slow = slowEmaIndicator?.period ?? DEFAULT_SLOW_EMA;
                                        const rsi = findIndicator(cfg?.indicators, 'RSI')?.period ?? 14;
                                        const rsiMax = findEntryCondition(cfg?.entry_conditions, 'RSI_14')?.right ?? 65;
                                        const tp = findExitCondition(cfg?.exit_conditions, 'take_profit')?.value ?? 0.04;

                                        return (
                                          <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 mt-1">
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Fast EMA</span>
                                              <span className="text-label font-bold text-primary">{fast} periods</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Slow EMA</span>
                                              <span className="text-label font-bold text-primary">{slow} periods</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">RSI Filter</span>
                                              <span className="text-label font-bold text-primary">RSI({rsi}) &lt; {rsiMax}</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Take Profit</span>
                                              <span className="text-label font-bold text-emerald-400">+{(tp * 100).toFixed(0)}%</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Trend Condition</span>
                                              <span className="text-label font-bold text-primary">EMA Cross</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Status</span>
                                              <div className="flex items-center gap-1">
                                                {condBadge(!isNaN(indVals['EMA_20']) && !isNaN(indVals['EMA_50']) ? indVals['EMA_20'] > indVals['EMA_50'] : undefined)}
                                                <span className="text-tiny text-zinc-400">Stable</span>
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      }

                                      if (sType === 'mean_reversion') {
                                        const cfg = selectedBot.strategyConfig;
                                        const rsi = cfg?.indicators?.find((i) => i.type === 'RSI')?.period ?? 14;
                                        const bb = cfg?.indicators?.find((i) => i.type === 'BB')?.period ?? 20;
                                        const std = cfg?.indicators?.find((i) => i.type === 'BB')?.std_dev ?? 2;
                                        const oversold = cfg?.entry_conditions?.find((e) => e.left === 'RSI_14')?.right ?? 32;
                                        const tp = cfg?.exit_conditions?.find((e) => e.type === 'take_profit')?.value ?? 0.035;

                                        return (
                                          <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 mt-1">
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">RSI Period</span>
                                              <span className="text-label font-bold text-primary">{rsi} periods</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Oversold</span>
                                              <span className="text-label font-bold text-emerald-400">RSI &lt; {oversold}</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Bollinger</span>
                                              <span className="text-label font-bold text-primary">{bb}, {std}σ</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Take Profit</span>
                                              <span className="text-label font-bold text-emerald-400">+{(tp * 100).toFixed(1)}%</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">RSI Current</span>
                                              <div className="flex items-center gap-1">
                                                {fmt(indVals['RSI_14'])}
                                                {indVals['RSI_14'] < 30 && <span className="text-3xs text-emerald-400 font-bold animate-pulse">BUY</span>}
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      }

                                      if (sType === 'breakout') {
                                        const cfg = selectedBot.strategyConfig;
                                        const bb = cfg?.indicators?.find((i) => i.type === 'BB')?.period ?? 20;
                                        const rsiMin = cfg?.entry_conditions?.find((e) => e.left === 'RSI_14')?.right ?? 50;
                                        const atr = cfg?.indicators?.find((i) => i.type === 'ATR')?.period ?? 14;
                                        const tp = cfg?.exit_conditions?.find((e) => e.type === 'take_profit')?.value ?? 0.05;

                                        return (
                                          <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 mt-1">
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">BB Breakout</span>
                                              <span className="text-label font-bold text-primary">{bb} periods</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Momentum</span>
                                              <span className="text-label font-bold text-primary">RSI &gt; {rsiMin}</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">ATR Filter</span>
                                              <span className="text-label font-bold text-primary">Period {atr}</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Take Profit</span>
                                              <span className="text-label font-bold text-emerald-400">+{(tp * 100).toFixed(0)}%</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Upper Band</span>
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
                                        const macd = `${cfg?.indicators?.find((i) => i.type === 'MACD')?.fast_period ?? 12}/${cfg?.indicators?.find((i) => i.type === 'MACD')?.slow_period ?? 26}`;
                                        const rsiMax = cfg?.entry_conditions?.find((e) => e.left === 'RSI_14')?.right ?? 70;
                                        const tp = cfg?.exit_conditions?.find((e) => e.type === 'take_profit')?.value ?? 0.045;

                                        return (
                                          <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 mt-1">
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">MACD Fast/Slow</span>
                                              <span className="text-label font-bold text-primary">{macd}</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">RSI Limit</span>
                                              <span className="text-label font-bold text-primary">RSI &lt; {rsiMax}</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Take Profit</span>
                                              <span className="text-label font-bold text-emerald-400">+{(tp * 100).toFixed(1)}%</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Momentum</span>
                                              <div className="flex items-center gap-1">
                                                {condBadge(!isNaN(indVals['MACD_histogram']) ? indVals['MACD_histogram'] > 0 : undefined)}
                                                <span className="text-tiny text-zinc-400">Bullish?</span>
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      }

                                      if (sType === 'paet') {
                                        const cfg = selectedBot.strategyConfig;
                                        const ps = cfg?.paet_settings ?? {};
                                        const vel = indVals['paet_velocity'];
                                        const acc = indVals['paet_acceleration'];
                                        const sigma = indVals['paet_sigma'];
                                        const omega = indVals['paet_omega'];
                                        const period = indVals['paet_period'];
                                        const velColor = !isNaN(vel) ? (vel < 0 ? 'text-red-400' : 'text-emerald-400') : 'text-zinc-500';
                                        const accColor = !isNaN(acc) ? (acc < 0 ? 'text-orange-400' : 'text-zinc-400') : 'text-zinc-500';
                                        return (
                                          <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 mt-1">
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Velocity</span>
                                              <span className={`text-label font-bold font-mono ${velColor}`}>{!isNaN(vel) ? vel.toFixed(6) : '–'}</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Acceleration</span>
                                              <span className={`text-label font-bold font-mono ${accColor}`}>{!isNaN(acc) ? acc.toFixed(6) : '–'}</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Residual σ</span>
                                              <span className="text-label font-bold text-primary">{!isNaN(sigma) && sigma > 0 ? sigma.toFixed(6) : '–'}</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">ω (FA-Penalty)</span>
                                              <span className="text-label font-bold text-amber-400">{!isNaN(omega) ? omega.toFixed(2) : ((ps.false_alarm_penalty_omega ?? 1.50)).toFixed(2)}</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Cycle Period</span>
                                              <span className="text-label font-bold text-primary">{!isNaN(period) && period > 0 ? `${Math.round(period)} c` : '–'}</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Collapse at</span>
                                              <span className="text-label font-bold text-red-400">−{((ps.collapse_threshold_pct ?? 0.25) * 100).toFixed(0)}%</span>
                                            </div>
                                          </div>
                                        );
                                      }

                                      if (sType === 'grid') {
                                        const cfg = selectedBot.strategyConfig;
                                        const levels = cfg?.grid_levels ?? cfg?.risk_management?.max_positions ?? '–';
                                        const posSize = cfg?.risk_management?.position_size ?? 0.05;
                                        const maxPos = cfg?.risk_management?.max_positions ?? '–';
                                        return (
                                          <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 mt-1">
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Grid Levels</span>
                                              <span className="text-label font-bold text-primary">{levels}</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Max Positions</span>
                                              <span className="text-label font-bold text-primary">{maxPos} slots</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Position Size</span>
                                              <span className="text-label font-bold text-primary">{(posSize * 100).toFixed(0)}% bal</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Mode</span>
                                              <span className="text-label font-bold text-zinc-400">Auto Grid</span>
                                            </div>
                                          </div>
                                        );
                                      }

                                      if (sType === 'dca') {
                                        const cfg = selectedBot.strategyConfig;
                                        const rsi = cfg?.indicators?.find((i) => i.type === 'RSI')?.period ?? 14;
                                        const ema = cfg?.indicators?.find((i) => i.type === 'EMA')?.period ?? 100;
                                        const posSize = cfg?.risk_management?.position_size ?? 0.05;
                                        const maxPos = cfg?.risk_management?.max_positions ?? 5;
                                        const tp = cfg?.exit_conditions?.find((e) => e.type === 'take_profit')?.value ?? 0.06;
                                        const sl = cfg?.exit_conditions?.find((e) => e.type === 'stop_loss')?.value ?? 0.05;
                                        const rsiEntry = cfg?.entry_conditions?.find((e) => e.left === 'RSI_14');
                                        const rsiThreshold = rsiEntry ? rsiEntry.right : 40;
                                        return (
                                          <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 mt-1">
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">RSI Period</span>
                                              <span className="text-label font-bold text-primary">{rsi} periods</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">RSI Entry</span>
                                              <span className="text-label font-bold text-primary">RSI &lt; {rsiThreshold}</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">EMA Filter</span>
                                              <span className="text-label font-bold text-primary">EMA {ema}</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Max Positions</span>
                                              <span className="text-label font-bold text-primary">{maxPos} slots</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Position Size</span>
                                              <span className="text-label font-bold text-primary">{(posSize * 100).toFixed(0)}% bal</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Take Profit</span>
                                              <span className="text-label font-bold text-emerald-400">+{(tp * 100).toFixed(0)}%</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Stop Loss</span>
                                              <span className="text-label font-bold text-red-400">−{(sl * 100).toFixed(0)}%</span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-tiny font-bold uppercase text-muted-foreground">Indicators</span>
                                              <span className="text-label font-bold text-primary">RSI + EMA</span>
                                            </div>
                                          </div>
                                        );
                                      }

                                      return null;
                                    })()}

                                    {/* AI Change Details - below settings grid */}
                                    {(() => {
                                      const liveChanges = botSettingsChanges[selectedBot?.id];
                                      const histEntry = [...agentHistory].find(h => h.botId === selectedBot?.id);
                                      const getRegimeBadge = (r: string) => {
                                        const c = r === "RANGING" ? "bg-blue-500/20 text-blue-300 border-blue-500/30" : r === "TRENDING" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : r === "VOLATILE" ? "bg-amber-500/20 text-amber-300 border-amber-500/30" : "bg-red-500/20 text-red-300 border-red-500/30";
                                        return <span className={`text-3xs font-black uppercase tracking-wider px-1 py-0.5 rounded border ${c}`}>{r}</span>;
                                      };
                                      const displayNames: Record<string, string> = { spikeThreshold: "Spike", sellDropThreshold: "Sell Drop", floorWindow: "Floor Win", cooldownTicks: "Cooldown" };
                                      if (liveChanges && liveChanges.length > 0) {
                                        const adv = agentAdvice.find(a => a.botId === selectedBot?.id);
                                        const regime = adv?.advice?.regime;
                                        const conf = adv?.advice?.confidence;
                                        return (
                                          <div className="bg-purple-500/10 border border-purple-500/30 rounded px-2 py-1.5 mt-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
                                            <div className="text-tiny font-bold uppercase tracking-wider mb-1.5 flex items-center justify-between text-purple-400">
                                              <span className="flex items-center gap-1"><BrainCircuit className="h-3 w-3" /> AI Updated</span>
                                              <div className="flex items-center gap-1.5">
                                                {regime && getRegimeBadge(regime)}
                                                {conf !== undefined && <span className="text-3xs font-mono text-purple-300">{(conf * 100).toFixed(0)}%</span>}
                                              </div>
                                            </div>
                                            <div className="space-y-1">
                                              {liveChanges.map((change, idx) => (
                                                <div key={idx} className="flex items-center gap-1.5 text-xs-custom font-mono">
                                                  <span className="text-zinc-400 w-14 shrink-0 truncate font-semibold">{displayNames[change.key] ?? change.key}</span>
                                                  <span className="text-zinc-300 tabular-nums">{change.oldValue}</span>
                                                  <span className="text-zinc-400 text-tiny mx-0.5">→</span>
                                                  <span className="text-cyan-400 font-bold tabular-nums">{change.newValue}</span>
                                                  <span className={`ml-auto text-tiny font-bold px-1 rounded ${change.changePercent > 0 ? "text-green-400 bg-green-500/15" : change.changePercent < 0 ? "text-red-400 bg-red-500/15" : "text-zinc-300 bg-zinc-500/25"}`}>
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
                                            <div className="text-tiny font-bold uppercase tracking-wider mb-1.5 flex items-center justify-between text-purple-400/70">
                                              <span className="flex items-center gap-1"><BrainCircuit className="h-3 w-3" /> Last Run · {ago}m ago</span>
                                              <div className="flex items-center gap-1.5">
                                                {histEntry.regime && getRegimeBadge(histEntry.regime)}
                                                {histEntry.confidence !== undefined && <span className="text-3xs font-mono text-purple-300">{(histEntry.confidence * 100).toFixed(0)}%</span>}
                                              </div>
                                            </div>
                                            <div className="space-y-1">
                                              {keys.map((k, i) => (
                                                <div key={i} className="flex items-center gap-1.5 text-xs-custom font-mono">
                                                  <span className="text-zinc-400 w-14 shrink-0 truncate font-semibold">{displayNames[k] ?? k}</span>
                                                  <span className="text-cyan-400/90 font-bold tabular-nums">{adj[k]}</span>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        );
                                      }
                                      return (
                                        <div
                                          className="border border-zinc-700/50 border-dashed rounded px-2 py-1.5 mt-1.5 bg-zinc-800/30 opacity-60 cursor-help"
                                          onMouseEnter={(e) => tooltip.show("Sobald der KI-Agent aktiv wird, erscheinen hier die Parameter-Updates und das erkannte Marktszenario.", e)}
                                          onMouseMove={(e) => tooltip.move(e)}
                                          onMouseLeave={() => tooltip.hide()}
                                        >
                                          <div className="text-tiny font-bold uppercase tracking-wider mb-1.5 flex items-center justify-between text-zinc-500">
                                            <span className="flex items-center gap-1"><BrainCircuit className="h-3 w-3" /> AI Standby</span>
                                            <div className="flex items-center gap-1.5">
                                              <span className="text-3xs font-black uppercase tracking-wider px-1 py-0.5 rounded border bg-zinc-800 text-zinc-500 border-zinc-700">REGIME</span>
                                              <span className="text-3xs font-mono text-zinc-500">--%</span>
                                            </div>
                                          </div>
                                          <div className="space-y-1 pointer-events-none">
                                            {["Spike", "Sell Drop", "Floor Win", "Cooldown"].map((k, i) => (
                                              <div key={i} className="flex items-center gap-1.5 text-xs-custom font-mono">
                                                <span className="text-zinc-600 w-14 shrink-0 truncate font-semibold">{k}</span>
                                                <span className="text-zinc-700 tabular-nums">-.--</span>
                                                <span className="text-border text-tiny mx-0.5">→</span>
                                                <span className="text-muted-foreground font-bold tabular-nums">-.--</span>
                                                <span className="ml-auto text-tiny font-bold px-1 rounded text-muted-foreground bg-muted/50">
                                                  --.-%
                                                </span>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      );
                                    })()}
                                  </div>

                                  {/* Oracle Analysis */}
                                  <div className="bg-cyan-500/10 border border-cyan-500/20 p-3 rounded-lg flex flex-col gap-2.5 shadow-md justify-between">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="text-xs font-bold text-foreground uppercase flex items-center gap-1.5 shrink-0">
                                        <BrainCircuit className="h-3.5 w-3.5" /> Oracle Analysis
                                      </div>
                                      <button
                                        onClick={() => setIsOracleDialogOpen(true)}
                                        disabled={isTriggering}
                                        onMouseEnter={(e) => tooltip.show(
                                          <div className="space-y-1">
                                            <div className="font-semibold text-cyan-300 flex items-center gap-1.5">
                                              <Zap className="h-3 w-3" /> Trigger Oracle Analysis
                                            </div>
                                            <div className="text-muted-foreground text-sm-custom leading-relaxed">
                                              Immediately starts an AI analysis cycle for this bot.
                                            </div>
                                            <div className="text-muted-foreground/70 text-xs-custom pt-0.5 border-t border-border/30 mt-1">
                                              Normal duty cycle: every 21 minutes
                                            </div>
                                          </div>
                                          , e, { maxWidth: 320 })}
                                        onMouseMove={(e) => tooltip.move(e)}
                                        onMouseLeave={() => tooltip.hide()}
                                        className="flex items-center gap-1.5 text-sm-custom font-bold px-3 py-1.5 rounded-md bg-cyan-500/25 hover:bg-cyan-500/40 text-cyan-200 hover:text-white border border-cyan-500/40 hover:border-cyan-400/70 transition-all disabled:opacity-40 cursor-pointer shrink-0 shadow-sm hover:shadow-cyan-500/20"
                                      >
                                        {isTriggering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                                        {isTriggering ? "Analyzing…" : "Run Analysis"}
                                      </button>
                                    </div>
                                    {(() => {
                                      const latestSse = agentAdvice.find((a) => a.botId === selectedBot?.id);
                                      const latestHist = agentHistory.find((h) => h.botId === selectedBot?.id && h.regime !== 'ERROR' && h.regime !== 'SKIPPED');
                                      const isAppliedValue = (v: boolean | number | undefined) => v === true || v === 1;
                                      const latestAdviceData = latestSse?.advice
                                        ? { ...latestSse.advice, applied: latestSse.applied }
                                        : (latestHist ? {
                                            regime: latestHist.regime,
                                            confidence: latestHist.confidence,
                                            reason: latestHist.reason,
                                            analysis: latestHist.analysis,
                                            applied: isAppliedValue(latestHist.applied),
                                          } : null);
                                      if (latestAdviceData) {
                                        const { regime, confidence, reason, analysis, applied } = latestAdviceData;
                                        const isApplied = isAppliedValue(applied);
                                        const regimeColor = regime === "RANGING" ? "bg-blue-500/25 text-blue-300 border-blue-500/40" : regime === "TRENDING" ? "bg-emerald-500/25 text-emerald-300 border-emerald-500/40" : regime === "VOLATILE" ? "bg-amber-500/25 text-amber-300 border-amber-500/40" : "bg-red-500/25 text-red-300 border-red-500/40";
                                        return (
                                          <>
                                            <div className="flex items-center gap-2">
                                              <span className={`text-xs-custom font-black uppercase tracking-wider px-2 py-1 rounded border shrink-0 ${regimeColor}`}>{regime}</span>
                                              <span className={`text-3xs font-black uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0 ${isApplied ? 'bg-purple-500/20 text-purple-300 border-purple-500/40' : 'bg-zinc-700/50 text-zinc-400 border-zinc-600'}`}>
                                                {isApplied ? 'AI Applied' : 'Analyzed'}
                                              </span>
                                              <div className="flex-1 flex items-center gap-2">
                                                <div className="flex-1 h-[4px] bg-muted/60 rounded-full overflow-hidden">
                                                  <div className="h-full bg-gradient-to-r from-cyan-500 to-cyan-300 rounded-full transition-all duration-500" style={{ width: `${((confidence ?? 0) * 100).toFixed(0)}%` }} />
                                                </div>
                                                <span className="text-sm-custom text-cyan-300 font-mono font-bold tabular-nums">{((confidence ?? 0) * 100).toFixed(0)}%</span>
                                              </div>
                                            </div>
                                            {reason && (
                                              <p
                                                className="text-md-custom text-foreground/80 leading-relaxed truncate cursor-help max-w-full"
                                                onMouseEnter={(e) => tooltip.show(
                                                  <div className="space-y-0.5">
                                                    <div className="font-semibold text-foreground not-italic">Reason</div>
                                                    <div className="text-foreground/80 italic text-sm-custom leading-relaxed">{reason}</div>
                                                  </div>
                                                  , e, { maxWidth: 450 })}
                                                onMouseMove={(e) => tooltip.move(e)}
                                                onMouseLeave={() => tooltip.hide()}
                                              >
                                                <span className="font-semibold text-muted-foreground mr-1">Reason:</span>
                                                {reason}
                                              </p>
                                            )}
                                            {analysis && (
                                              <p
                                                className="text-md-custom leading-relaxed text-cyan-100 line-clamp-2 cursor-help max-w-full"
                                                onMouseEnter={(e) => tooltip.show(
                                                  <div className="space-y-1">
                                                    <div className="font-semibold text-cyan-200 flex items-center gap-1.5">
                                                      <BrainCircuit className="h-3 w-3" /> Analysis
                                                    </div>
                                                    <div className="text-foreground text-sm-custom leading-relaxed whitespace-pre-wrap">{analysis}</div>
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
                                      return <p className="text-sm-custom leading-relaxed italic text-cyan-200/50">Quantum analysis in progress (21 min duty cycle)…</p>;
                                    })()}
                                  </div>

                                  {/* Quick Trade Bar — Mode + Size + BUY / SELL */}
                                  <div className="bg-primary/5 border-0 p-2.5 rounded-lg flex flex-col gap-2 shadow-md">
                                    <div className="text-xs font-bold text-foreground uppercase tracking-wider">Quick Trade</div>

                                    {/* Trading Mode Toggle */}
                                    {(() => {
                                      const setTradingMode = (mode: 'fixed' | 'aggressive') => {
                                        if (!selectedBot?.id) return;
                                        fetch(`${getApiBase()}/api/bots/${selectedBot.id}/config`, {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ tradeSize: selectedBot.tradeSize, aggressiveness: selectedBot.aggressiveness, tradingMode: mode }),
                                        }).then(() => {
                                          setBots(prev => prev.map(b => b.id === selectedBot.id ? { ...b, tradingMode: mode } : b));
                                        });
                                      };
                                      return (
                                        <div className="grid grid-cols-2 gap-1.5">
                                          {([['fixed', 'Fixed SOL'], ['aggressive', 'Aggressive']] as const).map(([mode, label]) => (
                                            <button
                                              key={mode}
                                              type="button"
                                              onClick={() => setTradingMode(mode)}
                                              className={`py-1 rounded text-[10px] font-bold border transition-colors ${selectedBot?.tradingMode === mode ? 'bg-primary/20 border-primary/40 text-primary' : 'bg-muted border-border text-muted-foreground'}`}
                                            >
                                              {label}
                                            </button>
                                          ))}
                                        </div>
                                      );
                                    })()}

                                    {/* Size / Aggressiveness Slider */}
                                    {selectedBot?.tradingMode === 'fixed' ? (
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-bold uppercase text-muted-foreground shrink-0">SOL</span>
                                        <input
                                          type="range" min={0.01} max={10} step={0.01}
                                          value={selectedBot.tradeSize ?? 1}
                                          onChange={async (e) => {
                                            const newSize = parseFloat(e.target.value);
                                            if (selectedBot?.id) {
                                              await fetch(`${getApiBase()}/api/bots/${selectedBot.id}/config`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({
                                                  tradeSize: newSize,
                                                  aggressiveness: selectedBot.aggressiveness,
                                                  tradingMode: 'fixed',
                                                }),
                                              });
                                              setBots(prev => prev.map(b => b.id === selectedBot.id ? { ...b, tradeSize: newSize } : b));
                                            }
                                          }}
                                          className="flex-1 accent-primary"
                                        />
                                        <span className="text-[10px] font-mono font-bold text-primary w-12 text-right">{selectedBot.tradeSize?.toFixed(2)}</span>
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-bold uppercase text-muted-foreground shrink-0">Aggro</span>
                                        <input
                                          type="range" min={1} max={100}
                                          value={selectedBot.aggressiveness ?? 10}
                                          onChange={async (e) => {
                                            const newAggro = parseInt(e.target.value);
                                            if (selectedBot?.id) {
                                              await fetch(`${getApiBase()}/api/bots/${selectedBot.id}/config`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({
                                                  tradeSize: selectedBot.tradeSize,
                                                  aggressiveness: newAggro,
                                                  tradingMode: 'aggressive',
                                                }),
                                              });
                                              setBots(prev => prev.map(b => b.id === selectedBot.id ? { ...b, aggressiveness: newAggro } : b));
                                            }
                                          }}
                                          className="flex-1 accent-primary"
                                        />
                                        <span className="text-[10px] font-mono font-bold text-primary w-12 text-right">{selectedBot.aggressiveness}%</span>
                                      </div>
                                    )}

                                    {/* BUY / SELL Buttons */}
                                    <div className="grid grid-cols-2 gap-2">
                                      <button
                                        className="flex items-center justify-center gap-1.5 bg-green-500/20 hover:bg-green-500/30 border border-green-500/40 text-green-400 rounded-md py-1.5 px-3 text-xs font-bold uppercase tracking-wide transition-all active:scale-95 disabled:opacity-50"
                                        disabled={!selectedBot?.stats?.lastPrice}
                                        onClick={async () => {
                                          if (!selectedBot?.id || !selectedBot?.stats?.lastPrice) return;
                                          try {
                                            await fetch(`${getApiBase()}/api/bots/${selectedBot.id}/trade`, {
                                              method: 'POST',
                                              headers: { 'Content-Type': 'application/json' },
                                              body: JSON.stringify({ action: 'BUY', price: selectedBot.stats.lastPrice }),
                                            });
                                          } catch (err) { console.error(err); }
                                        }}
                                      >
                                        <TrendingUp className="h-3.5 w-3.5" />
                                        Buy
                                      </button>
                                      <button
                                        className="flex items-center justify-center gap-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-400 rounded-md py-1.5 px-3 text-xs font-bold uppercase tracking-wide transition-all active:scale-95 disabled:opacity-50"
                                        disabled={!selectedBot?.stats?.lastPrice}
                                        onClick={async () => {
                                          if (!selectedBot?.id || !selectedBot?.stats?.lastPrice) return;
                                          try {
                                            await fetch(`${getApiBase()}/api/bots/${selectedBot.id}/trade`, {
                                              method: 'POST',
                                              headers: { 'Content-Type': 'application/json' },
                                              body: JSON.stringify({ action: 'SELL', price: selectedBot.stats.lastPrice }),
                                            });
                                          } catch (err) { console.error(err); }
                                        }}
                                      >
                                        <TrendingDown className="h-3.5 w-3.5" />
                                        Sell
                                      </button>
                                    </div>
                                  </div>

                                  {/* Engine Status */}
                                  <div className="p-2.5 bg-muted/20 border-0 rounded-lg flex flex-col gap-1.5 shadow-md justify-between">
                                    <div className="flex justify-between items-center">
                                      <div className="text-xs font-bold text-foreground uppercase tracking-wider">Engine Status</div>
                                      <Activity className="h-2.5 w-2.5 text-primary animate-pulse" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 mt-0.5">
                                      <div className="flex flex-col">
                                        <span className="text-tiny font-bold uppercase text-muted-foreground">Price Ticks</span>
                                        <span className="text-label font-bold">{selectedBot.totalTicks || 0}</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-tiny font-bold uppercase text-muted-foreground">Sync State</span>
                                        <span className="text-label font-bold text-green-400">Synced</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-tiny font-bold uppercase text-muted-foreground">Buffer Fill</span>
                                        <span className="text-label font-bold">{Math.min(selectedBot.totalTicks || 0, selectedBot.settings?.floorWindow || 20)}/{selectedBot.settings?.floorWindow || 20}</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-tiny font-bold uppercase text-muted-foreground">Bot Mode</span>
                                        <button
                                          onClick={async () => {
                                            const newMode = !selectedBot.paperMode;
                                            await fetch(`${getApiBase()}/api/bots/${selectedBot?.id}/paperMode`, {
                                              method: 'PUT',
                                              headers: { 'Content-Type': 'application/json' },
                                              body: JSON.stringify({ paperMode: newMode }),
                                            });
                                          }}
                                          className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-label font-bold transition-all ${selectedBot.paperMode
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

                              {/* Right Panel (40%) — Real-time Activity & Logs */}
                              <div className="absolute left-[60%] right-0 top-0 bottom-0 ml-2 flex flex-col gap-3 overflow-auto pr-2 custom-scrollbar p-2.5">
                                <LastActivityCard bot={selectedBot} />
                                <div className="flex-1 min-h-0">
                                  <LiveFeedListCard
                                    bot={selectedBot}
                                    agentAdvice={agentAdvice.filter(a => a.botId === selectedBot?.id)}
                                    agentHistory={agentHistory.filter(h => h.botId === selectedBot?.id)}
                                    terminalLogs={terminalLogs[selectedBot?.id] ?? []}
                                  />
                                </div>
                              </div>
                            </div>
                          </CardContent>

                          {/* Glass Footer */}
                          <div className="px-6 py-2 border-t border-border/30 bg-transparent flex justify-between items-center text-micro font-mono text-muted-foreground">
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
                          <Card className={`relative overflow-hidden border border-primary/40 bg-card/40 backdrop-blur-md shadow-none transition-all duration-300 rounded-2xl trade-flash-target-${selectedBot?.id} ai-flash-target-${selectedBot?.id}`}>
                            {/* Particle overlay on flash */}
                            {(tradeFlash[selectedBot?.id] || aiFlash[selectedBot?.id]) && (
                              <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-xl">
                                {Array.from({ length: 12 }).map((_, pi) => {
                                  const particleColor = aiFlash[selectedBot?.id]
                                    ? "rgba(168, 85, 247, 0.9)" // purple for AI update
                                    : tradeFlash[selectedBot?.id] === "buy"
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
                            <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-border/30">
                              <TrendingUp className="h-3.5 w-3.5 text-primary" />
                              <span className="text-xs font-semibold tracking-wide text-zinc-300">Trade History</span>
                              <span className="ml-auto text-xs-custom font-mono text-zinc-500">{selectedBot.recentTrades?.length ?? 0} trades</span>
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
                          <Card className={`relative overflow-hidden border border-primary/40 bg-card/40 backdrop-blur-md shadow-none transition-all duration-300 rounded-2xl trade-flash-target-${selectedBot?.id} ai-flash-target-${selectedBot?.id}`}>
                            <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-border/30">
                              <LineChartIcon className="h-3.5 w-3.5 text-primary" />
                              <span className="text-xs font-semibold tracking-wide text-zinc-300">Charts</span>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => setChartTab("equity")}
                                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-2xs font-bold uppercase tracking-wider transition-colors ${
                                    chartTab === "equity"
                                      ? "bg-primary/20 text-primary border border-primary/40"
                                      : "text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent"
                                  }`}
                                >
                                  <TrendingUp className="h-3 w-3" /> Equity
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setChartTab("price")}
                                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-2xs font-bold uppercase tracking-wider transition-colors ${
                                    chartTab === "price"
                                      ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                                      : "text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent"
                                  }`}
                                >
                                  <Activity className="h-3 w-3" /> Price
                                </button>
                              </div>
                              <span className="ml-auto text-xs-custom font-mono text-zinc-500">
                                {chartTab === "equity"
                                  ? `${(selectedBot.recentTrades ?? []).filter((t) => t.action === "SELL" && typeof t.pnlPercent === "number").length} Trades`
                                  : `${selectedPriceHistory.length} Ticks`}
                              </span>
                            </div>
                            <div className="h-[280px] p-1">
                              {chartTab === "equity" ? (
                                <EquityCurveChart
                                  trades={(selectedBot.recentTrades ?? []).map((t) => ({
                                    botId: selectedBot.id,
                                    timestamp: t.timestamp,
                                    action: t.action,
                                    price: t.price,
                                    pnlPercent: t.pnlPercent ?? null,
                                  }))}
                                  height={272}
                                />
                              ) : (
                                <PriceChart prices={selectedPriceHistory} height={272} />
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
              <div className="space-y-6 w-full">
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
                <div className="flex items-center gap-3 flex-wrap">
                  <Input
                    placeholder="Filter by symbol or name…"
                    value={tokenSearchText}
                    onChange={e => setTokenSearchText(e.target.value)}
                    className="w-56 h-9 text-sm bg-zinc-800/60 border-white/10 text-zinc-100 placeholder:text-zinc-500"
                  />
                  <span className="text-xs text-zinc-500">{filteredSortedTokens.length} / {tokens.length} tokens</span>
                  <div className="ml-auto flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRefreshTokens}
                      disabled={isRefreshingTokens}
                      className="bg-zinc-800/60 border-white/10 text-zinc-400 hover:text-white"
                    >
                      <RefreshCw className={`h-4 w-4 mr-1.5 ${isRefreshingTokens ? "animate-spin" : ""}`} />
                      Refresh
                    </Button>
                    <Button onClick={() => setIsAddTokenDialogOpen(true)}>
                      <Plus className="mr-2 h-4 w-4" /> Add Token
                    </Button>
                  </div>
                </div>

                {/* Token List Table */}
                <Card>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead
                          className="cursor-pointer select-none hover:text-primary transition-colors"
                          onClick={() => handleTokenSort("symbol")}
                        >
                          Symbol{sortIndicator("symbol")}
                        </TableHead>
                        <TableHead
                          className="cursor-pointer select-none hover:text-primary transition-colors"
                          onClick={() => handleTokenSort("name")}
                        >
                          Name{sortIndicator("name")}
                        </TableHead>
                        <TableHead>Mint Address</TableHead>
                        <TableHead
                          className="text-right cursor-pointer select-none hover:text-primary transition-colors"
                          onClick={() => handleTokenSort("price")}
                        >
                          Price{sortIndicator("price")}
                        </TableHead>
                        <TableHead
                          className="text-right cursor-pointer select-none hover:text-primary transition-colors"
                          onClick={() => handleTokenSort("volume")}
                        >
                          24h Volume{sortIndicator("volume")}
                        </TableHead>
                        <TableHead
                          className="text-right cursor-pointer select-none hover:text-primary transition-colors"
                          onClick={() => handleTokenSort("change")}
                        >
                          24h Change{sortIndicator("change")}
                        </TableHead>
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
                      ) : filteredSortedTokens.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                            No tokens match your filter.
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredSortedTokens.map((token) => (
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
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-primary hover:text-primary/80 hover:bg-primary/10"
                                  onClick={() => {
                                    setNewBotMintAddress(token.mintAddress);
                                    setIsCreateBotDialogOpen(true);
                                  }}
                                >
                                  <Bot className="h-3.5 w-3.5 mr-1" />
                                  Add Bot
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                  onClick={() => handleRemoveToken(token.mintAddress)}
                                >
                                  Remove
                                </Button>
                              </div>
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
                            placeholder="Enter Solana mint address (e.g., So11111111111111111111111111111111111111112)"
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
              <div className="space-y-6 animate-in fade-in duration-300 w-full">
                {/* Einheitlicher Header */}
                <div className="flex items-center gap-3 mb-6">
                  <Puzzle className="h-8 w-8 text-primary" />
                  <div>
                    <h1 className="text-3xl font-bold tracking-tighter">Strategien</h1>
                    <p className="text-muted-foreground mt-1">Strategy Management — Templates, eigene Strategien, JSON-Editor</p>
                  </div>
                </div>

                {/* Sub-Tab Bar */}
                <SubTabs
                  tabs={[
                    { id: "templates", label: "Templates" },
                    { id: "saved", label: "Gespeichert" },
                    { id: "editor", label: "Neu erstellen" },
                  ]}
                  active={strategySubTab}
                  onChange={setStrategySubTab}
                />

                {strategySubTab === "templates" && (
                  <div className="space-y-4">
                    {/* Filter chips */}
                    <div className="flex flex-wrap gap-2">
                      {["all", "scalping", "scalping-adaptive", "trend", "mean_reversion", "breakout", "momentum", "dca", "grid", "ml", "paet"].map(f => (
                        <button key={f} onClick={() => setStrategyFilter(f)}
                          className={`px-3 py-1 rounded-full text-sm-custom font-semibold border transition-colors ${strategyFilter === f ? "bg-primary/20 border-primary text-primary" : "border-zinc-700 text-zinc-400 hover:border-zinc-500"}`}>
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
                                <span className={`flex items-center gap-1 text-xs-custom font-bold px-2 py-0.5 rounded border ${getStrategyColor(t.strategy_type)}`}>
                                  {getStrategyIcon(t.strategy_type, "h-2.5 w-2.5")}
                                  {t.strategy_type}
                                </span>
                              </div>
                              {t.description && <p className="text-sm-custom text-zinc-500">{t.description}</p>}
                              <div className="flex flex-wrap gap-1">
                                {t.indicators?.map((ind) => (
                                  <span key={`${ind.type}_${ind.period ?? ''}`} className="text-xs-custom bg-muted text-muted-foreground border border-border px-1.5 py-0.5 rounded font-mono">
                                    {ind.type}{ind.period ? `(${ind.period})` : ""}
                                  </span>
                                ))}
                              </div>
                              <div className="flex items-center justify-between pt-1 border-t border-border/30">
                                <p className="text-xs-custom text-zinc-600">Zuweisung beim Bot-Erstellen</p>
                                <button
                                  className="text-sm-custom px-3 py-1 rounded bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 font-semibold transition-colors"
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
                                <span className={`flex items-center gap-1 text-xs-custom font-bold px-2 py-0.5 rounded border ${getStrategyColor(s.strategy_type)}`}>
                                  {getStrategyIcon(s.strategy_type, "h-2.5 w-2.5")}
                                  {s.strategy_type}
                                </span>
                              </div>
                              <div className="flex gap-2 mt-2">
                                <button
                                  className="text-sm-custom px-3 py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700"
                                  onClick={() => {
                                    setStrategyEditorJson(JSON.stringify(s, null, 2));
                                    setStrategySubTab("editor");
                                  }}
                                >Bearbeiten</button>
                                <button
                                  className="text-sm-custom px-3 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30"
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
                      <p className="text-sm-custom text-zinc-500">Definiere eine Strategie im JSON-Format. Pflichtfelder: strategy_name, strategy_type, market, indicators, entry_conditions, exit_conditions, risk_management, execution.</p>
                      <textarea
                        rows={20}
                        className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs font-mono text-zinc-200 focus:outline-none focus:border-primary/50 resize-none"
                        placeholder={`{\n  "strategy_name": "Meine Strategie",\n  "strategy_type": "trend",\n  "market": { "symbol": "SOL/USDC", "timeframe": "5m", "exchange": "solana" },\n  "indicators": [{ "type": "EMA", "period": 20 }, { "type": "EMA", "period": 50 }],\n  "entry_conditions": [{ "left": "EMA_20", "operator": ">", "right": "EMA_50" }],\n  "exit_conditions": [{ "type": "take_profit", "value": 0.05 }, { "type": "stop_loss", "value": 0.02 }],\n  "risk_management": { "position_size": 0.1, "max_positions": 1, "leverage": 1 },\n  "execution": { "order_type": "market", "slippage_tolerance": 0.001 }\n}`}
                        value={strategyEditorJson}
                        onChange={(e) => {
                          setStrategyEditorJson(e.target.value);
                          setStrategyEditorError("");
                          setStrategyEditorValid(false);
                        }}
                      />
                      {strategyEditorError && <p className="text-sm-custom text-red-400">{strategyEditorError}</p>}
                      {strategyEditorValid && <p className="text-sm-custom text-emerald-400">✓ JSON valid</p>}
                    </div>

                    {/* Optional: Custom System Prompt for this strategy */}
                    <div className="space-y-2">
                      <Label className="text-xs font-bold uppercase text-zinc-400">System Prompt (optional)</Label>
                      <p className="text-sm-custom text-zinc-500">
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
              // STRATEGY ASSISTANT (3 SUBTABS: Advisor · Assistant · Self-Correction)
              <div className="space-y-6 w-full">
                {/* Subtab bar: Smart Advisor | Assistant | Self-Correction */}
                <SubTabs
                  tabs={[
                    { id: "advisor",        label: "Smart Advisor",   icon: Wand2       },
                    { id: "assistant",      label: "Assistant",       icon: BrainCircuit },
                    { id: "selfcorrection", label: "Self-Correction", icon: Puzzle      },
                  ]}
                  active={assistantSubTab}
                  onChange={setAssistantSubTab}
                />

                {/* Smart Advisor subtab */}
                {assistantSubTab === "advisor" && (
                  <AdvisorTab
                    onCreateFromAdvisor={handleCreateFromAdvisor}
                    suggestions={advisorSuggestions}
                    history={advisorHistory}
                    loading={advisorLoading}
                    error={advisorError}
                    fetchedAt={advisorFetchedAt}
                    onRefresh={() => fetchAdvisorSuggestions(true)}
                  />
                )}

                {/* Assistant subtab header */}
                {assistantSubTab === "assistant" && (
                <>
                <div className="flex items-center gap-3">
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
                    onClick={() => triggerAgentAnalysis()}
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
                          onChange={(e) => agentConfig && updateAgentConfig({ ...agentConfig, provider: e.target.value as 'ollama' | 'opencode' })}
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
                          <span className={`text-xs-custom font-bold px-2 py-0.5 rounded border ${assistentPromptInfo.source === 'custom' ? 'bg-purple-500/20 text-purple-300 border-purple-500/30' :
                            assistentPromptInfo.source === 'strategy' ? 'bg-blue-500/20 text-blue-300 border-blue-500/30' :
                              'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'
                            }`}>
                            {assistentPromptInfo.source === 'custom' ? '✎ Eigener Prompt' :
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
                                <span className={`px-2 py-1 rounded text-xs font-bold ${entry.regime === 'RANGING' ? 'bg-blue-500/20 text-blue-400' :
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
                                <span className={`text-xs font-bold ${((entry.confidence ?? 0) * 100) >= 70 ? 'text-green-500' :
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
                                  <span className={`text-xs font-mono px-1.5 py-0.5 rounded border ${entry.outcomeTotalPnl !== undefined && entry.outcomeTotalPnl / entry.outcomeTradeCount >= 0
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
                </>
                )}

                {/* Self-Correction subtab content (component renders its own header) */}
                {assistantSubTab === "selfcorrection" && (
                  <SelfCorrectionInsightsTab bots={bots} getApiBase={getApiBase} />
                )}
              </div>
            ) : activeTab === "wallet" ? (
              // WALLET VIEW (ADR-015)
              <WalletPage onNavigateToSettings={(sub) => { setSettingsInitialTab(sub); setActiveTab("settings"); }} />
            ) : activeTab === "docs" ? (
              // DOCS VIEW
              <Documentation />
            ) : activeTab === "settings" ? (
              <GlobalSettings
                theme={theme}
                onThemeChange={setTheme}
                onSaved={(s) => setGlobalSettings((prev) => ({ ...prev, ...s }))}
                onAnimConfigChange={setAnimConfig}
                initialTab={settingsInitialTab}
                onNavigateToWalletTab={() => { setSettingsInitialTab(undefined); setActiveTab("wallet"); }}
              />
            ) : null}
          </div>
        </main>

        {/* Create Bot Dialog — rendered globally so it works from any tab */}
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
          startAfterCreate={newBotAutoStart}
          setStartAfterCreate={setNewBotAutoStart}
          advisorSettings={pendingAdvisorSettings}
          apiBase={getApiBase()}
          onCreateBot={createDemoBot}
        />

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

        {/* ADR-012: Oracle Analysis Aggressiveness Dialog */}
        <OracleAnalysisDialog
          key={isOracleDialogOpen ? "open" : "closed"}
          open={isOracleDialogOpen}
          onOpenChange={setIsOracleDialogOpen}
          bot={selectedBot ?? null}
          latestAdvice={agentAdvice.find((a) => a.botId === selectedBot?.id)?.advice ?? null}
          availableStrategies={[...strategyTemplates, ...savedStrategies]}
          isTriggering={isTriggering}
          initialMultiplier={botSettingsDraft.aggPreset}
          onConfirm={(m) => {
            setIsOracleDialogOpen(false);
            void triggerAgentAnalysis(m);
          }}
        />
      </div>
    </>
  );
}
