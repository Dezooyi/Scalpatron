import {
  LayoutDashboard,
  Coins,
  Receipt,
  Bot,
  ChevronRight,
  Wallet,
} from "lucide-react";

export type WalletSubTab =
  | "overview"
  | "balances"
  | "transactions"
  | "bots";

interface NavItem {
  id: WalletSubTab;
  label: string;
  description: string;
  icon: typeof Wallet;
}

const ITEMS: NavItem[] = [
  { id: "overview", label: "Übersicht", description: "Balance, PnL, Aktivität", icon: LayoutDashboard },
  { id: "balances", label: "Balances", description: "SOL & Token-Bestände", icon: Coins },
  { id: "transactions", label: "Transaktionen", description: "Alle Käufe & Verkäufe", icon: Receipt },
  { id: "bots", label: "Bots-Zuordnung", description: "Welcher Bot nutzt diese Wallet", icon: Bot },
];

interface Props {
  active: WalletSubTab;
  onSelect: (tab: WalletSubTab) => void;
}

export function WalletSidebar({ active, onSelect }: Props) {
  return (
    <nav className="w-60 shrink-0 border-r border-white/5 bg-card/30 backdrop-blur-md rounded-l-lg p-3 space-y-1">
      <div className="px-2 py-3 mb-2 border-b border-white/5">
        <div className="flex items-center gap-2 text-sm font-bold text-foreground">
          <Wallet className="h-4 w-4 text-primary" />
          <span>Wallet</span>
        </div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
          On-Chain Übersicht
        </p>
      </div>
      {ITEMS.map(item => {
        const Icon = item.icon;
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            className={`w-full flex items-start gap-2 px-3 py-2.5 rounded-md text-left transition-colors group ${
              isActive
                ? "bg-primary/15 text-primary border border-primary/30"
                : "hover:bg-white/5 text-muted-foreground border border-transparent"
            }`}
          >
            <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
            <div className="flex-1 min-w-0">
              <div className={`text-sm font-semibold ${isActive ? "text-primary" : "text-foreground"}`}>
                {item.label}
              </div>
              <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                {item.description}
              </div>
            </div>
            <ChevronRight className={`h-3 w-3 mt-1 ${isActive ? "text-primary" : "text-muted-foreground/40"}`} />
          </button>
        );
      })}
    </nav>
  );
}