import { describe, expect, it } from 'vitest';
import { resolveBrainProviderConfig } from './providerConfig.js';
import { resolveProviderProbeConfig } from './providerProbeConfig.js';

describe('independent brain provider credentials', () => {
  it('does not report cloud providers as configured without their own credentials', () => {
    const env = {
      NVIDIA_API_KEY: undefined,
      QWEN_API_KEY: undefined,
      LOGIC_API_KEY: undefined,
      OPENAI_API_KEY: undefined,
    };

    expect(resolveBrainProviderConfig('primary', env).credential).toBe(false);
    expect(resolveBrainProviderConfig('secondary', env).credential).toBe(false);
    expect(resolveBrainProviderConfig('logic', env).credential).toBe(false);
  });

  it('does not reuse a local runtime credential for explicitly configured cloud endpoints', () => {
    const env = {
      LM_STUDIO_URL: 'http://localhost:1234/v1',
      LM_STUDIO_API_KEY: 'local-test-token',
      NVIDIA_API_ENDPOINT: 'https://integrate.api.nvidia.com/v1',
      QWEN_API_ENDPOINT: 'https://api.together.xyz/v1',
      LOGIC_API_ENDPOINT: 'https://api.openai.com/v1',
    };

    expect(resolveBrainProviderConfig('primary', env)).toMatchObject({
      endpoint: 'https://integrate.api.nvidia.com/v1',
      credential: false,
    });
    expect(resolveBrainProviderConfig('secondary', env)).toMatchObject({
      endpoint: 'https://api.together.xyz/v1',
      credential: false,
    });
    expect(resolveBrainProviderConfig('logic', env)).toMatchObject({
      endpoint: 'https://api.openai.com/v1',
      credential: false,
    });
  });

  it('uses current hosted model identifiers for the default cloud endpoints', () => {
    expect(resolveBrainProviderConfig('primary', {})).toMatchObject({
      endpoint: 'https://integrate.api.nvidia.com/v1',
      model: 'nvidia/nemotron-3-ultra-550b-a55b',
    });
    expect(resolveBrainProviderConfig('secondary', {})).toMatchObject({
      endpoint: 'https://api.together.xyz/v1',
      model: 'Qwen/Qwen3-235B-A22B-Instruct-2507-tput',
    });
  });

  it('accepts each cloud provider credential independently', () => {
    expect(resolveBrainProviderConfig('primary', { NVIDIA_API_KEY: 'nvidia-test' }).credential).toBe(true);
    expect(resolveBrainProviderConfig('secondary', { QWEN_API_KEY: 'qwen-test' }).credential).toBe(true);
    expect(resolveBrainProviderConfig('logic', { LOGIC_API_KEY: 'logic-test' }).credential).toBe(true);
  });

  it('supports the documented OpenAI compatibility key fallback', () => {
    expect(resolveBrainProviderConfig('logic', { OPENAI_API_KEY: 'openai-test' }).credential).toBe(true);
  });

  it('allows a shared local credential only when the brain actually targets the local runtime', () => {
    const env = {
      LM_STUDIO_URL: 'http://localhost:1234/v1',
      LM_STUDIO_API_KEY: 'local-test-token',
    };

    for (const brain of ['primary', 'secondary', 'logic'] as const) {
      expect(resolveBrainProviderConfig(brain, env)).toMatchObject({
        endpoint: 'http://localhost:1234/v1',
        credential: true,
      });
    }
  });
});

describe('isolated provider probe credential resolution', () => {
  it.each([
    ['primary', 'NVIDIA_API_KEY'],
    ['secondary', 'QWEN_API_KEY'],
    ['logic', 'LOGIC_API_KEY'],
  ] as const)('maps the selected workflow credential for %s', (brain, secretName) => {
    const config = resolveProviderProbeConfig(brain, {
      PROVIDER_API_KEY: ' selected-test-credential ',
      [secretName]: undefined,
    });
    expect(config.apiKey).toBe('selected-test-credential');
    expect(config.endpoint).toMatch(/^https:\/\//);
    expect(config.model).toBeTruthy();
  });

  it('does not fall back to a different cloud provider credential', () => {
    expect(resolveProviderProbeConfig('primary', { QWEN_API_KEY: 'qwen-only' }).apiKey).toBe('');
    expect(resolveProviderProbeConfig('secondary', { NVIDIA_API_KEY: 'nvidia-only' }).apiKey).toBe('');
  });

  it('supports the documented OpenAI key fallback for the Logic brain', () => {
    expect(resolveProviderProbeConfig('logic', { OPENAI_API_KEY: 'openai-test' }).apiKey).toBe('openai-test');
  });
});

