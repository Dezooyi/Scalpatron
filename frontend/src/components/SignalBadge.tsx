import { useTooltip } from "./GlobalTooltip";

export type SignalType = "BUY" | "SELL" | "HOLD";

interface SignalBadgeProps {
  signal: SignalType;
  className?: string;
}

/**
 * Signal Badge Komponente für Last Activity Card
 * Zeigt den aktuellen Bot-Status als pulsierendes Badge
 */
export function SignalBadge({ signal, className = "" }: SignalBadgeProps) {
  const tooltip = useTooltip();

  const getSignalColors = () => {
    switch (signal) {
      case "BUY":
        return "text-green-400 bg-green-500/15 border-green-500/30 animate-pulse-signal-green";
      case "SELL":
        return "text-red-400 bg-red-500/15 border-red-500/30 animate-pulse-signal-red";
      case "HOLD":
      default:
        return "text-zinc-400 bg-zinc-500/15 border-zinc-500/30";
    }
  };

  const getTooltipText = () => {
    switch (signal) {
      case "BUY":
        return "No open position - Bot is ready to buy";
      case "SELL":
        return "Position open - Bot is ready to sell";
      case "HOLD":
        return "Bot is paused or stopped";
      default:
        return "";
    }
  };

  return (
    <span
      className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded border cursor-help ${getSignalColors()} ${className}`}
      onMouseEnter={(e) => tooltip.show(getTooltipText(), e)}
      onMouseMove={(e) => tooltip.move(e)}
      onMouseLeave={() => tooltip.hide()}
    >
      {signal}
    </span>
  );
}
