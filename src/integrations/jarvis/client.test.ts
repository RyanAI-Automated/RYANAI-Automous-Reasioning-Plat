import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  JarvisClient,
  JarvisIntegrationError,
} from './client.js';
import { buildRyanAIStackManifest } from './stackManifest.js';

const enabledEnv = {
  JARVIS_BASE_URL: 'https://jarvis.example',
  JARVIS_API_TOKEN: 'test-token-not-a-real-secret',
  JARVIS_SYNC_ENABLED: 'true',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('JarvisClient', () => {
  it('is disabled without configuration and never attempts a network call', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new JarvisClient({}, fetcher);
    const status = await client.status();

    expect(status.enabled).toBe(false);
    expect(status.configured).toBe(false);
    expect(status.reachable).toBeNull();
    expect(status.reason).toContain('JARVIS_BASE_URL');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports configured-but-disabled when sync is not explicitly enabled', async () => {
    const client = new JarvisClient({
      JARVIS_BASE_URL: enabledEnv.JARVIS_BASE_URL,
      JARVIS_API_TOKEN: enabledEnv.JARVIS_API_TOKEN,
    });
    const status = await client.status();

    expect(status.enabled).toBe(false);
    expect(status.configured).toBe(true);
    expect(status.reason).toContain('JARVIS_SYNC_ENABLED=true');
  });

  it('sends patch proposals to the configured Jarvis endpoint with bearer auth', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: 'patch-123', status: 'queued' }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new JarvisClient(enabledEnv, fetcher);
    const receipt = await client.submitPatch({
      title: 'Improve health handling',
      targetPath: 'src/health.ts',
      patchContent: 'export const healthy = true;\n',
      branch: 'feature/health',
      baseBranch: 'main',
      requestedBy: 'admin-test',
    });

    expect(receipt.accepted).toBe(true);
    expect(receipt.remoteId).toBe('patch-123');
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe('https://jarvis.example/api/v1/patches');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-token-not-a-real-secret');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      schemaVersion: 'ryanai.jarvis.patch/v1',
      source: 'ryanai',
      targetPath: 'src/health.ts',
      branch: 'feature/health',
    });
  });

  it('rejects unsafe paths before sending anything', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new JarvisClient(enabledEnv, fetcher);

    await expect(client.submitPatch({
      title: 'No traversal',
      targetPath: '../.env',
      patchContent: 'SECRET=bad',
      branch: 'feature/unsafe',
      baseBranch: 'main',
    })).rejects.toThrow(/safe relative workspace path/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('blocks production stack publishing unless explicitly enabled', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new JarvisClient(enabledEnv, fetcher);
    const manifest = buildRyanAIStackManifest('production', {
      branch: 'main',
      commitSha: 'abcdef1234567',
    });

    await expect(client.publishStack(manifest)).rejects.toBeInstanceOf(JarvisIntegrationError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('publishes a staging manifest without sending secrets', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: 'stack-123', status: 'accepted' }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new JarvisClient(enabledEnv, fetcher);
    const manifest = buildRyanAIStackManifest('staging', {
      branch: 'feat/jarvis',
      commitSha: 'abcdef1234567',
    });
    const receipt = await client.publishStack(manifest);

    expect(receipt.remoteId).toBe('stack-123');
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe('https://jarvis.example/api/v1/stacks');
    const payload = JSON.parse(String(init?.body));
    expect(payload.schemaVersion).toBe('ryanai.jarvis.stack/v1');
    expect(payload.stack.services).toHaveLength(5);
    expect(JSON.stringify(payload)).not.toContain('test-token-not-a-real-secret');
  });

  it('does not follow redirects while sending credentials', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('redirect blocked'));
    const client = new JarvisClient(enabledEnv, fetcher);

    await expect(client.submitPatch({
      title: 'Redirect test',
      targetPath: 'src/example.ts',
      patchContent: 'export {};',
      branch: 'feature/test',
      baseBranch: 'main',
    })).rejects.toThrow(/Jarvis request failed/);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1]?.redirect).toBe('error');
  });
});