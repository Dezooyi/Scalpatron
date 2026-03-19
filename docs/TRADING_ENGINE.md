# Trading Engine: Implementation Insights & Technical Specs

This document summarizes the core technical insights gained during the generalization of the Scalpatron Trading Engine.

---

## 💎 Generic Token Architecture (Transition from UGOR)

The most significant architectural shift was the transition from a single-token (UGOR) system to a **Generic Multi-Pair Trading Engine**.

### Key Specs:
- **`balanceToken`**: Replaces the legacy `balanceUGOR`. It represents the balance of the *target token* for the specific bot instance.
- **`targetMint` & `targetDecimals`**: Every `Trader` instance is now initialized with these two parameters. This allows for seamless trading of any SPL token (e.g., SOL/BONK, SOL/WIF) by simply providing the mint address.
- **Dynamic Atomic Units**: All transaction amounts are calculated using `10^targetDecimals` to ensure correct on-chain execution for tokens with different decimal precisions (e.g., 6 vs 9).

---

## 🔍 Precision & Sync Insights

### 1. Live Balance Synchronization
The `syncBalances()` method in `trader.ts` now dynamically fetches the SPL Token Account for the `targetMint`. 
- **Insight**: If a token account doesn't exist yet (first trade), the engine defaults to `0` instead of erroring, ensuring smooth first-time execution.
- **Wallet Link**: In Live Mode, bots auto-detect the global keypair if no specific `walletAddress` is provided, ensuring they always have an execution context.

### 2. Stats Persistence & Restoration
To maintain valid statistics across server restarts, the `BotInstance` implements a "Replay and Restore" logic:
- **`restoreStatsFromDB()`**: Replays historical trades from the `trades` table to reconstruct the cumulative SOL and Token balances.
- **Corrected Position Detection**: Status is determined by `openPositionsCount > 0` rather than just checking if a single `Position` object exists, allowing for future multi-bracket or DCA entries.

---

## 🎨 Frontend Signal & Badge Logic

Insights regarding user feedback in the UI:
- **Last Activity Insight**: The `recentTrades[0]` (sorted DESC) accurately represents the latest engine action.
- **Signal Logic**: The `SignalBadge` (BUY/SELL/HOLD) represents the **Bot's Intention**:
    - `BUY`: Bot is active, flat, and scanning for entries.
    - `SELL`: Bot is active and currently holding a position (ready to exit).
    - `HOLD`: Bot is stopped or paused.

---

## 🚀 Execution & Performance

- **Non-Blocking SSE**: Bot state updates are throttled to 500ms intervals to prevent UI jank during high-frequency price volatility.
- **Transaction Safety**: The `isSwapping` lock in `trader.ts` is critical. It prevents the engine from firing multiple overlapping swap requests to Jupiter if price ticks arrive faster than transaction confirmation.

---
*Technical Progress Report for Future Scale-Out — March 2026*
