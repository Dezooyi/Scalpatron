import { getStrategyIcon } from "@/lib/botUtils";

export interface StrategyOption {
  id: string;
  strategy_name: string;
  strategy_type: string;
  description?: string;
  isTemplate?: boolean;
}

interface StrategyChipPickerProps {
  strategyTemplates: StrategyOption[];
  savedStrategies: StrategyOption[];
  selectedId: string;
  onSelect: (id: string) => void;
}

export function StrategyChipPicker({
  strategyTemplates,
  savedStrategies,
  selectedId,
  onSelect,
}: StrategyChipPickerProps) {
  // Default/no-strategy chip
  const defaultSelected = selectedId === "";

  // Highlight Strategies Filter
  const highlightNames = ["Solana Pulse Sniper", "Asymmetric Breakout (Runner)", "Solana V-Shape Dip Buyer"];
  const highlightStrategies = strategyTemplates
    .filter((t) => highlightNames.includes(t.strategy_name))
    .sort((a, b) => highlightNames.indexOf(a.strategy_name) - highlightNames.indexOf(b.strategy_name));
    
  const otherTemplates = strategyTemplates.filter((t) => !highlightNames.includes(t.strategy_name));

  return (
    <div className="space-y-4">
      {/* ── Highlight Solana Strategies ── */}
      {highlightStrategies.length > 0 && (
        <div className="mb-2">
          <p className="text-[9px] font-bold uppercase text-transparent bg-clip-text bg-gradient-to-r from-primary to-purple-400 mb-2 tracking-widest flex items-center gap-1">
            <span className="relative flex h-2 w-2 mr-1">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            Solana High-Yield Optimized
          </p>
          <div className="flex flex-col gap-2">
            {highlightStrategies.map((t) => {
              const isSelected = selectedId === t.id;
              
              const isSniper = t.strategy_name.includes("Sniper");
              const isRunner = t.strategy_name.includes("Breakout");
              
              // Custom colors based on the specific strategy type
              const gradientColor = isSniper 
                ? "from-blue-500/20 to-cyan-400/10 border-blue-500/50 shadow-[0_0_12px_rgba(59,130,246,0.3)] text-blue-400" 
                : isRunner
                  ? "from-orange-500/20 to-amber-400/10 border-orange-500/50 shadow-[0_0_12px_rgba(249,115,22,0.3)] text-orange-400"
                  : "from-purple-500/20 to-fuchsia-400/10 border-purple-500/50 shadow-[0_0_12px_rgba(168,85,247,0.3)] text-purple-400";
                  
              const dimColor = "bg-zinc-800/60 border-white/10 text-zinc-300 hover:border-zinc-400 hover:bg-zinc-800/80";

              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelect(t.id)}
                  className={`relative flex items-center justify-between gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-all duration-300 overflow-hidden ${
                    isSelected ? `bg-gradient-to-r ${gradientColor}` : dimColor
                  }`}
                  title={t.description}
                >
                  {/* Subtle moving background gradient pulse if selected */}
                  {isSelected && (
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full animate-[shimmer_2s_infinite]" />
                  )}
                  
                  <div className="flex items-center gap-2 relative z-10">
                    <div className={`p-1 rounded bg-black/20 ${isSelected ? "animate-pulse" : ""}`}>
                      {getStrategyIcon(t.strategy_type, "h-4 w-4")}
                    </div>
                    <span className="tracking-wide">{t.strategy_name}</span>
                  </div>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded border border-white/10 uppercase tracking-wider relative z-10 ${isSelected ? "bg-black/30" : "bg-black/20"}`}>
                    {t.strategy_type}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Standard / Default ── */}
      <div>
        <p className="text-[9px] font-bold uppercase text-zinc-600 mb-1.5 tracking-widest">Standard</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onSelect("")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-all duration-200 ${
              defaultSelected
                ? "bg-primary/20 border-primary/50 text-primary shadow-[0_0_8px_oklch(from_var(--primary)_l_c_h_/_0.3)]"
                : "bg-zinc-800/60 border-white/10 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${defaultSelected ? 'bg-primary animate-pulse' : 'bg-current opacity-70'}`} />
            Default (Scalping)
          </button>
        </div>
      </div>

      {/* ── Other Templates ── */}
      {otherTemplates.length > 0 && (
        <div>
          <p className="text-[9px] font-bold uppercase text-zinc-600 mb-1.5 tracking-widest mt-3">More Templates</p>
          <select
            className="w-full bg-zinc-800/80 border border-white/10 rounded-md px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-primary/50"
            value={otherTemplates.some((t) => t.id === selectedId) ? selectedId : ""}
            onChange={(e) => onSelect(e.target.value)}
          >
            <option value="" disabled>-- Select Template --</option>
            {otherTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.strategy_name} ({t.strategy_type})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Saved strategies dropdown */}
      {savedStrategies.filter((s) => !s.isTemplate).length > 0 && (
        <div>
          <p className="text-[9px] font-bold uppercase text-zinc-600 mb-1.5 tracking-widest">Saved</p>
          <select
            className="w-full bg-zinc-800/80 border border-white/10 rounded-md px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-primary/50"
            value={savedStrategies.filter((s) => !s.isTemplate).some((s) => s.id === selectedId) ? selectedId : ""}
            onChange={(e) => onSelect(e.target.value)}
          >
            <option value="" disabled>-- Select Saved Strategy --</option>
            {savedStrategies
              .filter((s) => !s.isTemplate)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.strategy_name}{s.strategy_type ? ` (${s.strategy_type})` : ""}
                </option>
              ))}
          </select>
        </div>
      )}
    </div>
  );
}
