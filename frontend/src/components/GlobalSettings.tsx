import { useState, useEffect, useCallback } from "react";
import { Moon, Sun, CheckCircle, XCircle, AlertTriangle, Settings, Trash2, ShieldAlert, Sliders, Wallet as WalletIcon, Sparkles } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import AnimationSettings from "./AnimationSettings";
import DesignSystemSettings from "./DesignSystemSettings";
import type { AnimationConfig } from "@/lib/animationConfig";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { PageHeader } from "./PageHeader";
import { WalletSettingsTab } from "./wallet/WalletSettingsTab";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type GlobalSettingsData = {
  floorWindow: number;
  spikeThreshold: number;
  sellDropThreshold: number;
  cooldownTicks: number;
  initialSOL: number;
  tradeSize: number;
  aggressiveness: number;
  tradingMode: "fixed" | "aggressive";
  paperMode: boolean;
};

const DEFAULTS: GlobalSettingsData = {
  floorWindow: 20,
  spikeThreshold: 3.0,
  sellDropThreshold: 5.0,
  cooldownTicks: 5,
  initialSOL: 10,
  tradeSize: 1,
  aggressiveness: 10,
  tradingMode: "fixed",
  paperMode: true,
};

const LS_API_URL_KEY = "scalpatron_api_url";
const LS_GLOBAL_SETTINGS_KEY = "scalpatron_global_settings";

type SettingsTab = "appearance" | "api" | "trading" | "wallet" | "design" | "animation" | "danger";

type Props = {
  theme: "dark" | "light";
  onThemeChange: (t: "dark" | "light") => void;
  onSaved?: (settings: Partial<GlobalSettingsData>) => void;
  onAnimConfigChange?: (config: AnimationConfig) => void;
  onNavigateToWalletTab?: () => void;
  initialTab?: SettingsTab;
};

export default function GlobalSettings({
  theme,
  onThemeChange,
  onSaved,
  onAnimConfigChange,
  onNavigateToWalletTab,
  initialTab,
}: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab ?? "appearance");
  const [settings, setSettings] = useLocalStorage<GlobalSettingsData>(LS_GLOBAL_SETTINGS_KEY, DEFAULTS);
  const [deleteAllStatus, setDeleteAllStatus] = useState<"idle" | "loading" | "done">("idle");
  const confirm = useConfirm();
  const [apiUrl, setApiUrl] = useLocalStorage<string>(LS_API_URL_KEY, "");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [connStatus, setConnStatus] = useState<"idle" | "ok" | "error">("idle");
  const [connTesting, setConnTesting] = useState(false);

  // Sync activeTab when initialTab changes (e.g. from Dashboard wallet card)
  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(LS_API_URL_KEY);
      if (raw === '"http://localhost:3000"' || raw === "http://localhost:3000") {
        window.localStorage.removeItem(LS_API_URL_KEY);
        setApiUrl("");
      }
    } catch {
      /* ignore */
    }
  }, [setApiUrl]);

  const setField = useCallback(
    <K extends keyof GlobalSettingsData>(
      key: K,
      value: GlobalSettingsData[K]
    ) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
    },
    [setSettings],
  );

  useEffect(() => {
    fetch(`${apiUrl}/api/settings`)
      .then((r) => r.json())
      .then((data) => {
        const merged = { ...DEFAULTS, ...data };
        setSettings(merged);
      })
      .catch(() => { });
  }, [apiUrl, setSettings]);

  function handleSave() {
    fetch(`${apiUrl}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    })
      .then(async (res) => {
        if (res.ok) {
          setSaveStatus("saved");
          onSaved?.(settings);
          setTimeout(() => setSaveStatus("idle"), 2000);
        } else {
          setSaveStatus("error");
        }
      })
      .catch(() => setSaveStatus("error"));
  }

  async function testConnection() {
    setConnTesting(true);
    try {
      const res = await fetch(`${apiUrl}/api/bots`);
      setConnStatus(res.ok ? "ok" : "error");
    } catch {
      setConnStatus("error");
    } finally {
      setConnTesting(false);
      setTimeout(() => setConnStatus("idle"), 3000);
    }
  }

  async function handleDeleteAllBots() {
    const ok = await confirm({
      title: "Delete All Bots",
      message: "This will permanently delete ALL bots and their entire trade history. This cannot be undone.",
      confirmLabel: "Delete All",
      variant: "danger",
    });
    if (!ok) return;
    setDeleteAllStatus("loading");
    try {
      await fetch(`${apiUrl}/api/bots`, { method: "DELETE" });
      setDeleteAllStatus("done");
      setTimeout(() => setDeleteAllStatus("idle"), 2500);
    } catch {
      setDeleteAllStatus("idle");
    }
  }

  const tabs: { id: SettingsTab; label: string; icon: typeof Settings }[] = [
    { id: "appearance", label: "Appearance", icon: Sun },
    { id: "api", label: "API", icon: Settings },
    { id: "trading", label: "Trading", icon: Sliders },
    { id: "wallet", label: "Wallet", icon: WalletIcon },
    { id: "design", label: "Design System", icon: Sparkles },
    { id: "animation", label: "Animation", icon: Sparkles },
    { id: "danger", label: "Danger Zone", icon: ShieldAlert },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        icon={Settings}
        title="Global Settings"
        description="Platform configuration, trading defaults, and preferences"
      />

      {/* Sub-Tab Navigation */}
      <div className="flex gap-1 border-b border-white/5 overflow-x-auto">
        {tabs.map(t => {
          const Icon = t.icon;
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 text-sm font-bold transition-colors border-b-2 -mb-px whitespace-nowrap inline-flex items-center gap-2 ${
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Appearance */}
      {activeTab === "appearance" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sun className="w-5 h-5" /> Appearance
            </CardTitle>
            <CardDescription>Theme and visual preferences</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <Label>Theme</Label>
                <p className="text-sm text-muted-foreground">Toggle between light and dark mode</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => onThemeChange(theme === "dark" ? "light" : "dark")}>
                {theme === "dark" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                <span className="ml-2">{theme === "dark" ? "Light" : "Dark"}</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* API */}
      {activeTab === "api" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" /> API Configuration
            </CardTitle>
            <CardDescription>Backend server connection settings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="api-url">Backend API URL</Label>
              <div className="flex gap-2">
                <Input id="api-url" value={apiUrl} onChange={e => setApiUrl(e.target.value)} placeholder="http://localhost:3000" />
                <Button variant="outline" size="sm" onClick={() => { setSaveStatus("saved"); setTimeout(() => setSaveStatus("idle"), 2000); }}>
                  Save
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">Current: {apiUrl || "(default: Vite proxy)"}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={testConnection} disabled={connTesting}>
                {connTesting ? <AlertTriangle className="w-4 h-4 animate-pulse" /> : <CheckCircle className="w-4 h-4" />}
                <span className="ml-2">Test Connection</span>
              </Button>
              {connStatus === "ok" && <span className="text-sm text-green-500 flex items-center gap-1"><CheckCircle className="w-4 h-4" /> Connected</span>}
              {connStatus === "error" && <span className="text-sm text-red-500 flex items-center gap-1"><XCircle className="w-4 h-4" /> Connection failed</span>}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Trading Defaults */}
      {activeTab === "trading" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sliders className="w-5 h-5" /> Trading Defaults
            </CardTitle>
            <CardDescription>Default settings for new bots (paperMode siehe Wallet-Tab)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="initialSOL">Initial SOL</Label>
                <Input id="initialSOL" type="number" value={settings.initialSOL} onChange={e => setField("initialSOL", parseFloat(e.target.value) || 0)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tradeSize">Trade Size (SOL)</Label>
                <Input id="tradeSize" type="number" value={settings.tradeSize} onChange={e => setField("tradeSize", parseFloat(e.target.value) || 0)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="aggressiveness">Aggressiveness (1-10)</Label>
                <Input id="aggressiveness" type="number" min={1} max={10} value={settings.aggressiveness} onChange={e => setField("aggressiveness", Math.min(10, Math.max(1, parseFloat(e.target.value) || 1)))} />
              </div>
              <div className="space-y-2">
                <Label>Trading Mode</Label>
                <div className="flex gap-2">
                  <Button variant={settings.tradingMode === "fixed" ? "default" : "outline"} size="sm" className="flex-1" onClick={() => setField("tradingMode", "fixed")}>Fixed</Button>
                  <Button variant={settings.tradingMode === "aggressive" ? "default" : "outline"} size="sm" className="flex-1" onClick={() => setField("tradingMode", "aggressive")}>Aggressive</Button>
                </div>
              </div>
            </div>
            <Button onClick={handleSave} className="w-full">
              Save Settings
              {saveStatus === "saved" && <CheckCircle className="w-4 h-4 ml-2" />}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Wallet */}
      {activeTab === "wallet" && (
        <WalletSettingsTab apiBase={apiUrl} onNavigateToWallet={() => onNavigateToWalletTab?.()} />
      )}

      {/* Design System */}
      {activeTab === "design" && <DesignSystemSettings />}

      {/* Animation */}
      {activeTab === "animation" && <AnimationSettings onConfigChange={onAnimConfigChange} />}

      {/* Danger Zone */}
      {activeTab === "danger" && (
        <Card className="border-red-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-400">
              <ShieldAlert className="w-5 h-5" /> Danger Zone
            </CardTitle>
            <CardDescription>Destructive actions — cannot be undone</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Delete All Bots</p>
                <p className="text-sm text-muted-foreground">Permanently removes all bots and their trade history</p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleteAllStatus === "loading"}
                onClick={handleDeleteAllBots}
                className="shrink-0"
              >
                {deleteAllStatus === "loading" ? (
                  <AlertTriangle className="w-4 h-4 mr-2 animate-pulse" />
                ) : deleteAllStatus === "done" ? (
                  <CheckCircle className="w-4 h-4 mr-2" />
                ) : (
                  <Trash2 className="w-4 h-4 mr-2" />
                )}
                {deleteAllStatus === "done" ? "Deleted" : "Delete All Bots"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}