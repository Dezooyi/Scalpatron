import { Database, Plus, Activity, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TokenInfo } from "@/App";

function formatPrice(price?: number): string {
  if (!price) return "—";
  if (price < 0.000001) return `$${price.toExponential(2)}`;
  if (price < 0.01) return `$${price.toFixed(6)}`;
  return `$${price.toFixed(4)}`;
}

function formatVolume(vol?: number): string {
  if (!vol) return "—";
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(1)}K`;
  return `$${vol.toFixed(0)}`;
}

export interface TokensTabProps {
  tokens: TokenInfo[];
  isAddTokenDialogOpen: boolean;
  setIsAddTokenDialogOpen: (v: boolean) => void;
  newTokenMintAddress: string;
  setNewTokenMintAddress: (v: string) => void;
  lookupResult: Partial<TokenInfo> | null;
  setLookupResult: (v: Partial<TokenInfo> | null) => void;
  lookupError: string | null;
  setLookupError: (v: string | null) => void;
  isLookingUp: boolean;
  onLookupToken: () => void;
  onAddToken: () => void;
  onRemoveToken: (mintAddress: string) => void;
}

export function TokensTab({
  tokens,
  isAddTokenDialogOpen,
  setIsAddTokenDialogOpen,
  newTokenMintAddress,
  setNewTokenMintAddress,
  lookupResult,
  setLookupResult,
  lookupError,
  setLookupError,
  isLookingUp,
  onLookupToken,
  onAddToken,
  onRemoveToken,
}: TokensTabProps) {
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Database className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-3xl font-bold tracking-tighter">Token Whitelist</h1>
          <p className="text-muted-foreground mt-1">Manage tokens available for trading and charting.</p>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => setIsAddTokenDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Add Token
        </Button>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Mint Address</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">24h Volume</TableHead>
              <TableHead className="text-right">24h Change</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tokens.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  <Database className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                  <p>No tokens in whitelist. Click "Add Token" to get started.</p>
                </TableCell>
              </TableRow>
            ) : (
              tokens.map((token) => (
                <TableRow key={token.mintAddress}>
                  <TableCell className="font-bold text-primary">{token.symbol}</TableCell>
                  <TableCell className="text-muted-foreground">{token.name}</TableCell>
                  <TableCell className="font-mono text-xs">
                    <span className="bg-muted px-2 py-1 rounded">{token.mintAddress.slice(0, 8)}...{token.mintAddress.slice(-8)}</span>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    <span className={token.priceUsd ? "text-white" : "text-muted-foreground"}>
                      {formatPrice(token.priceUsd)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">
                    {formatVolume(token.volume24h)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {token.priceChange24h !== undefined && token.priceChange24h !== null ? (
                      <span className={token.priceChange24h >= 0 ? "text-green-400" : "text-red-400"}>
                        {token.priceChange24h >= 0 ? "+" : ""}{token.priceChange24h.toFixed(2)}%
                      </span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      onClick={() => onRemoveToken(token.mintAddress)}
                    >
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={isAddTokenDialogOpen} onOpenChange={setIsAddTokenDialogOpen}>
        <DialogContent className="w-[95vw] max-w-[520px] bg-black/85 backdrop-blur-2xl border-white/10 text-zinc-100 shadow-2xl overflow-y-auto max-h-[90vh]">
          {/* Top gradient line */}
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent pointer-events-none" />
          {/* Top glow */}
          <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-primary/8 to-transparent pointer-events-none rounded-t-lg" />

          <DialogHeader className="relative">
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2 bg-primary/10 rounded-lg border border-primary/20">
                <Database className="h-5 w-5 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-lg font-black tracking-tight">Add Token to Whitelist</DialogTitle>
                <DialogDescription className="text-zinc-500 text-xs mt-0.5">
                  Enter a Solana token mint address. Token info will be fetched from DexScreener.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4 py-2 relative">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Database className="h-3.5 w-3.5 text-primary/70" />
                <Label htmlFor="mintAddress" className="text-xs font-bold uppercase tracking-wider text-zinc-400">Mint Address *</Label>
              </div>
              <div className="flex gap-2">
                <Input
                  id="mintAddress"
                  placeholder="e.g. UGoRwdj9SK78V6Pq9YMz9BvmNuJTLNqPZyS5WnGd8uW"
                  value={newTokenMintAddress}
                  onChange={(e) => setNewTokenMintAddress(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onLookupToken()}
                  className="font-mono text-sm bg-zinc-800/80 border-white/10 text-zinc-100 placeholder:text-zinc-600 focus:border-primary/50"
                />
                <Button
                  variant="outline"
                  onClick={onLookupToken}
                  disabled={isLookingUp || !newTokenMintAddress.trim()}
                  className="bg-zinc-800/80 border-white/10 text-zinc-400 hover:text-primary shrink-0"
                >
                  {isLookingUp ? <Activity className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                </Button>
              </div>
              {lookupError && <p className="text-[11px] text-red-400">{lookupError}</p>}
            </div>

            {lookupResult && (
              <Card className="border-primary/20 bg-primary/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <span className="text-primary">{lookupResult.symbol}</span>
                    <span className="text-muted-foreground font-normal">{lookupResult.name}</span>
                  </CardTitle>
                  <CardDescription>Token details from DexScreener</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Price:</span>
                    <span className="ml-2 font-mono text-white">{formatPrice(lookupResult.priceUsd)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">24h Volume:</span>
                    <span className="ml-2 font-mono text-white">{formatVolume(lookupResult.volume24h)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">24h Change:</span>
                    <span className={`ml-2 font-mono ${lookupResult.priceChange24h && lookupResult.priceChange24h >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {lookupResult.priceChange24h ? `${lookupResult.priceChange24h >= 0 ? "+" : ""}${lookupResult.priceChange24h.toFixed(2)}%` : "-"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Decimals:</span>
                    <span className="ml-2 font-mono text-white">{lookupResult.decimals ?? "-"}</span>
                  </div>
                  {lookupResult.liquidity && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Liquidity:</span>
                      <span className="ml-2 font-mono text-white">{formatVolume(lookupResult.liquidity)}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          <DialogFooter className="relative border-t border-white/5 pt-4 mt-1">
            <Button
              variant="ghost"
              className="text-zinc-400 hover:text-zinc-200"
              onClick={() => {
                setIsAddTokenDialogOpen(false);
                setNewTokenMintAddress("");
                setLookupResult(null);
                setLookupError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={onAddToken}
              disabled={!lookupResult || isLookingUp}
              className="bg-primary text-primary-foreground hover:bg-primary/80 font-bold"
            >
              <Plus className="mr-2 h-4 w-4" /> Add to Whitelist
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
