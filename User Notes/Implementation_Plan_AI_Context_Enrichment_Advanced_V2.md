# Implementation Plan: AI Context Enrichment (Advanced V2)

## Goal
Enhance the data foundation provided to the [OllamaAgent](file:///i:/ARBEIT_2026/_Antigravity_Workspace/Solana_BotTrader00/src/ollamaAgent.ts#293-969) to enable highly accurate, logical, and context-aware trading recommendations. The upgrade addresses four core areas: 
A. Multi-Timeframe (MTF) Data (Virtual Candles)
B. Pre-calculated Technical Indicators (RSI, MACD, etc.)
C. Macro-Market Correlation (SOL & BTC)
D. Volume & On-Chain Sentiment

## User Review Required
Please review the proposed API sources for Feature C and D. I recommend adding the `technicalindicators` npm package for robust math in Feature B. Is this acceptable? 

## Proposed Changes

### Feature A: Multi-Timeframe (MTF) Context
Instead of feeding the LLM raw tick data, we will aggregate ticks into structured OHLC (Open, High, Low, Close) candles in the backend.
- **Implementation**: Create a utility function `buildVirtualCandles(ticks, timeframeMs)` in `src/utils/mathUtils.ts`.
- **Integration**: In [ollamaAgent.ts](file:///i:/ARBEIT_2026/_Antigravity_Workspace/Solana_BotTrader00/src/ollamaAgent.ts), generate 1m, 5m, and 15m candles from `allHistory`. Pass the last 5-10 candles of each timeframe to the prompt.

### Feature B: Pre-Processed Technical Indicators
The backend will compute the math, forcing the LLM to focus on logic rather than calculation.
- **Dependency**: `npm install technicalindicators` (Industry standard, lightweight).
- **Implementation**: Calculate standard indicators on the 5m and 15m candles:
  - RSI (14)
  - MACD (12, 26, 9)
  - Bollinger Bands (20, 2)
  - ATR (14)
- **Prompt Injection**: Provide a clean summary block: `[INDICATORS 5m] RSI: 42 (Neutral), MACD: Bearish Cross, Price vs BB: Middle Band`.

### Feature C: Macro Context (SOL & BTC Correlation)
The AI needs to know if the broader market is crashing to prevent buying meme coins during a dump. We will implement a `macroFeed.ts` service.
- **.env Config**: 
  ```env
  ENABLE_MACRO_CONTEXT=true
  JUPITER_URL=https://price.jup.ag/v6/price
  MACRO_BTC_API=https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT
  ```
- **SOL Price**: Fetch WSOL (`So11111111111111111111111111111111111111112`) via the Jupiter API (`JUPITER_URL`). Cache this every 1-2 minutes.
- **BTC Price**: Fetch via Binance public API (Free, no keys needed, extremely reliable).
- **AI Prompt**: Inject global market trends: `MACRO: BTC is TRENDING UP (+2.1% 1h). SOL is RANGING (-0.2% 1h)`. 

### Feature D: Volume & On-Chain Sentiment
DexScreener WebSocket ticks lack volume, but their REST API provides 1h/24h volume, buy/sell amounts, and liquidity.
- **Implementation**: During the AI analysis cycle, perform a single REST call to `https://api.dexscreener.com/latest/dex/tokens/<mint>`.
- **Extraction**: Extract `volume.h1`, `txns.h1.buys`, `txns.h1.sells`, and `liquidity.usd`.
- **AI Prompt**: Inject: `ON-CHAIN (1h): 120 Buys / 80 Sells. Volume: $450k. Liquidity: $1.2M`.

---

## Architecture / File Modifications

### `src/macroFeed.ts` [NEW]
- Centralized singleton service to poll BTC (Binance) and SOL (Jupiter) every 60 seconds.
- Stores rolling history (last 1h) to calculate macro trend vectors.

### [src/ollamaAgent.ts](file:///i:/ARBEIT_2026/_Antigravity_Workspace/Solana_BotTrader00/src/ollamaAgent.ts) [MODIFY]
- Inject `MacroFeed` data into the [buildPrompt](file:///i:/ARBEIT_2026/_Antigravity_Workspace/Solana_BotTrader00/src/ollamaAgent.ts#592-700) function.
- Resample `recentPrices` into MTF candles.
- Run indicator math and inject human-readable states into the prompt.
- Add DexScreener REST fetch for volume/sentiment before calling the LLM.

### [.env](file:///i:/ARBEIT_2026/_Antigravity_Workspace/Solana_BotTrader00/.env) / [src/config.ts](file:///i:/ARBEIT_2026/_Antigravity_Workspace/Solana_BotTrader00/src/config.ts) [MODIFY]
- Add Macro API URLs and feature toggles.

## Verification Plan
1. **Unit Testing**: Verify OHLC candle generation groups ticks correctly.
2. **Indicator Validation**: Compare backend RSI/MACD output against TradingView for the same price array.
3. **API Checks**: Ensure Binance and Jupiter polling runs without rate limits and recovers from network errors.
4. **Prompt Review**: Inspect the final text prompt sent to the LLM to ensure the new context is concise and correctly formatted.
