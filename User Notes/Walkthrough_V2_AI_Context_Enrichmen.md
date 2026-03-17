# Walkthrough: V2 AI Context Enrichment 🚀

The AI strategy analyzer has just been given a massive upgrade in terms of the context it uses to make decisions. Rather than relying on a noisy stream of raw price ticks, the bot now computes structural insights and passes them strictly structured to the LLM. 

## 1. Virtual Multi-Timeframe (MTF) Candles (Feature A)
- **What changed:** Built a new [buildVirtualCandles](file:///i:/ARBEIT_2026/_Antigravity_Workspace/Solana_BotTrader00/src/utils/mathUtils.ts#13-63) utility that takes the existing high-resolution price ticks inside SQLite memory and groups them into perfectly aligned Open-High-Low-Close (OHLC) intervals. 
- **Where:** [src/utils/mathUtils.ts](file:///i:/ARBEIT_2026/_Antigravity_Workspace/Solana_BotTrader00/src/utils/mathUtils.ts) -> [buildVirtualCandles](file:///i:/ARBEIT_2026/_Antigravity_Workspace/Solana_BotTrader00/src/utils/mathUtils.ts#13-63)
- **Result:** We now send a condensed `m5` (5-minute) visual trend mapping to the AI prompt (`m5HistoryLite`), reducing token weight and immensely increasing the AI's ability to spot formations like support/resistance floors.

## 2. Pre-Calculated Technical Indicators (Feature B)
- **What changed:** Integrated the industry-standard `technicalindicators` npm library. We now run the OHLC candles through robust algorithms on the Node.js backend to get indicator values *before* we send them to Ollama.
- **Where:** [src/utils/mathUtils.ts](file:///i:/ARBEIT_2026/_Antigravity_Workspace/Solana_BotTrader00/src/utils/mathUtils.ts) -> [calculatePreProcessedIndicators](file:///i:/ARBEIT_2026/_Antigravity_Workspace/Solana_BotTrader00/src/utils/mathUtils.ts#64-151)
- **Result:** Instead of forcing the LLM to guess math, we simply tell it:
  - **RSI (14)** is `Overbought` | `Neutral` | `Oversold`
  - **MACD** is `Bullish Crossover` | `Bearish` etc.
  - **Bollinger Bands** are `Squeezing` | `Expanding`
  - **ATR (Volatility)** is `High` | `Low`

## 3. Global Macro Context Feed - BTC & SOL (Feature C)
- **What changed:** Created a dedicated [MacroFeed](file:///i:/ARBEIT_2026/_Antigravity_Workspace/Solana_BotTrader00/src/macroFeed.ts#17-69) singleton that polls Binance and Jupiter APIs globally every 60 seconds.
- **Where:** [src/macroFeed.ts](file:///i:/ARBEIT_2026/_Antigravity_Workspace/Solana_BotTrader00/src/macroFeed.ts)
- **Result:** The AI prompt now contains global sentiment. If Solana is tanking, the AI knows a token's crash might be structural and not isolated, allowing it to toggle `DEAD` mode precisely rather than aggressively buying dips in a bear market.

## 4. On-Chain Sentiment & Volume (Feature D)
- **What changed:** Added an asynchronous REST call to DexScreener before constructing the prompt. 
- **Where:** [src/ollamaAgent.ts](file:///i:/ARBEIT_2026/_Antigravity_Workspace/Solana_BotTrader00/src/ollamaAgent.ts) -> [buildPrompt](file:///i:/ARBEIT_2026/_Antigravity_Workspace/Solana_BotTrader00/src/ollamaAgent.ts#596-766)
- **Result:** We extract Liquidity, 1-Hour Volume, and 1-Hour transaction counts (Buys/Sells). This stops the AI from buying "ghost" tokens with no active volume.

---
### Live Trading Readiness 🏁
I have also placed a document in [/docs/live-trading-infrastructure.md](file:///i:/ARBEIT_2026/_Antigravity_Workspace/Solana_BotTrader00/docs/live-trading-infrastructure.md) evaluating Jupiter vs Helius. 
> [!NOTE] 
> The current setup successfully pulls data *free of charge* from Jupiter for AI Context, but we mapped out Helius integration for the day actual transaction executions need prioritizing and MEV-protection.
