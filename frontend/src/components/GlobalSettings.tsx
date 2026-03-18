import { useState, useEffect } from "react";
import { Moon, Sun, CheckCircle, XCircle, AlertTriangle, Settings, Server } from "lucide-react";
import AnimationSettings from "./AnimationSettings";
import DesignSystemSettings from "./DesignSystemSettings";
import type { AnimationConfig } from "@/lib/animationConfig";
import { PageHeader } from "./PageHeader";
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
  spikeThreshold: 0.3,
  sellDropThreshold: 0.15,
  cooldownTicks: 5,
  initialSOL: 10,
  tradeSize: 1,
  aggressiveness: 10,
  tradingMode: "fixed",
  paperMode: true,
};

const LS_API_URL_KEY = "scalpatron_api_url";

type Props = {
  theme: "dark" | "light";
  onThemeChange: (t: "dark" | "light") => void;
  onSaved?: (settings: Partial<GlobalSettingsData>) => void;
  onAnimConfigChange?: (config: AnimationConfig) => void;
};

export default function GlobalSettings({ theme, onThemeChange, onSaved, onAnimConfigChange }: Props) {
  const [settings, setSettings] = useState<GlobalSettingsData>(DEFAULTS);
  const [apiUrl, setApiUrl] = useState(() => localStorage.getItem(LS_API_URL_KEY) ?? "http://localhost:3000");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [connStatus, setConnStatus] = useState<"idle" | "ok" | "error">("idle");
  const [connTesting, setConnTesting] = useState(false);

  function setField<K extends keyof GlobalSettingsData>(
    key: K,
    value: GlobalSettingsData[K]
  ) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  useEffect(() => {
    fetch(`${apiUrl}/api/settings`)
      .then((r) => r.json())
      .then((data) => setSettings({ ...DEFAULTS, ...data }))
      .catch(() => {});
  }, [apiUrl]);

  function handleSave() {
    fetch(`${apiUrl}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    })
      .then(() => {
        setSaveStatus("saved");
        onSaved?.(settings);
        setTimeout(() => setSaveStatus("idle"), 2000);
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

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Einheitlicher Header */}
      <PageHeader
        icon={Settings}
        title="Global Settings"
        description="Platform configuration, trading defaults, and preferences"
      />

      {/* Appearance */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sun className="w-5 h-5" /> Appearance
          </CardTitle>
          <CardDescription>Theme and visual preferences</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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

      {/* API Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="w-5 h-5" /> API Configuration
          </CardTitle>
          <CardDescription>Backend server connection settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="api-url">Backend API URL</Label>
            <div className="flex gap-2">
              <Input
                id="api-url"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder="http://localhost:3000"
              />
              <Button variant="outline" size="sm" onClick={() => {
                localStorage.setItem(LS_API_URL_KEY, apiUrl);
                setSaveStatus("saved");
                setTimeout(() => setSaveStatus("idle"), 2000);
              }}>Save</Button>
            </div>
            <p className="text-sm text-muted-foreground">Current: {apiUrl}</p>
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

      {/* Trading Defaults */}
      <Card>
        <CardHeader>
          <CardTitle>Trading Defaults</CardTitle>
          <CardDescription>Default settings for new bots</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="initialSOL">Initial SOL</Label>
              <Input
                id="initialSOL"
                type="number"
                value={settings.initialSOL}
                onChange={(e) => setField("initialSOL", parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tradeSize">Trade Size (SOL)</Label>
              <Input
                id="tradeSize"
                type="number"
                value={settings.tradeSize}
                onChange={(e) => setField("tradeSize", parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Paper Mode</Label>
              <p className="text-sm text-muted-foreground">Simulated trading without real funds</p>
            </div>
            <Button
              variant={settings.paperMode ? "default" : "outline"}
              size="sm"
              onClick={() => setField("paperMode", !settings.paperMode)}
            >
              {settings.paperMode ? "ON" : "OFF"}
            </Button>
          </div>

          <Button onClick={handleSave} className="w-full">
            Save Settings
            {saveStatus === "saved" && <CheckCircle className="w-4 h-4 ml-2" />}
          </Button>
        </CardContent>
      </Card>

      {/* Design System */}
      <DesignSystemSettings />

      {/* Animation Settings */}
      <AnimationSettings onConfigChange={onAnimConfigChange} />
    </div>
  );
}
