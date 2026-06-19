import { memo } from "react";
import { Check, ChevronDown, Filter, Layers } from "lucide-react";
import type { BotState } from "@/App";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  type PerformanceFilters,
  type TimeframeKey,
  type StatusFilter,
  type ModeFilter,
  type OutcomeFilter,
  TIMEFRAME_LABELS,
  DEFAULT_FILTERS,
} from "@/lib/performanceMetrics";

type FilterBarVariant = "default" | "extended";

interface FilterBarProps {
  filters: PerformanceFilters;
  onChange: (next: PerformanceFilters) => void;
  bots: BotState[];
  tokenSymbol: (mintAddress: string) => string;
  variant?: FilterBarVariant;
}

const TIMEFRAMES: TimeframeKey[] = ["24h", "7d", "30d", "all"];
const STATUSES: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "running", label: "Run" },
  { key: "stopped", label: "Stop" },
  { key: "paused", label: "Pause" },
];
const MODES: { key: ModeFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "paper", label: "Paper" },
  { key: "live", label: "Live" },
];
const OUTCOMES: { key: OutcomeFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "wins", label: "Wins" },
  { key: "losses", label: "Loss" },
];

function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex items-center rounded-md border border-zinc-300/60 dark:border-white/5 bg-white/40 dark:bg-black/20 p-0.5 gap-0.5"
    >
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={`px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-colors ${
              active
                ? "bg-primary text-primary-foreground shadow-[0_0_8px_oklch(from_var(--primary)_l_c_h_/_0.35)]"
                : "text-zinc-700 hover:text-zinc-900 dark:text-zinc-500 dark:hover:text-zinc-200"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function FilterBarBase({ filters, onChange, bots, tokenSymbol, variant = "default" }: FilterBarProps) {
  const isExtended = variant === "extended";
  const strategyOptions = Array.from(
    new Set(bots.map((b) => b.strategyType ?? "scalping").filter(Boolean)),
  ).sort();

  const selectedBotsLabel =
    filters.botIds.length === 0
      ? "All Bots"
      : filters.botIds.length === 1
        ? bots.find((b) => b.id === filters.botIds[0])?.name ?? "1 Bot"
        : `${filters.botIds.length} Bots`;

  const toggleBot = (id: string) => {
    const next = filters.botIds.includes(id)
      ? filters.botIds.filter((x) => x !== id)
      : [...filters.botIds, id];
    onChange({ ...filters, botIds: next });
  };

  const isDefault =
    JSON.stringify(filters) === JSON.stringify(DEFAULT_FILTERS);

  const timeFrameControl = (
    <Segmented<TimeframeKey>
      ariaLabel="Zeitfenster"
      options={TIMEFRAMES.map((k) => ({ key: k, label: TIMEFRAME_LABELS[k] }))}
      value={filters.timeframe}
      onChange={(v) => onChange({ ...filters, timeframe: v })}
    />
  );

  const botSelect = (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-zinc-300/60 dark:border-white/5 bg-white/40 dark:bg-black/20 text-[10px] font-bold text-zinc-800 dark:text-zinc-200 hover:border-zinc-400 dark:hover:border-white/20 transition-colors min-w-[92px] justify-between"
        >
          <span className="truncate">{selectedBotsLabel}</span>
          <ChevronDown className="h-3 w-3 opacity-60 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-64" align="start">
        <div className="p-2 max-h-72 overflow-y-auto custom-scrollbar space-y-0.5">
          {bots.length === 0 && (
            <div className="text-[10px] text-zinc-600 dark:text-zinc-500 px-2 py-1">Keine Bots</div>
          )}
          {bots.map((b) => {
            const active = filters.botIds.includes(b.id);
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => toggleBot(b.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[11px] hover:bg-zinc-200/40 dark:hover:bg-white/5 text-left"
              >
                <span
                  className={`flex items-center justify-center w-3.5 h-3.5 rounded border shrink-0 ${
                    active ? "bg-primary border-primary" : "border-zinc-400 dark:border-white/20"
                  }`}
                >
                  {active && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                </span>
                <span className="font-bold text-primary uppercase shrink-0">
                  {tokenSymbol(b.mintAddress)}
                </span>
                <span className="truncate text-zinc-800 dark:text-zinc-300">{b.name}</span>
              </button>
            );
          })}
        </div>
        {filters.botIds.length > 0 && (
          <div className="border-t border-zinc-300/60 dark:border-white/5 p-1.5">
            <button
              type="button"
              onClick={() => onChange({ ...filters, botIds: [] })}
              className="w-full text-[10px] font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-500 hover:text-primary py-1"
            >
              Auswahl aufheben
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );

  const strategySelect =
    strategyOptions.length > 1 ? (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-zinc-300/60 dark:border-white/5 bg-white/40 dark:bg-black/20 text-[10px] font-bold text-zinc-800 dark:text-zinc-200 hover:border-zinc-400 dark:hover:border-white/20 transition-colors capitalize min-w-[92px] justify-between"
          >
            <Layers className="h-3 w-3 opacity-60 shrink-0" />
            <span className="truncate">
              {filters.strategy === "all" ? "All Strategies" : filters.strategy.replace("_", " ")}
            </span>
            <ChevronDown className="h-3 w-3 opacity-60 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="p-1 w-48" align="start">
          <button
            type="button"
            onClick={() => onChange({ ...filters, strategy: "all" })}
            className={`w-full text-left px-2 py-1.5 rounded text-[11px] capitalize hover:bg-zinc-200/40 dark:hover:bg-white/5 ${
              filters.strategy === "all" ? "text-primary font-bold" : "text-zinc-800 dark:text-zinc-300"
            }`}
          >
            All Strategies
          </button>
          {strategyOptions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange({ ...filters, strategy: s })}
              className={`w-full text-left px-2 py-1.5 rounded text-[11px] capitalize hover:bg-zinc-200/40 dark:hover:bg-white/5 ${
                filters.strategy === s ? "text-primary font-bold" : "text-zinc-800 dark:text-zinc-300"
              }`}
            >
              {s.replace("_", " ")}
            </button>
          ))}
        </PopoverContent>
      </Popover>
    ) : null;

  const resetButton = !isDefault ? (
    <button
      type="button"
      onClick={() => onChange({ ...DEFAULT_FILTERS })}
      className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-[9px] font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-500 hover:text-primary transition-colors"
    >
      <Filter className="h-3 w-3" />
      Reset
    </button>
  ) : null;

  const statusControl = (
    <Segmented<StatusFilter>
      ariaLabel="Status"
      options={STATUSES}
      value={filters.status}
      onChange={(v) => onChange({ ...filters, status: v })}
    />
  );

  const modeControl = (
    <Segmented<ModeFilter>
      ariaLabel="Modus"
      options={MODES}
      value={filters.mode}
      onChange={(v) => onChange({ ...filters, mode: v })}
    />
  );

  const outcomeControl = (
    <Segmented<OutcomeFilter>
      ariaLabel="Ergebnis"
      options={OUTCOMES}
      value={filters.outcome}
      onChange={(v) => onChange({ ...filters, outcome: v })}
    />
  );

  if (isExtended) {
    return (
      <div className="flex flex-wrap items-center gap-2 w-full">
        {timeFrameControl}
        {botSelect}
        {strategySelect}
        {resetButton}
        <span
          aria-hidden="true"
          className="hidden md:inline-block h-5 w-px bg-zinc-300/60 dark:bg-white/10 mx-0.5"
        />
        {statusControl}
        {modeControl}
        {outcomeControl}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 w-full">
      {/* Zeile 1: Zeitfenster + Bot-Auswahl + Reset */}
      <div className="flex flex-wrap items-center gap-2">
        {timeFrameControl}
        {botSelect}
        {strategySelect}
        {resetButton}
      </div>

      {/* Zeile 2: Status / Mode / Outcome */}
      <div className="flex flex-wrap items-center gap-2">
        {statusControl}
        {modeControl}
        {outcomeControl}
      </div>
    </div>
  );
}

export const FilterBar = memo(FilterBarBase);
FilterBar.displayName = "FilterBar";
