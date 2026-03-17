# Multi-Tranche and DCA Integration Review & Enhancements

## Goal Description
The multi-tranche execution for DCA and related scale-in strategies was successfully implemented in [trader.ts](file:///i:/ARBEIT_2026/_Antigravity_Workspace/Solana_BotTrader00/src/trader.ts) and [botInstance.ts](file:///i:/ARBEIT_2026/_Antigravity_Workspace/Solana_BotTrader00/src/botInstance.ts).
This implementation plan reviews all strategy templates (DCA, Grid, Momentum, Scalping, Breakout, Mean Reversion) and outlines the final updates necessary to ensure:
- The simulated or live wallet balance perfectly reflects multi-tranche setups.
- Stats correctly reflect average positions and open amounts.
- Proper fallback values for position sizing vs. bot aggressiveness are enforced.

## Proposed Changes
No further structural changes to the database or core components are required. The changes from the current session have stabilized the DCA flow. I will focus on:

###  Bot Engine ([src/botInstance.ts](file:///i:/ARBEIT_2026/_Antigravity_Workspace/Solana_BotTrader00/src/botInstance.ts))
- Ensure that the restored statistics correctly account for the PnL of individual trades when calculating total ROI for strategies that exit multiple tranches at once.

###  Bot Dashboard (UI) ([frontend/src/components/LiveFeedListCard.tsx](file:///i:/ARBEIT_2026/_Antigravity_Workspace/Solana_BotTrader00/frontend/src/components/LiveFeedListCard.tsx) / Bot Control Panel)
- If necessary, update the `BotDetailCard` or `LiveFeedListCard` in the frontend to explicitly show the `openPositionsCount` to the user so they can visualize how many tranches a DCA or Grid strategy currently holds in its arsenal.

## Verification Plan

### Automated Tests
Currently, the codebase lacks unit tests. I will run the bot application via `npx tsx src/index.ts` and simulate a multi-tranche DCA scenario using the provided CLI interface or frontend.

### Manual Verification
1. Open the locally hosted frontend dashboard (`http://localhost:5173`).
2. Create a new Paper Trading Bot using the "DCA Accumulator" strategy and verify it opens multiple tranches incrementally.
3. Observe the "SOL/UGOR Balance" in the Bot Detail card, ensuring the percentage taken per tranche matches the configured percentage inside the template ([dca.json](file:///i:/ARBEIT_2026/_Antigravity_Workspace/Solana_BotTrader00/src/strategyTemplates/dca.json)).
4. Ensure the total balance after an exit correctly aggregates the profit.
