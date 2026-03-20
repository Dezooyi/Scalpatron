// Standardized Strategy Import Format for Scalpatron V1
export interface StrategyConfig {
  name: string;
  version: string;
  description?: string;
  mintAddress: string;
  initialSOL?: number;
  paperMode?: boolean;
  parameters: {
    floorWindow?: number;
    spikeThreshold?: number;
    sellDropThreshold?: number;
    [key: string]: number | string | boolean | undefined;
  };
  agentPrompt?: string; // Optional custom instruction for the OllamaAgent
}

export function validateStrategy(data: unknown): StrategyConfig {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid strategy format. Must be a JSON object.');
  }

  const obj = data as Record<string, unknown>;

  if (!obj.name || typeof obj.name !== 'string') {
    throw new Error('Strategy "name" is missing or invalid.');
  }
  if (!obj.version || typeof obj.version !== 'string') {
    throw new Error('Strategy "version" is missing or invalid.');
  }
  if (!obj.mintAddress || typeof obj.mintAddress !== 'string') {
    throw new Error('Strategy "mintAddress" is missing or invalid.');
  }
  if (!obj.parameters || typeof obj.parameters !== 'object') {
    throw new Error('Strategy "parameters" missing or invalid.');
  }

  return obj as unknown as StrategyConfig;
}
