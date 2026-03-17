import { getStrategyColor, getStrategyIcon } from "@/lib/botUtils";

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

  return (
    <div className="space-y-3">
      {/* Default chip */}
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
          <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
          Default (Scalping)
        </button>
      </div>

      {/* Template chips */}
      {strategyTemplates.length > 0 && (
        <div>
          <p className="text-[9px] font-bold uppercase text-zinc-600 mb-1.5 tracking-widest">Templates</p>
          <div className="flex flex-wrap gap-2">
            {strategyTemplates.map((t) => {
              const isSelected = selectedId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelect(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-all duration-200 ${
                    isSelected
                      ? "bg-primary/20 border-primary/50 text-primary shadow-[0_0_8px_oklch(from_var(--primary)_l_c_h_/_0.3)]"
                      : "bg-zinc-800/60 border-white/10 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                  }`}
                  title={t.description}
                >
                  {getStrategyIcon(t.strategy_type, "h-3 w-3")}
                  <span>{t.strategy_name}</span>
                  <span className={`text-[8px] px-1 py-0.5 rounded ${getStrategyColor(t.strategy_type)} opacity-80`}>
                    {t.strategy_type}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Saved strategies chips */}
      {savedStrategies.filter((s) => !s.isTemplate).length > 0 && (
        <div>
          <p className="text-[9px] font-bold uppercase text-zinc-600 mb-1.5 tracking-widest">Gespeichert</p>
          <div className="flex flex-wrap gap-2">
            {savedStrategies
              .filter((s) => !s.isTemplate)
              .map((s) => {
                const isSelected = selectedId === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onSelect(s.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-all duration-200 ${
                      isSelected
                        ? "bg-primary/20 border-primary/50 text-primary shadow-[0_0_8px_oklch(from_var(--primary)_l_c_h_/_0.3)]"
                        : "bg-zinc-800/60 border-white/10 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                    }`}
                    title={s.description}
                  >
                    {getStrategyIcon(s.strategy_type, "h-3 w-3")}
                    <span>{s.strategy_name}</span>
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
