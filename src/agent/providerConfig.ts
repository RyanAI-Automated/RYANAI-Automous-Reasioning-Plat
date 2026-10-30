import type { BrainId } from './operationsCore.js';

export interface BrainProviderConfig {
  model: string;
  endpoint: string;
  credential: boolean;
}

type ProviderEnvironment = Record<string, string | undefined>;

/** Resolve each brain's endpoint and credential independently. Shared local
 * credentials are accepted only when that brain actually targets the local
 * runtime, never as a false-positive for a cloud endpoint. */
export function resolveBrainProviderConfig(
  brain: BrainId,
  env: ProviderEnvironment = process.env,
): BrainProviderConfig {
  if (brain === 'primary') {
    const endpoint = env.NVIDIA_API_ENDPOINT || env.LM_STUDIO_URL || env.OLLAMA_URL || 'https://integrate.api.nvidia.com/v1';
    const sharedLocalCredential = !env.NVIDIA_API_ENDPOINT && Boolean(env.LM_STUDIO_URL || env.OLLAMA_URL) && Boolean(env.LM_STUDIO_API_KEY);
    return {
      model: env.PRIMARY_REASONING_MODEL || env.NVIDIA_MODEL || 'nvidia/nemotron-3-ultra',
      endpoint,
      credential: Boolean(env.NVIDIA_API_KEY) || sharedLocalCredential,
    };
  }

  if (brain === 'secondary') {
    const endpoint = env.QWEN_API_ENDPOINT || env.LM_STUDIO_URL || 'https://api.together.xyz/v1';
    const sharedLocalCredential = !env.QWEN_API_ENDPOINT && Boolean(env.LM_STUDIO_URL) && Boolean(env.LM_STUDIO_API_KEY);
    return {
      model: env.SECONDARY_REASONING_MODEL || env.QWEN_MODEL || 'Qwen/Qwen3-235B-A22B-Instruct-2507',
      endpoint,
      credential: Boolean(env.QWEN_API_KEY) || sharedLocalCredential,
    };
  }

  const endpoint = env.LOGIC_API_ENDPOINT || env.LM_STUDIO_URL || env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const sharedLocalCredential = Boolean(env.LM_STUDIO_URL) && endpoint === env.LM_STUDIO_URL && Boolean(env.LM_STUDIO_API_KEY);
  return {
    model: env.LOGIC_REASONING_MODEL || env.LM_STUDIO_MODEL || env.OPENAI_MODEL || 'gpt-4o-mini',
    endpoint,
    credential: Boolean(env.LOGIC_API_KEY || env.OPENAI_API_KEY) || sharedLocalCredential,
  };
}
