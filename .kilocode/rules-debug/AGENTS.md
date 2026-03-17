# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Debug Mode Regeln

### Log-Dateien
- [`logs/app_system.log`](logs/app_system.log) - Application System Logs
- [`logs/paper-trades.jsonl`](logs/paper-trades.jsonl) - Trade-Logs (JSONL-Format)
- [`logs/backtest-*.jsonl`](logs/) - Backtest-Protokolle mit Timestamp

### Debugging Commands
```bash
npx tsx src/wallet.ts         # Wallet Balance + Airdrop testen
npx tsx src/priceFeed.ts      # Preis-Feed testen (10 Ticks)
```

### Wichtige Debug-Informationen
- Ollama-Agent: `think: false` wird automatisch bei qwen3/3.5 Modellen gesetzt
- Port-Konflikte: Server weicht automatisch aus (3000→3001→3002)
- Devnet Airdrop Rate-Limit: Bei Fehlern https://faucet.solana.com nutzen
- Preis-Feed: DexScreener API kann bei Netzwerkproblemen ausfallen

### Datenbank
- SQLite: `data/scalpatron.db` (mit SHM/WAL Files)
