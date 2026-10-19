import { ChatOpenAI } from "@langchain/openai";

/**
 * Safe environment variable retrieval supporting Node.js runtime.
 */
const getEnv = (key: string, fallback: string = ''): string => {
  try {
    if (typeof process !== 'undefined' && process.env && process.env[key]) {
      return process.env[key] as string;
    }
  } catch {
    // Fallback if environment context is restricted
  }
  return fallback;
};

const apiKey = (providerKey?: string) =>
  providerKey || 
  getEnv('OPENAI_API_KEY') || 
  getEnv('NVIDIA_API_KEY') || 
  getEnv('QWEN_API_KEY') || 
  getEnv('LM_STUDIO_API_KEY') || 
  'local-runtime';

function createBrain(
  modelName: string,
  temperature: number,
  baseURL: string,
  key?: string,
) {
  return new ChatOpenAI({
    modelName,
    temperature,
    openAIApiKey: apiKey(key),
    configuration: { baseURL },
  });
}

/**
 * Primary Sovereign Reasoning Brain 
 * Defaults to Nvidia Nemotron or local Ollama / LM Studio runtime endpoints.
 */
export const primaryBrain = createBrain(
  getEnv('PRIMARY_REASONING_MODEL') || getEnv('NVIDIA_MODEL') || 'nvidia/nemotron-3-ultra',
  0.2,
  getEnv('NVIDIA_API_ENDPOINT') || getEnv('LM_STUDIO_URL') || getEnv('OLLAMA_URL') || 'https://integrate.api.nvidia.com/v1',
  getEnv('NVIDIA_API_KEY'),
);

/**
 * Secondary Massive Context Brain 
 * Tuned for deep analysis and Qwen multi-turn reasoning workflows.
 */
export const secondaryBrain = createBrain(
  getEnv('SECONDARY_REASONING_MODEL') || getEnv('QWEN_MODEL') || 'Qwen/Qwen3-235B-A22B-Instruct-2507',
  0.4,
  getEnv('QWEN_API_ENDPOINT') || getEnv('LM_STUDIO_URL') || 'https://api.together.xyz/v1',
  getEnv('QWEN_API_KEY'),
);

/**
 * High-Speed Logic & Tool-Use Brain 
 * Optimized with low temperature for deterministic parsing, function calling, and agentic loops.
 */
export const logicBrain = createBrain(
  getEnv('LOGIC_REASONING_MODEL') || getEnv('LM_STUDIO_MODEL') || getEnv('OPENAI_MODEL') || 'gpt-4o-mini',
  0.1,
  getEnv('LOGIC_API_ENDPOINT') || getEnv('LM_STUDIO_URL') || getEnv('OPENAI_BASE_URL') || 'https://api.openai.com/v1',
  getEnv('LOGIC_API_KEY') || getEnv('LM_STUDIO_API_KEY') || getEnv('OPENAI_API_KEY'),
);
