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
    [key: string]: any;
  };
  agentPrompt?: string; // Optional custom instruction for the OllamaAgent
}

export function validateStrategy(data: any): StrategyConfig {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid strategy format. Must be a JSON object.');
  }
  if (!data.name || typeof data.name !== 'string') {
    throw new Error('Strategy "name" is missing or invalid.');
  }
  if (!data.version || typeof data.version !== 'string') {
    throw new Error('Strategy "version" is missing or invalid.');
  }
  if (!data.mintAddress || typeof data.mintAddress !== 'string') {
    throw new Error('Strategy "mintAddress" is missing or invalid.');
  }
  if (!data.parameters || typeof data.parameters !== 'object') {
    throw new Error('Strategy "parameters" missing or invalid.');
  }

  return data as StrategyConfig;
}
