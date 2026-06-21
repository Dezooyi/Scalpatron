import { Wand2, RefreshCw, TrendingUp, TrendingDown, Minus, Zap, AlertTriangle, ChevronRight, Clock } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getStrategyIcon, getStrategyColor } from "@/lib/botUtils";
import { formatUsd } from "@/lib/performanceMetrics";

type MarketRegime = 'RANGING' | 'TRENDING_UP' | 'TRENDING_DOWN' | 'VOLATILE' | 'OVERSOLD' | 'DEAD';

export interface AdvisorScalpingSettings {
  cooldownTicks?: number;
  spikeThreshold?: number;
  sellDropThreshold?: number;
  floorWindow?: number;
}

export interface AdvisorSuggestedConfig {
  positionSizePct: number;
  aggressivenessPct: number;
  slippageTolerancePct: number;
  maxPositions: number;
  stopLossPct: number;
  takeProfitPct?: number;
  scalpingSettings?: AdvisorScalpingSettings;
  advisoryOnly: true;
}

export interface AdvisorSuggestion {
  rank: number;
  tokenName: string;
  tokenSymbol: string;
  mintAddress: string;
  poolAddress: string;
  priceUsd: number;
  priceChange1h: number;
  priceChange24h: number;
  volume1h: number;
  volume24h: number;
  liquidity: number;
  templateId: string;
  strategyName: string;
  strategyType: string;
  reasoning: string;
  confidence: number;
  regime: MarketRegime;
  generatedAt: number;
  // Extended fields: concrete bot configuration from the advisor pipeline.
  suggestedConfig?: AdvisorSuggestedConfig;
  diagnostics?: {
    baseScore: number;
    historicalWinRate: number | null;
    historicalSampleSize: number;
    profitFactor: number | null;
    regimeConfidence: number;
    warnings: string[];
  };
}

interface AdvisorTabProps {
  onCreateFromAdvisor: (suggestion: AdvisorSuggestion) => void;
  suggestions: AdvisorSuggestion[];
  history: AdvisorSuggestion[];
  loading: boolean;
  error: string | null;
  fetchedAt: number | null;
  onRefresh: () => void;
}

const REGIME_LABELS: Record<MarketRegime, { label: string; color: string }> = {
  RANGING:      { label: 'Ranging',      color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  TRENDING_UP:  { label: 'Trending ↑',   color: 'bg-green-500/20 text-green-300 border-green-500/30' },
  TRENDING_DOWN:{ label: 'Trending ↓',   color: 'bg-red-500/20 text-red-300 border-red-500/30' },
  VOLATILE:     { label: 'Volatile',     color: 'bg-orange-500/20 text-orange-300 border-orange-500/30' },
  OVERSOLD:     { label: 'Oversold',     color: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  DEAD:         { label: 'Dead',         color: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30' },
};

function PriceChangeBadge({ value, label }: { value: number; label: string }) {
  const positive = value >= 0;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-mono px-1.5 py-0.5 rounded ${positive ? 'text-green-400' : 'text-red-400'}`}>
      {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {label}: {positive ? '+' : ''}{value.toFixed(1)}%
    </span>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 70 ? 'bg-green-500' : pct >= 45 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground font-mono w-8 text-right">{pct}%</span>
    </div>
  );
}


function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  const h = Math.floor(diff / 3_600_000);
  if (diff < 60_000) return 'gerade eben';
  if (m < 60) return `vor ${m} min`;
  if (h < 24) return `vor ${h} h`;
  return `vor ${Math.floor(h / 24)} d`;
}

function SuggestionCard({ s, onCreate, compact = false }: { s: AdvisorSuggestion; onCreate: () => void; compact?: boolean }) {
  const regime = REGIME_LABELS[s.regime] ?? REGIME_LABELS.DEAD;
  const stratIcon = getStrategyIcon(s.strategyType);
  const stratColor = getStrategyColor(s.strategyType);

  if (compact) {
    return (
      <Card className="relative overflow-hidden border-white/10 bg-zinc-900/40 hover:border-white/20 hover:bg-zinc-900/60 transition-colors">
        <CardContent className="p-3 space-y-2">
          {/* Header row */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-bold tracking-tight">{s.tokenSymbol}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${regime.color}`}>{regime.label}</span>
              </div>
              <p className="text-[10px] text-muted-foreground truncate">{s.tokenName}</p>
            </div>
            <div className="text-right shrink-0">
              <PriceChangeBadge value={s.priceChange1h} label="1h" />
              <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1 justify-end">
                <Clock className="h-2.5 w-2.5" />
                {formatTimeAgo(s.generatedAt)}
              </p>
            </div>
          </div>

          {/* Strategy + confidence */}
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-zinc-800/60 border border-white/5">
            <span className={`text-sm ${stratColor}`}>{stratIcon}</span>
            <span className="text-xs font-medium truncate flex-1">{s.strategyName}</span>
            <span className="text-[10px] text-muted-foreground font-mono shrink-0">{Math.round(s.confidence * 100)}%</span>
          </div>

          {/* Stats */}
          <div className="flex gap-2 text-[10px] text-muted-foreground">
            <span>Vol/h: <span className="text-foreground font-mono">{formatUsd(s.volume1h)}</span></span>
            <span className="text-white/10">|</span>
            <span>Liq: <span className="text-foreground font-mono">{formatUsd(s.liquidity)}</span></span>
            <span className="text-white/10">|</span>
            <span><PriceChangeBadge value={s.priceChange24h} label="24h" /></span>
          </div>

          {/* Reasoning */}
          <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-2 border-l border-white/10 pl-1.5">
            {s.reasoning}
          </p>

          {/* CTA */}
          <Button size="sm" variant="outline" className="w-full h-6 text-[10px] gap-1" onClick={onCreate}>
            Bot erstellen <ChevronRight className="h-2.5 w-2.5" />
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="relative overflow-hidden border-white/10 bg-zinc-900/60 hover:border-white/20 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl font-bold tracking-tight">{s.tokenSymbol}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${regime.color}`}>{regime.label}</span>
            </div>
            <p className="text-xs text-muted-foreground truncate max-w-[200px]">{s.tokenName}</p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-sm font-mono text-foreground">
              {s.priceUsd > 0 ? (s.priceUsd < 0.001 ? s.priceUsd.toExponential(3) : `$${s.priceUsd.toFixed(6)}`) : '—'}
            </div>
            <PriceChangeBadge value={s.priceChange1h} label="1h" />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/60 border border-white/5">
          <span className={`text-base ${stratColor}`}>{stratIcon}</span>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Empfohlene Strategie</p>
            <p className="text-sm font-semibold truncate">{s.strategyName}</p>
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Konfidenz</p>
          <ConfidenceBar value={s.confidence} />
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-zinc-800/40 rounded-lg py-1.5 px-2">
            <p className="text-[10px] text-muted-foreground">Vol/h</p>
            <p className="text-xs font-mono font-semibold">{formatUsd(s.volume1h)}</p>
          </div>
          <div className="bg-zinc-800/40 rounded-lg py-1.5 px-2">
            <p className="text-[10px] text-muted-foreground">24h Vol</p>
            <p className="text-xs font-mono font-semibold">{formatUsd(s.volume24h)}</p>
          </div>
          <div className="bg-zinc-800/40 rounded-lg py-1.5 px-2">
            <p className="text-[10px] text-muted-foreground">Liquidity</p>
            <p className="text-xs font-mono font-semibold">{formatUsd(s.liquidity)}</p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed border-l-2 border-white/10 pl-2">
          {s.reasoning}
        </p>

        <div className="flex items-center justify-between pt-1">
          <PriceChangeBadge value={s.priceChange24h} label="24h" />
          <Button size="sm" className="h-7 text-xs gap-1" onClick={onCreate}>
            Bot erstellen <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function AdvisorTab({ onCreateFromAdvisor, suggestions, history, loading, error, fetchedAt, onRefresh }: AdvisorTabProps) {
  const timeAgo = fetchedAt ? formatTimeAgo(fetchedAt) : null;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Wand2 className="h-8 w-8 text-primary shrink-0" />
          <div>
            <h1 className="text-3xl font-bold tracking-tighter">Smart Bot Advisor</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Analysiert die Top Trending Solana Pools und empfiehlt die passende Strategie aus deinem System.
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading} className="gap-2">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Aktualisieren
          </Button>
          {timeAgo && <span className="text-[10px] text-muted-foreground">Zuletzt: {timeAgo}</span>}
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm text-blue-300">
        <Zap className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          Volatilität, Volumen-Momentum und Trendstärke werden gegen alle Strategy-Templates gematcht.
          Ergebnisse werden 5 Minuten gecacht — <strong>Aktualisieren</strong> holt Echtzeit-Daten und verschiebt aktuelle Empfehlungen in die Historie.
        </span>
      </div>

      {/* Loading */}
      {loading && suggestions.length === 0 && (
        <div className="flex items-center justify-center py-24 gap-3 text-muted-foreground">
          <RefreshCw className="h-5 w-5 animate-spin" />
          <span>Analysiere Trending Pools…</span>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium text-sm">Fetch fehlgeschlagen</p>
            <p className="text-xs mt-0.5 text-red-400">{error}</p>
          </div>
        </div>
      )}

      {/* Current suggestions */}
      {suggestions.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">Aktuelle Empfehlungen</h2>
            <span className="text-xs text-muted-foreground bg-white/5 px-2 py-0.5 rounded-full">{suggestions.length}</span>
            {loading && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {suggestions.map(s => (
              <SuggestionCard key={s.mintAddress} s={s} onCreate={() => onCreateFromAdvisor(s)} />
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {!loading && !error && suggestions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <Minus className="h-8 w-8" />
          <p className="text-sm">Keine Empfehlungen gefunden. Klicke Aktualisieren.</p>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-muted-foreground">Letzte Empfehlungen</h2>
            <span className="text-xs text-muted-foreground bg-white/5 px-2 py-0.5 rounded-full">{history.length}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {history.map(s => (
              <SuggestionCard key={s.mintAddress} s={s} compact onCreate={() => onCreateFromAdvisor(s)} />
            ))}
          </div>
        </section>
      )}

      <p className="text-[11px] text-muted-foreground/50 text-center pb-4">
        Keine Finanzberatung. Alle Empfehlungen basieren auf algorithmischer Marktanalyse und dienen nur zu Lernzwecken (Paper-Trading).
      </p>
    </div>
  );
}
