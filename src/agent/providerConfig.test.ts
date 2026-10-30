import { describe, expect, it } from 'vitest';
import { resolveBrainProviderConfig } from './providerConfig.js';

describe('resolveBrainProviderConfig', () => {
  it('resolves three cloud brains with independent credentials and endpoints', () => {
    const env = {
      NVIDIA_API_KEY: 'nvidia-secret',
      NVIDIA_API_ENDPOINT: 'https://integrate.api.nvidia.com/v1',
      QWEN_API_KEY: 'qwen-secret',
      QWEN_API_ENDPOINT: 'https://api.together.xyz/v1',
      LOGIC_API_KEY: 'logic-secret',
      LOGIC_API_ENDPOINT: 'https://api.openai.com/v1',
    };
    expect(resolveBrainProviderConfig('primary', env)).toMatchObject({ endpoint: 'https://integrate.api.nvidia.com/v1', credential: true });
    expect(resolveBrainProviderConfig('secondary', env)).toMatchObject({ endpoint: 'https://api.together.xyz/v1', credential: true });
    expect(resolveBrainProviderConfig('logic', env)).toMatchObject({ endpoint: 'https://api.openai.com/v1', credential: true });
  });

  it('does not mistake a local-runtime key for a cloud logic credential', () => {
    const env = { LM_STUDIO_URL: 'http://127.0.0.1:1234/v1', LM_STUDIO_API_KEY: 'local-only-key', LOGIC_API_ENDPOINT: 'https://api.openai.com/v1' };
    expect(resolveBrainProviderConfig('logic', env)).toMatchObject({ endpoint: 'https://api.openai.com/v1', credential: false });
  });

  it('allows a shared local credential only when logic targets LM Studio', () => {
    const env = { LM_STUDIO_URL: 'http://127.0.0.1:1234/v1', LM_STUDIO_API_KEY: 'local-only-key' };
    expect(resolveBrainProviderConfig('logic', env)).toMatchObject({ endpoint: 'http://127.0.0.1:1234/v1', credential: true });
  });

  it('does not use another cloud brain key as a fallback', () => {
    const env = { NVIDIA_API_KEY: 'nvidia-secret', QWEN_API_KEY: 'qwen-secret' };
    expect(resolveBrainProviderConfig('logic', env).credential).toBe(false);
  });
});
