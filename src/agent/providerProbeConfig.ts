import { resolveBrainProviderConfig, type BrainProviderConfig } from './providerConfig.js';
import type { BrainId } from './operationsCore.js';

type ProbeEnvironment = Record<string, string | undefined>;

const providers: Record<BrainId, {
  key: string;
  endpoint: string;
  model: string;
}> = {
  primary: { key: 'NVIDIA_API_KEY', endpoint: 'NVIDIA_API_ENDPOINT', model: 'PRIMARY_REASONING_MODEL' },
  secondary: { key: 'QWEN_API_KEY', endpoint: 'QWEN_API_ENDPOINT', model: 'SECONDARY_REASONING_MODEL' },
  logic: { key: 'LOGIC_API_KEY', endpoint: 'LOGIC_API_ENDPOINT', model: 'LOGIC_REASONING_MODEL' },
};

export interface ProbeProviderConfig {
  apiKey: string;
  model: string;
  endpoint: string;
}

/**
 * The CI probe receives the selected GitHub Environment secret through the
 * single-purpose PROVIDER_API_KEY variable. Normalize it, map it into the
 * provider-specific configuration expected by the runtime resolver, and use
 * the explicit selected credential for the SDK client. The presence of this
 * explicit credential must not be re-gated by a separate resolver boolean.
 */
export function resolveProviderProbeConfig(
  brain: BrainId,
  env: ProbeEnvironment = process.env,
): ProbeProviderConfig {
  const provider = providers[brain];
  const apiKey =
    env.PROVIDER_API_KEY?.trim() ||
    env[provider.key]?.trim() ||
    (brain === 'logic' ? env.OPENAI_API_KEY?.trim() : undefined) ||
    '';

  const configEnv = {
    ...env,
    [provider.key]: apiKey || undefined,
  };
  const resolved: BrainProviderConfig = resolveBrainProviderConfig(brain, configEnv);

  return {
    apiKey,
    model: env[provider.model]?.trim() || resolved.model,
    endpoint: env[provider.endpoint]?.trim() || resolved.endpoint,
  };
}
