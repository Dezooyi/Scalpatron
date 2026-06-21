import { Bot as BotIcon, Copy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useWalletData, shortenAddress } from "@/hooks/useWalletData";

interface Props {
  data: ReturnType<typeof useWalletData>;
}

export function WalletBotAssignment({ data }: Props) {
  const { bots, info } = data;

  const handleCopy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <Card className="bg-card/40 backdrop-blur-md border-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <BotIcon className="h-4 w-4 text-primary" />
            Bots & Wallet-Zuordnung ({bots.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {info && (
            <div className="mb-4 p-3 rounded bg-primary/10 border border-primary/30">
              <div className="text-[10px] uppercase tracking-wider text-primary mb-1 font-bold">
                Primäre Wallet
              </div>
              <div className="flex items-center gap-2">
                <code className="text-xs font-mono flex-1 truncate">{info.address}</code>
                <button
                  onClick={() => handleCopy(info.address)}
                  className="text-primary hover:text-primary/80"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}

          {bots.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">
              Keine Bots vorhanden
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px]">Bot</TableHead>
                    <TableHead className="text-[10px]">Token (Mint)</TableHead>
                    <TableHead className="text-[10px]">Wallet</TableHead>
                    <TableHead className="text-[10px]">Modus</TableHead>
                    <TableHead className="text-[10px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bots.map(b => {
                    const matchesPrimary = b.walletAddress === info?.address;
                    return (
                      <TableRow key={b.botId}>
                        <TableCell className="text-xs font-bold">
                          {b.botName}
                        </TableCell>
                        <TableCell className="text-[10px] font-mono">
                          {shortenAddress(b.mintAddress, 6, 6)}
                        </TableCell>
                        <TableCell>
                          <button
                            onClick={() => handleCopy(b.walletAddress)}
                            className="text-[10px] font-mono text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                          >
                            <Copy className="h-2.5 w-2.5" />
                            {b.walletAddress ? shortenAddress(b.walletAddress, 6, 6) : "—"}
                          </button>
                        </TableCell>
                        <TableCell>
                          {b.paperMode ? (
                            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
                              Paper
                            </span>
                          ) : (
                            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                              Live
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {matchesPrimary ? (
                            <span className="text-[10px] text-emerald-400 font-bold">✓ Primary</span>
                          ) : b.walletAddress ? (
                            <span className="text-[10px] text-muted-foreground">Custom</span>
                          ) : (
                            <span className="text-[10px] text-amber-400">⚠ Keine Wallet</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}