import type { BrainId } from './operationsCore.js';

export type CanonicalBrainRole = 'nvidia' | 'qwen' | 'logic';
export type InferenceAdapter = 'openai-compatible' | 'ollama';

export interface BrainProviderConfig {
  role: CanonicalBrainRole;
  adapter: InferenceAdapter;
  model: string;
  endpoint: string;
  credential: boolean;
}

type ProviderEnvironment = Record<string, string | undefined>;

const OLLAMA_DEFAULT_ENDPOINT = 'http://127.0.0.1:11434/v1';

function selectedAdapter(brain: BrainId, env: ProviderEnvironment): InferenceAdapter {
  const selector = (brain === 'primary' ? env.PRIMARY_REASONING_PROVIDER || env.NVIDIA_PROVIDER
    : brain === 'secondary' ? env.SECONDARY_REASONING_PROVIDER || env.QWEN_PROVIDER
      : env.LOGIC_REASONING_PROVIDER || env.LOGIC_PROVIDER)?.trim().toLowerCase();
  const accepted = brain === 'primary' ? ['nvidia', 'ollama']
    : brain === 'secondary' ? ['qwen', 'ollama']
      : ['logic', 'openai', 'openai-compatible', 'ollama'];
  if (selector && !accepted.includes(selector)) {
    throw new Error('Unsupported provider selection for the ' + brain + ' brain.');
  }
  if (selector === 'ollama' || (!selector && brain === 'primary' && env.OLLAMA_PRIMARY_ENABLED === 'true')) return 'ollama';
  return 'openai-compatible';
}

function validateEndpoint(endpoint: string, role: CanonicalBrainRole): string {
  let parsed: URL;
  try { parsed = new URL(endpoint); } catch { throw new Error('Invalid endpoint for the ' + role + ' brain.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname.toLowerCase());
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.protocol !== 'https:' && !loopback)) {
    throw new Error('The ' + role + ' brain endpoint must use HTTPS unless it is loopback, without embedded credentials or query strings.');
  }
  return endpoint;
}

/**
 * The API owns this canonical mapping. NVIDIA, Qwen and Logic are reasoning
 * roles; Ollama is an optional local inference adapter that can serve a role.
 * Selecting Ollama is explicit and never falls back to a cloud provider.
 */
export function resolveBrainProviderConfig(
  brain: BrainId,
  env: ProviderEnvironment = process.env,
): BrainProviderConfig {
  const role: CanonicalBrainRole = brain === 'primary' ? 'nvidia' : brain === 'secondary' ? 'qwen' : 'logic';
  if (selectedAdapter(brain, env) === 'ollama') {
    const roleModel = brain === 'primary' ? env.PRIMARY_REASONING_MODEL
      : brain === 'secondary' ? env.SECONDARY_REASONING_MODEL : env.LOGIC_REASONING_MODEL;
    return {
      role,
      adapter: 'ollama',
      model: env.OLLAMA_MODEL || roleModel || '',
      endpoint: validateEndpoint(env.OLLAMA_BASE_URL || env.OLLAMA_URL || OLLAMA_DEFAULT_ENDPOINT, role),
      credential: false,
    };
  }

  if (brain === 'primary') {
    const endpoint = env.NVIDIA_API_ENDPOINT || 'https://integrate.api.nvidia.com/v1';
    return {
      role,
      adapter: 'openai-compatible',
      model: env.PRIMARY_REASONING_MODEL || env.NVIDIA_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b',
      endpoint: validateEndpoint(endpoint, role),
      credential: Boolean(env.NVIDIA_API_KEY),
    };
  }

  if (brain === 'secondary') {
    const endpoint = env.QWEN_API_ENDPOINT || 'https://api.together.xyz/v1';
    return {
      role,
      adapter: 'openai-compatible',
      model: env.SECONDARY_REASONING_MODEL || env.QWEN_MODEL || 'Qwen/Qwen3-235B-A22B-Instruct-2507-tput',
      endpoint: validateEndpoint(endpoint, role),
      credential: Boolean(env.QWEN_API_KEY),
    };
  }

  const endpoint = env.LOGIC_API_ENDPOINT || env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  return {
    role,
    adapter: 'openai-compatible',
    model: env.LOGIC_REASONING_MODEL || env.LM_STUDIO_MODEL || env.OPENAI_MODEL || 'gpt-4o-mini',
    endpoint: validateEndpoint(endpoint, role),
    credential: Boolean(env.LOGIC_API_KEY || env.OPENAI_API_KEY),
  };
}
