# Handout: Scalpatron Development Insights & Future Roadmap

## 🚀 Overview
Scalpatron has evolved from a single-token "Range Spike Scalper" into a **Generic Multi-Bot Trading Platform**. This handout summarizes the current architecture, recent major transitions (Generic Traders), and provides guidance for future developers.

---

## 🏗️ Core Architecture
The system follows a modular singleton/instance pattern:
- **`BotManager`**: Orchestrates multiple `BotInstance` objects. Persists configuration in SQLite.
- **`BotInstance`**: Encapsulates the entire lifecycle of a single trading bot (PriceFeed subscription → Pattern Detection → Trade Execution).
- **`Trader` (Generic)**: Handles balance management and swap execution (Paper or Live via Jupiter).
- **`PriceFeed` (Singleton)**: Central polling hub for all active token mints (multi-threaded feel via high-frequency async polling).

---

## 💎 Key Feature: Generic Token Handling
We recently transitions from hardcoded **UGOR** logic to a fully generic system.
- **Dynamic Mints**: Each bot now tracks its own `targetMint` and `targetDecimals`.
- **`balanceToken`**: All internal logic uses `balanceToken` instead of `balanceUGOR`.
- **Auto-Sync**: The trader dynamically fetches SPL token account balances for the current `targetMint`.
- **Display**: The UI automatically adapts to the token's symbol (fetched from the `tokens` table in DB).

### 💡 Insight: Precision Matters
When adding new tokens, always ensure the `decimals` are correctly retrieved from the blockchain or local metadata. The `Trader` uses this for calculating UI amounts (`amount / 10^decimals`).

---

## 🤖 Strategy Assistant (AI Agent)
The central AI agent (Ollama) analyzes the market every 21 minutes.
- **Regime Detection**: `RANGING`, `TRENDING`, `DEAD`, `VOLATILE`.
- **Dynamic Optimization**: The AI adjusts `spikeThreshold`, `sellDropThreshold`, and `aggressiveness`.
- **Confidence Layer**: AI changes are only applied if the confidence score exceeds the user-defined threshold.

---

## 🛠️ Development & Debugging

### Useful Commands
```bash
# Start the full stack (Backend + Dashboard)
npx tsx src/index.ts

# Test Wallet connectivity and balances
npx tsx src/wallet.ts

# Test Live Price Feed for a specific token
npx tsx src/priceFeed.ts
```

### Database (SQLite)
- `bots`: Configuration and status.
- `trades`: Historical performance.
- `tokens`: Whitelist and metadata.
- `agent_history`: AI decision logs and feedback loops.

---

## 🔮 Roadmap / Future Ideas
1. **Compounding PnL**: Implementation of weighted or compounded PnL tracking instead of simple sum.
2. **Multi-Wallet Support**: Allowing each bot instance to use a unique `Keypair` instead of the global one.
3. **Advanced Exit Conditions**: Moving beyond `sellDrop` to dynamic Take-Profit/Stop-Loss based on volatility (ATR).
4. **Helius Integration**: Transitioning from Jupiter for high-frequency execution data or using Helius RPCs for faster commitment.
5. **UI Customization**: Drag-and-drop bot chips for custom dashboard layouts.

---

## 📝 Important Notes
- **Live Trading**: Live trading requires the Jupiter Ultra API. Ensure your `.env` contains a valid `JUPITER_ULTRA_URL`.
- **Safety**: Always test new strategies in **Paper Mode** first.
- **Logs**: Detailed logs for each bot are stored in `logs/trades-<id>.jsonl`.

---
*Created by Antigravity AI — March 2026*
