# AI Agent Integration Guide

## Overview
The \`OllamaAgent\` is the central intelligence unit of the trading bot. It automatically analyzes market data across all active bots and provides strategy adjustments to optimize trading parameters over time. It operates sequentially (evaluating bots one by one) to maximize contextual continuity and prevent API rate-limiting.

## Supported Providers
The AI assistant supports multiple LLM providers, configurable within the \`.env\` file.
- **Ollama**: Default local provider (\`OLLAMA_PROVIDER=ollama\`).
- **Opencode**: Integration with the Opencode CLI for cloud-based inference (\`OLLAMA_PROVIDER=opencode\`).
- **Custom API**: Connect to external APIs like OpenAI, Anthropic, or compatible custom APIs (\`OLLAMA_PROVIDER=custom_api\`).

## Market Regimes
The AI analyzes data to classify the current market into four distinct regimes. The frontend UI dynamically color-codes and highlights these regimes.
- \`RANGING\`: Horizontal movement, preferred for Scalping, Grid, Mean Reversion.
- \`TRENDING\`: Clear directional movement, preferred for Trend Following, Momentum.
- \`VOLATILE\`: High volatility, preferred for Breakout.
- \`DEAD\`: Very low movement, accumulation or pause.

*Skipped or Failed Analyses*: When an analysis fails or is skipped due to insufficient data, the system records it in the history under the \`SKIPPED\` or \`ERROR\` regime. This ensures errors (and their reasons) are visible in the UI.

## Database Tracking (\`agent_history\`)
Every analysis cycle (applied, unapplied, and skipped) is saved to an SQLite table (\`agent_history\`).
\`\`\`typescript
saveAgentHistory(
  botId: string,
  regime: string,             // RANGING, TRENDING, DEAD, VOLATILE, SKIPPED, ERROR
  confidence: number,         // 0.0 - 1.0 (0 for skips)
  reason: string,             // short explanation
  analysis: string,           // detailed analysis
  adjustedSettings: any,      // JSON object of applied settings
  applied: boolean,           // true if applied, false otherwise
  aggressivenessAdvice?: number,
  strategyId?: string
);
\`\`\`

## Agent File Architecture
- \`src/ollamaAgent.ts\`: Core agent logic, system prompts, API query handlers (Opencode, Ollama, Custom), and sequential parsing.
- \`src/db.ts\`: SQLite database schemas, history tables (\`agent_history\`), and logging routines.
- \`src/botInstance.ts\`: Handles the application of AI settings to individual bot running states.
- \`frontend/src/App.tsx\`: Renders the AI analysis overview, history table, and triggers manual analysis.
- \`frontend/src/components/LiveFeedListCard.tsx\`: Displays the combined chronologic history of pricing updates, trades, and AI recommendations.

## Best Practices for AI-Driven Development
1. **Adding new Strategy Prompting parameters:** Expand the \`STRATEGY_TYPE_GUIDANCE\` object within \`src/ollamaAgent.ts\`. The system dynamically injects these into the base prompt according to the bot's configured \`strategyType\`.
2. **Troubleshooting API Rate Limits:** When adding data layers, verify that \`OllamaAgent\` doesn't overload external APIs (like DexScreener). Wait limits and retry mechanisms must coordinate with the \`PriceFeed\` rate limiter.
3. **Handling Windows Spawns:** Subprocess interactions (like Opencode) must use \`spawn\` with \`child.stdin?.end()\` and \`shell: true\` to avoid hangings on Windows.
4. **Error Handling/Feedback Loops:** Any AI failure MUST log to \`saveAgentHistory\` so the error is transparent to the user inside the AI Agent UI. Avoid silent failures where the agent just stops or \`returns\`. 

## English Workflow Focus
The internal logs, prompt engineering frameworks, and console logs are constructed entirely in English for compatibility with advanced models and downstream AI coding assistants. Maintain this rule directly inside \`ollamaAgent.ts\`.
