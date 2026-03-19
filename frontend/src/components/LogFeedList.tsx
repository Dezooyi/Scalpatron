import { useState, memo } from "react";
import { Activity } from "lucide-react";
import { useTooltip } from "./GlobalTooltip";

export type BadgeVariant = "blue" | "yellow" | "purple" | "red" | "cyan" | "green";

export interface LogFeedRowData {
  id: string | number;
  timestamp: string;
  badge: { text: string; variant: BadgeVariant };
  mainContent: React.ReactNode;
  rightContent?: React.ReactNode;
  expandedContent?: React.ReactNode;
  /** Linker Akzentstreifen + Hintergrundfarbe */
  accent?: "primary" | "purple" | "green" | "red";
  /** Voller Text für Hover-Tooltip */
  hoverText?: string;
  opacity?: number;
}

const BADGE: Record<BadgeVariant, string> = {
  blue:   "bg-blue-500/10 text-blue-400 border-blue-500/30",
  yellow: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  purple: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  red:    "bg-red-500/10   text-red-400   border-red-500/30",
  cyan:   "bg-cyan-500/10  text-cyan-400  border-cyan-500/30",
  green:  "bg-green-500/10 text-green-400 border-green-500/30",
};

const ACCENT_BG: Record<string, string> = {
  primary: "border-l-2 border-primary bg-muted/40",
  purple:  "border-l-2 border-purple-500 bg-purple-500/10",
  green:   "border-l-2 border-green-500 bg-green-500/5",
  red:     "border-l-2 border-red-500 bg-red-500/5",
};

const LogFeedRow = memo(({ row, isLatest }: { row: LogFeedRowData; isLatest: boolean }) => {
  const [hovered, setHovered] = useState(false);
  const tooltip = useTooltip();

  const accentClass = row.accent
    ? ACCENT_BG[row.accent]
    : isLatest
    ? "border-l-2 border-primary bg-muted/40"
    : "bg-muted/20";

  function handleMouseEnter(e: React.MouseEvent) {
    setHovered(true);
    if (row.hoverText && !row.expandedContent) {
      tooltip.show(
        <>
          <span className="font-mono text-muted-foreground mr-3 text-[11px]">{row.timestamp}</span>
          {row.hoverText}
        </>,
        e
      );
    }
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (row.hoverText && !row.expandedContent) tooltip.move(e);
  }

  function handleMouseLeave() {
    setHovered(false);
    tooltip.hide();
  }

  return (
    <div
      className={`relative flex flex-col gap-1 py-1.5 px-2.5 rounded-md text-micro shadow-sm
        animate-in slide-in-from-top-2 fade-in duration-300 transition-all
        ${accentClass}
        ${hovered ? "scale-[1.015] shadow-lg z-10 bg-muted/60!" : "hover:bg-muted/30"}
      `}
      style={{ opacity: row.opacity ?? 1 }}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="font-mono text-muted-foreground shrink-0 tabular-nums text-[9px]">
          {row.timestamp}
        </span>
        <span className={`text-[8px] font-black px-1.5 py-0.5 rounded shrink-0 border ${BADGE[row.badge.variant]}`}>
          {row.badge.text}
        </span>
        <span className={`flex-1 min-w-0 font-mono text-foreground/80 text-[10px] ${hovered ? "whitespace-normal wrap-break-word" : "truncate"}`}>
          {row.mainContent}
        </span>
        {row.rightContent && (
          <span className="shrink-0 ml-1 text-[10px]">{row.rightContent}</span>
        )}
      </div>

      {row.expandedContent && (
        <div className="ml-[68px]">{row.expandedContent}</div>
      )}
    </div>
  );
});
LogFeedRow.displayName = "LogFeedRow";

export const LogFeedList = memo(({
  rows,
  emptyIcon,
  emptyMessage = "No entries yet.",
  maxItems,
  showFadeGradient = false,
}: {
  rows: LogFeedRowData[];
  emptyIcon?: React.ReactNode;
  emptyMessage?: string;
  maxItems?: number;
  showFadeGradient?: boolean;
}) => {
  const displayed = maxItems ? rows.slice(0, maxItems) : rows;

  if (displayed.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center opacity-20 space-y-3">
        {emptyIcon ?? <Activity className="h-8 w-8 animate-pulse" />}
        <div className="text-micro animate-pulse">{emptyMessage}</div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex flex-col gap-1.5 p-1">
        {displayed.map((row, idx) => (
          <LogFeedRow key={row.id} row={row} isLatest={idx === 0} />
        ))}
      </div>
      {showFadeGradient && (
        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-background to-transparent pointer-events-none" />
      )}
    </div>
  );
});
LogFeedList.displayName = "LogFeedList";
