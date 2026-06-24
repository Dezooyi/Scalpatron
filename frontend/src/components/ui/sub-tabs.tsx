import type { LucideIcon } from "lucide-react";

export type SubTabItem<T extends string> = {
  id: T;
  label: string;
  icon?: LucideIcon;
};

type Props<T extends string> = {
  tabs: ReadonlyArray<SubTabItem<T>>;
  active: T;
  onChange: (id: T) => void;
  className?: string;
};

export function SubTabs<T extends string>({ tabs, active, onChange, className }: Props<T>) {
  return (
    <div className={`flex gap-1 border-b border-white/5 flex-wrap ${className ?? ""}`}>
      {tabs.map((t) => {
        const Icon = t.icon;
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={`px-4 py-2 text-sm font-bold transition-colors border-b-2 -mb-px whitespace-nowrap inline-flex items-center gap-2 ${
              isActive
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {Icon && <Icon className="h-4 w-4" />}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}