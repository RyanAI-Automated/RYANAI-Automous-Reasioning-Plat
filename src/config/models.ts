/**
 * Safely extracts environment variables across Vite (import.meta.env)
 * and Node.js (process.env) runtimes, auto-prefixing VITE_ where needed.
 */
export function getEnv(key: string, defaultValue = ''): string {
  const baseKey = key.replace(/^VITE_/, '');
  const isCredential = /(?:API_KEY|TOKEN|SECRET|PASSWORD)$/i.test(baseKey);

  // Provider credentials are server-only. Never read them from VITE_* variables:
  // Vite embeds VITE_* values in browser bundles.
  if (isCredential) {
    return typeof process !== 'undefined' && process.env?.[baseKey] !== undefined
      ? process.env[baseKey] as string
      : defaultValue;
  }

  const viteKey = key.startsWith('VITE_') ? key : `VITE_${key}`;

  if (typeof import.meta !== 'undefined' && import.meta.env) {
    const env = import.meta.env as Record<string, unknown>;
    if (env[viteKey] !== undefined) return env[viteKey] as string;
    if (env[key] !== undefined) return env[key] as string;
  }

  if (typeof process !== 'undefined' && process.env) {
    if (process.env[key] !== undefined) return process.env[key] as string;
    if (process.env[viteKey] !== undefined) return process.env[viteKey] as string;
  }

  return defaultValue;
}

// ==========================================
// Types & Interfaces
// ==========================================

export type ModelProvider = 'nvidia' | 'qwen' | 'together' | 'openrouter' | 'gateway' | 'local';

export interface ModelCapabilities {
  tools: boolean;
  vision: boolean;
  jsonMode: boolean;
  streaming: boolean;
}

export interface ModelDefinition {
  id: string;
  name: string;
  provider: ModelProvider;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: ModelCapabilities;
  defaultTemperature: number;
  role?: string;
}

export interface GatewayConfig {
  baseUrl: string;
  apiKeyEnvVar: string;
  timeoutMs: number;
}

export interface RoutingProfile {
  autonomousReasoning: string;
  codeGeneration: string;
  generalInference: string;
  fastInference: string;
  fallback: string;
}

export interface ModelProfile {
  id: string;
  name: string;
  provider: ModelProvider;
  role: string;
  endpoint: string;
  contextWindow: number;
  temperature: number;
  apiKey?: string;
}

export type RyanBrain = ModelProfile;

// ==========================================
// Provider Gateways Configuration
// ==========================================

export const PROVIDER_GATEWAYS: Record<ModelProvider, GatewayConfig> = {
  nvidia: {
    baseUrl: getEnv('VITE_NVIDIA_API_ENDPOINT') || getEnv('NVIDIA_API_ENDPOINT') || 'https://integrate.api.nvidia.com/v1',
    apiKeyEnvVar: 'NVIDIA_API_KEY',
    timeoutMs: 60000,
  },
  qwen: {
    baseUrl: getEnv('VITE_QWEN_API_ENDPOINT') || getEnv('QWEN_API_ENDPOINT') || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnvVar: 'DASHSCOPE_API_KEY',
    timeoutMs: 60000,
  },
  together: {
    baseUrl: getEnv('VITE_TOGETHER_API_ENDPOINT') || getEnv('TOGETHER_API_ENDPOINT') || 'https://api.together.xyz/v1',
    apiKeyEnvVar: 'TOGETHER_API_KEY',
    timeoutMs: 60000,
  },
  openrouter: {
    baseUrl: getEnv('VITE_OPENROUTER_API_ENDPOINT') || getEnv('OPENROUTER_API_ENDPOINT') || 'https://openrouter.ai/api/v1',
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    timeoutMs: 60000,
  },
  gateway: {
    baseUrl: getEnv('VITE_MODEL_GATEWAY_URL') || getEnv('MODEL_GATEWAY_URL') || 'http://localhost:8000/v1',
    apiKeyEnvVar: 'MODEL_GATEWAY_API_KEY',
    timeoutMs: 30000,
  },
  local: {
    baseUrl: getEnv('VITE_LOCAL_MODEL_URL') || getEnv('LOCAL_MODEL_URL') || 'http://localhost:8080/v1',
    apiKeyEnvVar: 'LOCAL_API_KEY',
    timeoutMs: 120000,
  },
};

// ==========================================
// Model Inventory
// ==========================================

export const AVAILABLE_MODELS: Record<string, ModelDefinition> = {
  // --- NVIDIA Nemotron Series ---
  'nemotron-3-ultra': {
    id: 'nvidia/nemotron-3-ultra',
    name: 'Nvidia Nemotron 3 Ultra',
    provider: 'nvidia',
    contextWindow: 128000,
    maxOutputTokens: 8192,
    role: 'Primary Autonomous Reasoning & Code Synthesis',
    capabilities: { tools: true, vision: false, jsonMode: true, streaming: true },
    defaultTemperature: 0.2,
  },
  'nemotron-70b-instruct': {
    id: 'nvidia/llama-3.1-nemotron-70b-instruct',
    name: 'Nemotron 70B Instruct',
    provider: 'nvidia',
    contextWindow: 131072,
    maxOutputTokens: 4096,
    role: 'General Autonomous Reasoning',
    capabilities: { tools: true, vision: false, jsonMode: true, streaming: true },
    defaultTemperature: 0.6,
  },

  // --- Qwen Series ---
  'qwen-3.6-27b': {
    id: 'qwen/qwen-3.6-27b',
    name: 'Qwen 3.6 27B',
    provider: 'together',
    contextWindow: 64000,
    maxOutputTokens: 8192,
    role: 'Secondary Multi-Agent Validation & Context Caching',
    capabilities: { tools: true, vision: false, jsonMode: true, streaming: true },
    defaultTemperature: 0.1,
  },
  'qwen-2.5-72b-instruct': {
    id: 'qwen/qwen-2.5-72b-instruct',
    name: 'Qwen 2.5 72B Instruct',
    provider: 'qwen',
    contextWindow: 131072,
    maxOutputTokens: 8192,
    role: 'General Inference & Orchestration',
    capabilities: { tools: true, vision: false, jsonMode: true, streaming: true },
    defaultTemperature: 0.7,
  },
  'qwen-2.5-coder-32b': {
    id: 'qwen/qwen-2.5-coder-32b-instruct',
    name: 'Qwen 2.5 Coder 32B',
    provider: 'qwen',
    contextWindow: 131072,
    maxOutputTokens: 8192,
    role: 'Fast Code Generation & Refactoring',
    capabilities: { tools: true, vision: false, jsonMode: true, streaming: true },
    defaultTemperature: 0.2,
  },

  // --- Local Fallback ---
  'local-deterministic': {
    id: 'ryanai-local-stub',
    name: 'RyanAI C++ Local Fallback',
    provider: 'local',
    contextWindow: 8192,
    maxOutputTokens: 2048,
    role: 'Offline Deterministic Execution Guardrail',
    capabilities: { tools: true, vision: false, jsonMode: true, streaming: false },
    defaultTemperature: 0.0,
  },
};

export const DEFAULT_ROUTING_PROFILE: RoutingProfile = {
  autonomousReasoning: 'nemotron-3-ultra',
  codeGeneration: 'qwen-2.5-coder-32b',
  generalInference: 'qwen-2.5-72b-instruct',
  fastInference: 'qwen-3.6-27b',
  fallback: 'local-deterministic',
};

// ==========================================
// RyanAI Brain Abstractions
// ==========================================

export const RYANAI_BRAINS: Record<string, ModelProfile> = {
  nemotronUltra: {
    id: AVAILABLE_MODELS['nemotron-3-ultra'].id,
    name: AVAILABLE_MODELS['nemotron-3-ultra'].name,
    provider: AVAILABLE_MODELS['nemotron-3-ultra'].provider,
    role: AVAILABLE_MODELS['nemotron-3-ultra'].role!,
    endpoint: PROVIDER_GATEWAYS.nvidia.baseUrl,
    contextWindow: AVAILABLE_MODELS['nemotron-3-ultra'].contextWindow,
    temperature: AVAILABLE_MODELS['nemotron-3-ultra'].defaultTemperature,
    apiKey: getEnv('NVIDIA_API_KEY'),
  },
  qwen27b: {
    id: AVAILABLE_MODELS['qwen-3.6-27b'].id,
    name: AVAILABLE_MODELS['qwen-3.6-27b'].name,
    provider: AVAILABLE_MODELS['qwen-3.6-27b'].provider,
    role: AVAILABLE_MODELS['qwen-3.6-27b'].role!,
    endpoint: PROVIDER_GATEWAYS.together.baseUrl,
    contextWindow: AVAILABLE_MODELS['qwen-3.6-27b'].contextWindow,
    temperature: AVAILABLE_MODELS['qwen-3.6-27b'].defaultTemperature,
    apiKey: getEnv('TOGETHER_API_KEY') || getEnv('QWEN_API_KEY'),
  },
  localDeterministic: {
    id: AVAILABLE_MODELS['local-deterministic'].id,
    name: AVAILABLE_MODELS['local-deterministic'].name,
    provider: AVAILABLE_MODELS['local-deterministic'].provider,
    role: AVAILABLE_MODELS['local-deterministic'].role!,
    endpoint: PROVIDER_GATEWAYS.local.baseUrl,
    contextWindow: AVAILABLE_MODELS['local-deterministic'].contextWindow,
    temperature: AVAILABLE_MODELS['local-deterministic'].defaultTemperature,
  },
};

// ==========================================
// Provider Gateway Class
// ==========================================

export class ProviderGateway {
  /**
   * Retrieves the primary reasoning engine.
   * Route to Nemotron Ultra if API key is present; falls back to local deterministic execution otherwise.
   */
  static getPrimaryBrain(): ModelProfile {
    const overrideId = getEnv('VITE_PRIMARY_REASONING_MODEL') || getEnv('PRIMARY_REASONING_MODEL');
    let brain = RYANAI_BRAINS.nemotronUltra;

    if (overrideId === RYANAI_BRAINS.qwen27b.id) {
      brain = RYANAI_BRAINS.qwen27b;
    }

    if (!brain.apiKey) {
      console.warn(`[Gateway] Key missing for ${brain.name}. Bypassing live inference -> Routing to local fallback.`);
      return RYANAI_BRAINS.localDeterministic;
    }

    console.log(`[Gateway] Primary Brain Activated: ${brain.name}`);
    return brain;
  }

  /**
   * Retrieves the secondary validation engine.
   */
  static getSecondaryBrain(): ModelProfile {
    const overrideId = getEnv('VITE_SECONDARY_REASONING_MODEL') || getEnv('SECONDARY_REASONING_MODEL');
    let brain = RYANAI_BRAINS.qwen27b;

    if (overrideId === RYANAI_BRAINS.nemotronUltra.id) {
      brain = RYANAI_BRAINS.nemotronUltra;
    }

    if (!brain.apiKey) {
      console.warn(`[Gateway] Key missing for ${brain.name}. Bypassing secondary live inference -> Routing to local fallback.`);
      return RYANAI_BRAINS.localDeterministic;
    }

    console.log(`[Gateway] Secondary Brain Activated: ${brain.name}`);
    return brain;
  }

  /**
   * Constructs request headers for API calls.
   */
  static buildHeaders(profile: ModelProfile): HeadersInit {
    if (profile.provider === 'local' || !profile.apiKey) {
      return { 'Content-Type': 'application/json' };
    }

    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${profile.apiKey}`,
    };
  }
}

// ==========================================
// Task & Gateway Resolvers
// ==========================================

export function getPrimaryBrain(): ModelProfile {
  return ProviderGateway.getPrimaryBrain();
}

export function getSecondaryBrain(): ModelProfile {
  return ProviderGateway.getSecondaryBrain();
}

export function getModelForTask(
  task: keyof RoutingProfile,
  profileOverride?: Partial<RoutingProfile>
): ModelDefinition {
  const profile = { ...DEFAULT_ROUTING_PROFILE, ...profileOverride };
  const modelKey = profile[task] || profile.fallback;
  const model = AVAILABLE_MODELS[modelKey];

  if (!model) {
    throw new Error(`Model key '${modelKey}' mapped to task '${task}' is not defined in AVAILABLE_MODELS.`);
  }

  return model;
}

export function getGatewayForModel(model: ModelDefinition): {
  baseUrl: string;
  apiKey: string | undefined;
  timeoutMs: number;
} {
  const gateway = PROVIDER_GATEWAYS[model.provider];
  return {
    baseUrl: gateway.baseUrl,
    apiKey: getEnv(gateway.apiKeyEnvVar),
    timeoutMs: gateway.timeoutMs,
  };
}