import { createServer } from 'node:http';
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
  it('round-trips authenticated health, patch, and staging-stack requests over HTTP', async () => {
    const authorizationHeaders: Array<string | undefined> = [];
    const paths: string[] = [];
    const payloads: unknown[] = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      request.on('end', () => {
        authorizationHeaders.push(request.headers.authorization);
        paths.push(request.url || '/');
        const rawBody = Buffer.concat(chunks).toString('utf8');
        payloads.push(rawBody ? JSON.parse(rawBody) as unknown : undefined);

        if (request.headers.authorization !== 'Bearer staging-contract-token') {
          response.writeHead(401, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
        response.writeHead(request.method === 'GET' ? 200 : 202, {
          'content-type': 'application/json',
        });
        if (request.method === 'GET') {
          response.end(JSON.stringify({ status: 'ok' }));
        } else if (request.url === '/api/v1/patches') {
          response.end(JSON.stringify({ id: 'stage-patch-1', status: 'accepted' }));
        } else if (request.url === '/api/v1/stacks') {
          response.end(JSON.stringify({ id: 'stage-stack-1', status: 'accepted' }));
        } else {
          response.end(JSON.stringify({ error: 'not found' }));
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Local Jarvis contract fixture did not bind a TCP port.');
      }
      const client = new JarvisClient({
        JARVIS_BASE_URL: `http://127.0.0.1:${address.port}`,
        JARVIS_API_TOKEN: 'staging-contract-token',
        JARVIS_SYNC_ENABLED: 'true',
      });

      const status = await client.status();
      expect(status).toMatchObject({ enabled: true, reachable: true, remoteStatus: 'ok' });

      const patch = await client.submitPatch({
        title: 'Contract fixture patch',
        targetPath: 'src/health.ts',
        patchContent: 'export const healthy = true;',
        branch: 'feature/health',
        baseBranch: 'main',
      });
      expect(patch).toMatchObject({ accepted: true, statusCode: 202, remoteId: 'stage-patch-1' });

      const stack = await client.publishStack(buildRyanAIStackManifest('staging', {
        branch: 'staging',
        commitSha: 'abcdef1234567',
      }));
      expect(stack).toMatchObject({ accepted: true, statusCode: 202, remoteId: 'stage-stack-1' });

      expect(paths).toEqual(['/health', '/api/v1/patches', '/api/v1/stacks']);
      expect(authorizationHeaders).toEqual([
        'Bearer staging-contract-token',
        'Bearer staging-contract-token',
        'Bearer staging-contract-token',
      ]);
      expect(payloads[1]).toMatchObject({
        schemaVersion: 'ryanai.jarvis.patch/v1',
        source: 'ryanai',
        targetPath: 'src/health.ts',
      });
      expect(payloads[2]).toMatchObject({
        schemaVersion: 'ryanai.jarvis.stack/v1',
        stack: { environment: 'staging' },
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

});