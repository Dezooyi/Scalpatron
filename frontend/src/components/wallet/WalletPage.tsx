import { useState } from "react";
import { Wallet as WalletIcon, Settings as SettingsIcon } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useWalletData } from "@/hooks/useWalletData";
import { WalletSidebar, type WalletSubTab } from "./WalletSidebar";
import { WalletOverview } from "./WalletOverview";
import { WalletBalances } from "./WalletBalances";
import { WalletTransactions } from "./WalletTransactions";
import { WalletBotAssignment } from "./WalletBotAssignment";
import { SubTabs, type SubTabItem } from "@/components/ui/sub-tabs";

const SUB_TABS: SubTabItem<WalletSubTab>[] = [
  { id: "overview", label: "Übersicht" },
  { id: "balances", label: "Balances" },
  { id: "transactions", label: "Transaktionen" },
  { id: "bots", label: "Bots-Zuordnung" },
];

const SUB_TAB_META: Record<WalletSubTab, { title: string; subtitle: string }> = {
  overview:     { title: "Wallet Übersicht",      subtitle: "Balance, PnL und Aktivität auf einen Blick" },
  balances:     { title: "Balances",              subtitle: "SOL- und Token-Bestände mit historischer Entwicklung" },
  transactions: { title: "Transaktionen",         subtitle: "Alle Käufe und Verkäufe mit Solscan-Links" },
  bots:         { title: "Bots-Zuordnung",        subtitle: "Welche Bots nutzen diese Wallet" },
};

type SettingsSubTab = "appearance" | "trading" | "wallet" | "animation" | "danger";

interface Props {
  onNavigateToSettings?: (sub: SettingsSubTab) => void;
}

export function WalletPage({ onNavigateToSettings }: Props) {
  const data = useWalletData();
  const [subTab, setSubTab] = useState<WalletSubTab>("overview");

  const meta = SUB_TAB_META[subTab];

  return (
    <div className="space-y-4 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between gap-3">
        <PageHeader icon={WalletIcon} title="Wallet" description="On-Chain Übersicht, Balance-Historie und Transaktionen" />
        {onNavigateToSettings && (
          <button
            onClick={() => onNavigateToSettings("wallet")}
            className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
          >
            <SettingsIcon className="h-3.5 w-3.5" />
            Wallet einrichten
          </button>
        )}
      </div>

      <SubTabs tabs={SUB_TABS} active={subTab} onChange={setSubTab} />

      <div className="flex gap-0 border border-white/5 rounded-lg overflow-hidden bg-card/20 backdrop-blur-sm flex-col md:flex-row">
        <div className="hidden md:block">
          <WalletSidebar active={subTab} onSelect={setSubTab} />
        </div>
        <div className="flex-1 p-4 md:p-6 min-w-0">
          <h2 className="text-lg font-bold text-foreground mb-1">{meta.title}</h2>
          <p className="text-xs text-muted-foreground mb-4">{meta.subtitle}</p>

          {data.error && (
            <div className="mb-4 p-3 rounded bg-red-500/10 border border-red-500/30 text-xs text-red-400">
              Fehler beim Laden: {data.error}
            </div>
          )}

          {subTab === "overview" && <WalletOverview data={data} />}
          {subTab === "balances" && <WalletBalances data={data} />}
          {subTab === "transactions" && <WalletTransactions data={data} />}
          {subTab === "bots" && <WalletBotAssignment data={data} />}
        </div>
      </div>
    </div>
  );
}