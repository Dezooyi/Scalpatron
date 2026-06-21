import { useEffect, useState, useCallback } from "react";
import {
  Wallet as WalletIcon,
  Copy,
  RefreshCw,
  Trash2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  KeyRound,
  Plus,
  Eye,
  EyeOff,
  Zap,
  FlaskConical,
} from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface WalletConfig {
  address: string;
  network: "mainnet" | "devnet";
  rpcUrl: string;
  hasPrivateKey: boolean;
  paperModeDefault: boolean;
  keypairSource: "env" | "generated" | "none";
}

interface Props {
  apiBase: string;
  onNavigateToWallet: () => void;
}

type RpcTestState = { status: "idle" | "testing" | "ok" | "error"; slot?: number; latencyMs?: number; error?: string };

export function WalletSettingsTab({ apiBase, onNavigateToWallet }: Props) {
  const confirm = useConfirm();
  const [config, setConfig] = useState<WalletConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paperMode, setPaperMode] = useState<boolean>(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [privateKeyInput, setPrivateKeyInput] = useState("");
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<"idle" | "working">("idle");
  const [rpcTest, setRpcTest] = useState<RpcTestState>({ status: "idle" });

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/wallet/config`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: WalletConfig = await res.json();
      setConfig(data);
      setPaperMode(data.paperModeDefault);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => { void loadConfig(); }, [loadConfig]);

  const handleCopy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
  };

  const handleSavePaperMode = async () => {
    setSaveStatus("saving");
    try {
      const res = await fetch(`${apiBase}/api/wallet/paper-mode-default`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paperMode }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2500);
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 2500);
    }
  };

  const handleGenerate = async () => {
    const ok = await confirm({
      title: "Neue Wallet generieren?",
      message: "Es wird ein neues Solana-Keypair erzeugt und der Private-Key in .env geschrieben. Eine bestehende Wallet wird unwiderruflich ersetzt!",
      confirmLabel: "Generieren",
      variant: "danger",
    });
    if (!ok) return;
    setActionStatus("working");
    try {
      const res = await fetch(`${apiBase}/api/wallet/setup/generate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Fehler");
      setGeneratedKey(data.privateKeyBase58);
      setShowPrivateKey(true);
      await loadConfig();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionStatus("idle");
    }
  };

  const handleImport = async () => {
    if (!privateKeyInput.trim()) {
      setError("Bitte zuerst einen Private-Key eingeben");
      return;
    }
    const ok = await confirm({
      title: "Private-Key importieren?",
      message: "Der eingegebene Key wird in .env gespeichert. Bestehende Wallet wird ersetzt!",
      confirmLabel: "Importieren",
      variant: "warning",
    });
    if (!ok) return;
    setActionStatus("working");
    try {
      const res = await fetch(`${apiBase}/api/wallet/setup/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ privateKey: privateKeyInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Fehler");
      setPrivateKeyInput("");
      setShowPrivateKey(false);
      await loadConfig();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionStatus("idle");
    }
  };

  const handleClear = async () => {
    const ok = await confirm({
      title: "Private-Key löschen?",
      message: "Der Private-Key wird aus .env entfernt. Live-Trading ist dann nicht mehr möglich bis ein neuer Key importiert wird.",
      confirmLabel: "Löschen",
      variant: "danger",
    });
    if (!ok) return;
    setActionStatus("working");
    try {
      const res = await fetch(`${apiBase}/api/wallet/setup`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadConfig();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionStatus("idle");
    }
  };

  const handleTestRpc = async () => {
    setRpcTest({ status: "testing" });
    try {
      const res = await fetch(`${apiBase}/api/wallet/test-rpc`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setRpcTest({ status: "ok", slot: data.slot, latencyMs: data.latencyMs });
      } else {
        setRpcTest({ status: "error", error: data.error });
      }
    } catch (e: unknown) {
      setRpcTest({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  };

  if (loading && !config) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <RefreshCw className="h-5 w-5 animate-spin mr-2" />
        <span className="text-sm">Wallet-Konfiguration wird geladen…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 rounded bg-red-500/10 border border-red-500/30 text-xs text-red-400 flex items-center gap-2">
          <XCircle className="h-4 w-4 shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-300 hover:text-red-100">×</button>
        </div>
      )}

      {/* Aktuelle Wallet-Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <WalletIcon className="w-5 h-5 text-primary" /> Aktuelle Wallet
          </CardTitle>
          <CardDescription>Primäre Wallet für alle Live-Bots</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {config && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-3 rounded bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10">
                  <div className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Network</div>
                  <span className={`text-sm font-bold ${config.network === "mainnet" ? "text-emerald-400" : "text-amber-400"}`}>
                    {config.network}
                  </span>
                </div>
                <div className="p-3 rounded bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10">
                  <div className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Private Key</div>
                  <span className={`text-sm font-bold ${config.hasPrivateKey ? "text-emerald-400" : "text-amber-400"}`}>
                    {config.hasPrivateKey ? "✓ gesetzt" : "⚠ nicht gesetzt"}
                  </span>
                </div>
                <div className="p-3 rounded bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10">
                  <div className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Source</div>
                  <span className="text-sm font-bold text-foreground">{config.keypairSource}</span>
                </div>
              </div>

              <div>
                <Label>Public Address</Label>
                <div className="flex gap-2 mt-1">
                  <Input value={config.address} readOnly className="font-mono text-xs" />
                  <Button variant="outline" size="icon" onClick={() => handleCopy(config.address)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div>
                <Label>RPC URL</Label>
                <Input value={config.rpcUrl} readOnly className="font-mono text-xs mt-1" />
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={handleTestRpc} disabled={rpcTest.status === "testing"}>
                  {rpcTest.status === "testing" ? (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Zap className="h-4 w-4 mr-2" />
                  )}
                  RPC testen
                </Button>
                {rpcTest.status === "ok" && (
                  <span className="text-xs text-emerald-400 flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    Slot {rpcTest.slot} · {rpcTest.latencyMs}ms
                  </span>
                )}
                {rpcTest.status === "error" && (
                  <span className="text-xs text-red-400 flex items-center gap-1">
                    <XCircle className="h-3 w-3" />
                    {rpcTest.error?.slice(0, 60)}
                  </span>
                )}
                <Button variant="outline" size="sm" onClick={onNavigateToWallet} className="ml-auto">
                  <WalletIcon className="h-4 w-4 mr-2" />
                  Wallet-Tab öffnen
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Trading-Modus */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-primary" /> Trading-Modus
          </CardTitle>
          <CardDescription>Globaler Default für neue Bots</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Paper-Mode Default</Label>
              <p className="text-sm text-muted-foreground">Neue Bots starten im Paper-Mode (kein echtes Kapital)</p>
            </div>
            <Button
              variant={paperMode ? "default" : "outline"}
              size="sm"
              onClick={() => setPaperMode(!paperMode)}
            >
              {paperMode ? "ON (Paper)" : "OFF (Live)"}
            </Button>
          </div>
          <div className="p-3 rounded bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              <strong>Live-Trading Risiko:</strong> Setze Paper-Mode auf OFF nur wenn ein Private-Key gesetzt UND die Wallet ausreichend SOL für Trades + Fees hat.
            </span>
          </div>
          <Button onClick={handleSavePaperMode} disabled={saveStatus === "saving"} className="w-full">
            {saveStatus === "saving" ? "Speichere…" : "Default speichern"}
            {saveStatus === "saved" && <CheckCircle className="w-4 h-4 ml-2" />}
            {saveStatus === "error" && <XCircle className="w-4 h-4 ml-2" />}
          </Button>
        </CardContent>
      </Card>

      {/* Wallet-Verwaltung */}
      <Card className={config?.hasPrivateKey ? "border-emerald-500/30" : "border-amber-500/30"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-primary" /> Wallet-Verwaltung
          </CardTitle>
          <CardDescription>
            Private-Keys werden ausschließlich in <code>.env</code> gespeichert — niemals in der DB oder per API übertragen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Generieren */}
          <div className="space-y-2">
            <Label>Neue Wallet generieren</Label>
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerate}
              disabled={actionStatus === "working"}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-2" />
              Neues Keypair erzeugen
            </Button>
            {generatedKey && (
              <div className="p-3 rounded bg-amber-500/10 border border-amber-500/30 space-y-2">
                <p className="text-xs font-bold text-amber-300 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  WICHTIG: Diesen Key JETZT sichern! Er wird nach Reload nicht mehr angezeigt.
                </p>
                <div className="flex gap-2">
                  <Input
                    value={generatedKey}
                    readOnly
                    type={showPrivateKey ? "text" : "password"}
                    className="font-mono text-[10px]"
                  />
                  <Button variant="outline" size="icon" onClick={() => setShowPrivateKey(s => !s)}>
                    {showPrivateKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                  <Button variant="outline" size="icon" onClick={() => handleCopy(generatedKey)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-white/5 pt-4">
            <div className="space-y-2">
              <Label htmlFor="import-key">Bestehenden Private-Key importieren (Base58)</Label>
              <div className="flex gap-2">
                <Input
                  id="import-key"
                  type={showPrivateKey ? "text" : "password"}
                  value={privateKeyInput}
                  onChange={e => setPrivateKeyInput(e.target.value)}
                  placeholder="Base58 Private-Key (z. B. aus Phantom / Solflare)"
                  className="font-mono text-xs"
                />
                <Button variant="outline" size="icon" onClick={() => setShowPrivateKey(s => !s)}>
                  {showPrivateKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <Button onClick={handleImport} disabled={actionStatus === "working"} size="sm" className="w-full">
                Key importieren
              </Button>
            </div>
          </div>

          {config?.hasPrivateKey && (
            <div className="border-t border-red-500/30 pt-4">
              <Button
                variant="destructive"
                size="sm"
                onClick={handleClear}
                disabled={actionStatus === "working"}
                className="w-full"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Private-Key aus .env entfernen
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}