import { useState } from "react";
import { Wallet as WalletIcon, Settings as SettingsIcon } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useWalletData } from "@/hooks/useWalletData";
import { WalletSidebar, type WalletSubTab } from "./WalletSidebar";
import { WalletOverview } from "./WalletOverview";
import { WalletBalances } from "./WalletBalances";
import { WalletTransactions } from "./WalletTransactions";
import { WalletBotAssignment } from "./WalletBotAssignment";

const SUB_TABS: { id: WalletSubTab; title: string; subtitle: string }[] = [
  { id: "overview", title: "Wallet Übersicht", subtitle: "Balance, PnL und Aktivität auf einen Blick" },
  { id: "balances", title: "Balances", subtitle: "SOL- und Token-Bestände mit historischer Entwicklung" },
  { id: "transactions", title: "Transaktionen", subtitle: "Alle Käufe und Verkäufe mit Solscan-Links" },
  { id: "bots", title: "Bots-Zuordnung", subtitle: "Welche Bots nutzen diese Wallet" },
];

type SettingsSubTab = "appearance" | "api" | "trading" | "wallet" | "design" | "animation" | "danger";

interface Props {
  onNavigateToSettings?: (sub: SettingsSubTab) => void;
}

export function WalletPage({ onNavigateToSettings }: Props) {
  const data = useWalletData();
  const [subTab, setSubTab] = useState<WalletSubTab>("overview");

  const meta = SUB_TABS.find(t => t.id === subTab) ?? SUB_TABS[0];

  return (
    <div className="space-y-4">
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

      <div className="flex border-b border-white/5 gap-1 overflow-x-auto">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`px-4 py-2 text-sm font-bold transition-colors border-b-2 -mb-px whitespace-nowrap ${
              subTab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.title.replace("Wallet ", "")}
          </button>
        ))}
      </div>

      <div className="flex gap-0 border border-white/5 rounded-lg overflow-hidden bg-card/20 backdrop-blur-sm flex-col md:flex-row">
        <div className="md:hidden border-b border-white/5 p-2">
          <div className="flex gap-1 overflow-x-auto">
            {SUB_TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setSubTab(t.id)}
                className={`px-3 py-1.5 text-xs font-bold rounded whitespace-nowrap ${
                  subTab === t.id ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-white/5"
                }`}
              >
                {t.title.replace("Wallet ", "")}
              </button>
            ))}
          </div>
        </div>
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