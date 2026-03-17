# Future Live Trading Infrastructure & Provider Strategy

## Current State (Data & AI Context)
For the current AI context enrichment (V2), we use isolated REST API calls to gather macro-market sentiment:
- **Jupiter Price API (v3/price)**: Fast, free polling for Solana (SOL) macro trends.
- **Binance Public API**: Reliable, keyless access for Bitcoin (BTC) sentiment.
- **DexScreener REST**: On-chain volume and Buy/Sell tracking.

*Why currently not Jupiter for Trades?* Jupiter is an excellent Swap-Aggregator for finding the best routing quotes, but it lacks the deep infrastructure (RPC nodes, WebSocket transaction streams) required for a standalone, high-frequency, automated trading bot to securely manage and confirm transactions on its own.

## Future Goal (Live Trading Execution)
When transitioning from Paper/Simulated trading to **Live Trading** (executing real swaps on the Solana blockchain from a private key wallet), the architecture must shift to guarantee execution speed, prevent MEV (Maximal Extractable Value) attacks, and ensure transaction landing.

### Recommended Provider: Helius
For live execution, **Helius** is the recommended primary RPC and infrastructure provider.

**Why Helius?**
1. **Low-Latency RPC Nodes**: Critical for submitting transactions ahead of retail traders when a spike is detected.
2. **Jito MEV Protection**: Essential for Meme-coin trading. Without MEV protection, front-running bots will sandwich your trades, resulting in massive unseen slippage losses.
3. **Optimized Transaction Sending (*LaserStream*)**: Ensures high probability of transaction inclusion in the next block.
4. **Webhooks for Wallet Tracking**: Instead of polling your wallet balance via `getParsedTokenAccountsByOwner` every minute, Helius Webhooks instantly push a JSON payload to our backend the millisecond a swap completes, allowing immediate exact PnL calculations.

### Implementation Blueprint for Live Trading
When you are ready to implement real wallet swaps:

1. **Get Helius API Key**: Register at Helius.dev and add `HELIUS_RPC_URL` to `.env`.
2. **Swap Quotes**: Continue using the **Jupiter Swap API v6** (`/quote` endpoint) to calculate the best route for your token.
3. **Transaction Building**: Use the Jupiter `/swap` endpoint to build the raw unsigned transaction.
4. **Signing**: The Bot backend signs the raw transaction using the locally stored `WALLET_PRIVATE_KEY` (via `@solana/web3.js` VersionedTransactions).
5. **Broadcasting**: Submit the signed transaction to the blockchain **exclusively through the Helius RPC** (using `sendTransaction` with preflight checks skipped and Jito MEV tips included).
6. **Confirmation Monitoring**: Rely on Helius Webhooks (or repeated RPC polling) to confirm the transaction block hash instead of assuming immediate success.
