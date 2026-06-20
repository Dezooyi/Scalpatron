import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Brain, AlertTriangle, Lightbulb, Activity, RefreshCw } from "lucide-react";
import type { BotState } from "@/App";

type TimeWindowPerf = {
  bucket: number;
  tradeCount: number;
  wins: number;
  winRate: number;
  avgPnl: number;
  totalPnl: number;
};

type DriftEntry = {
  bucket: number;
  windowWR: number;
  overallWR: number;
  delta: number;
  sampleSize: number;
};

type Lesson = {
  id: number;
  botId: string;
  createdAt: number;
  category: "time_window" | "regime" | "strategy" | "param_drift" | "streak";
  lesson: string;
  evidence: string | null;
  severity: number;
};

type InsightsPayload = {
  botId: string;
  timeWindows: { hour: TimeWindowPerf[]; weekday: TimeWindowPerf[] };
  drift: { hour: DriftEntry[]; weekday: DriftEntry[] };
  lessons: Lesson[];
  safety: { allowAutoSwitch: boolean; minSwitchConfidence: number };
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const CATEGORY_BADGE: Record<Lesson["category"], string> = {
  time_window: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  regime: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  strategy: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  param_drift: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  streak: "bg-red-500/20 text-red-300 border-red-500/30",
};

export interface SelfCorrectionInsightsTabProps {
  bots: BotState[];
  getApiBase: () => string;
}

export function SelfCorrectionInsightsTab({ bots, getApiBase }: SelfCorrectionInsightsTabProps) {
  const [selectedBot, setSelectedBot] = useState<string>(bots[0]?.id ?? "");
  const [insights, setInsights] = useState<InsightsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedBot && bots.length > 0) setSelectedBot(bots[0].id);
  }, [bots, selectedBot]);

  const loadInsights = useCallback(async () => {
    if (!selectedBot) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${getApiBase()}/api/agent/insights?botId=${encodeURIComponent(selectedBot)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as InsightsPayload;
      setInsights(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load insights");
    } finally {
      setLoading(false);
    }
  }, [selectedBot, getApiBase]);

  useEffect(() => {
    void loadInsights();
  }, [loadInsights]);

  const handleSwitch = async (toStrategyType: string, approved: boolean) => {
    if (!selectedBot) return;
    setConfirming(toStrategyType);
    try {
      const res = await fetch(`${getApiBase()}/api/agent/confirm-switch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId: selectedBot, toStrategyType, approved }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await loadInsights();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply switch");
    } finally {
      setConfirming(null);
    }
  };

  if (bots.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Self-Correction Insights</CardTitle>
          <CardDescription>No bots configured yet.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5" />
                Self-Correction Insights
              </CardTitle>
              <CardDescription>
                Time-window performance, drift alerts and lessons-learned per bot (ADR-011).
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select value={selectedBot} onValueChange={setSelectedBot}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="Select bot" />
                </SelectTrigger>
                <SelectContent>
                  {bots.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" onClick={() => void loadInsights()} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </CardHeader>
        {error && (
          <CardContent>
            <div className="text-sm text-red-400">{error}</div>
          </CardContent>
        )}
      </Card>

      {insights && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <TimeWindowCard title="Per-Hour Win-Rate (UTC)" buckets={insights.timeWindows.hour} kind="hour" />
            <TimeWindowCard title="Per-Weekday Win-Rate (UTC)" buckets={insights.timeWindows.weekday} kind="weekday" />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-yellow-400" />
                Drift Alerts
              </CardTitle>
              <CardDescription>
                Bucket WR deviates by more than the configured threshold from the bot's overall WR.
                Safety gate: auto-switch {insights.safety.allowAutoSwitch ? "ON" : "OFF"} · min confidence {(insights.safety.minSwitchConfidence * 100).toFixed(0)}%.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DriftList hour={insights.drift.hour} weekday={insights.drift.weekday} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-amber-300" />
                Lessons Learned
              </CardTitle>
              <CardDescription>
                Auto-generated recurring patterns the AI agent cites in its reflections.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {insights.lessons.length === 0 ? (
                <div className="text-sm text-muted-foreground">No lessons yet — needs more trade data.</div>
              ) : (
                <ul className="space-y-3">
                  {insights.lessons.map((l) => (
                    <li key={l.id} className="rounded-md border border-border/40 p-3 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={CATEGORY_BADGE[l.category]}>{l.category}</Badge>
                        <Badge variant="outline">severity {(l.severity * 100).toFixed(0)}%</Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(l.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="text-sm leading-relaxed">{l.lesson}</div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-emerald-400" />
                Strategy-Switch Proposals
              </CardTitle>
              <CardDescription>
                Manual confirmation flow for AI-proposed strategy switches (auto-switch is OFF by default).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SwitchPanel
                botId={selectedBot}
                bots={bots}
                onSwitch={handleSwitch}
                confirming={confirming}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function TimeWindowCard({ title, buckets, kind }: { title: string; buckets: TimeWindowPerf[]; kind: "hour" | "weekday" }) {
  const labelFor = (b: number) => (kind === "hour" ? `${String(b).padStart(2, "0")}:00` : (WEEKDAY_LABELS[b] ?? `d${b}`));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>Buckets with at least 5 trades.</CardDescription>
      </CardHeader>
      <CardContent>
        {buckets.length === 0 ? (
          <div className="text-sm text-muted-foreground">Not enough data yet.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{kind === "hour" ? "Hour" : "Day"}</TableHead>
                <TableHead className="text-right">Trades</TableHead>
                <TableHead className="text-right">WR</TableHead>
                <TableHead className="text-right">Avg PnL</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {buckets.map((b) => (
                <TableRow key={b.bucket}>
                  <TableCell>{labelFor(b.bucket)}</TableCell>
                  <TableCell className="text-right">{b.tradeCount}</TableCell>
                  <TableCell className={`text-right ${b.winRate < 40 ? "text-red-400" : b.winRate > 65 ? "text-emerald-400" : ""}`}>
                    {b.winRate}%
                  </TableCell>
                  <TableCell className={`text-right ${b.avgPnl < 0 ? "text-red-400" : "text-emerald-400"}`}>
                    {b.avgPnl.toFixed(2)}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function DriftList({ hour, weekday }: { hour: DriftEntry[]; weekday: DriftEntry[] }) {
  const all = [...hour, ...weekday].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 5);
  if (all.length === 0) {
    return <div className="text-sm text-muted-foreground">No drift alerts.</div>;
  }
  return (
    <ul className="space-y-2">
      {all.map((d, idx) => {
        const negative = d.delta < 0;
        return (
          <li key={idx} className="flex items-center justify-between text-sm border border-border/30 rounded-md p-2">
            <div>
              <span className="font-medium">Bucket {d.bucket}</span>
              <span className="text-muted-foreground ml-2">(n={d.sampleSize})</span>
              <span className="ml-2 text-muted-foreground">
                Why: bot overall {d.overallWR}% · this bucket {d.windowWR}% — {negative ? "underperforming" : "outperforming"}
              </span>
            </div>
            <Badge className={negative ? "bg-red-500/20 text-red-300 border-red-500/30" : "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"}>
              {d.delta > 0 ? "+" : ""}{d.delta}%
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

function SwitchPanel({
  botId,
  bots,
  onSwitch,
  confirming,
}: {
  botId: string;
  bots: BotState[];
  onSwitch: (to: string, approved: boolean) => void;
  confirming: string | null;
}) {
  const bot = bots.find((b) => b.id === botId);
  const currentType = bot?.strategyType ?? "scalping";
  const candidates = ["scalping", "momentum", "mean_reversion", "breakout", "trend", "dca", "grid"].filter((t) => t !== currentType);
  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground">Current strategy: <span className="font-medium text-foreground">{currentType}</span></div>
      <div className="flex flex-wrap gap-2">
        {candidates.map((t) => (
          <div key={t} className="flex gap-1">
            <Button size="sm" disabled={confirming === t} onClick={() => onSwitch(t, true)}>
              Approve → {t}
            </Button>
            <Button size="sm" variant="outline" disabled={confirming === t} onClick={() => onSwitch(t, false)}>
              Reject
            </Button>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Manual switch is independent of AI_ALLOW_STRATEGY_SWITCH (which only gates auto-applied switches).
      </p>
    </div>
  );
}
