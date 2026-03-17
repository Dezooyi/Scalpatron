import { OllamaAgent } from "../src/ollamaAgent";

async function test() {
  const agent = new OllamaAgent();
  // Override config
  agent.updateConfig({
    provider: 'opencode',
    model: 'test',
    cycleMinutes: 1,
    temperature: 0.7,
    maxTokens: 500,
    systemPrompt: "You are a test agent. Important: you must return JSON.",
    minConfidence: 0.5,
    autoApply: true
  });

  const mockBot = {
    id: "test-bot",
    name: "Test Bot",
    strategyConfig: {
      market: { symbol: "SOL" }
    },
    settings: {
      floorWindow: 100,
      spikeThreshold: 0.5,
      sellDropThreshold: 0.2,
      cooldownTicks: 10
    },
    tradeHistory: []
  } as any;

  console.log("Starting analysis with Opencode...");
  try {
    const result = await agent.analyze(mockBot);
    console.log("Analysis Result:", JSON.stringify(result, null, 2));
  } catch (err: any) {
    console.error("Test Error:", err.message);
  }
}

test();
