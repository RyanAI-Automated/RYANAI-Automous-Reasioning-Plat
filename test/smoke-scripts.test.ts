import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installAuthentication } from '../src/server/routes/auth.js';
import { checkWebSocket } from '../scripts/check-websocket.js';

const { createContextClient } = vi.hoisted(() => ({
  createContextClient: vi.fn(),
}));
vi.mock('@supabase/server/core', () => ({ createContextClient }));
const exec = promisify(execFile);
const applications: FastifyInstance[] = [];
const directories: string[] = [];

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://fixture.supabase.co');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'fixture-public-key');
  createContextClient.mockImplementation(
    ({ auth }: { auth: { token: string } }) => ({
      auth: {
        getUser: async () => ({
          data: {
            user: ['fixture-user', 'fixture-admin'].includes(auth.token)
              ? {
                  id: 'fixture-id',
                  is_anonymous: false,
                  app_metadata: {
                    role: auth.token === 'fixture-admin' ? 'admin' : 'user',
                  },
                }
              : null,
          },
          error: null,
        }),
      },
    }),
  );
});

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

async function fixture(protectedRoutes = true) {
  const app = Fastify();
  applications.push(app);
  if (protectedRoutes) installAuthentication(app);
  await app.register(websocket);
  app.get('/health', async () => ({
    status: 'online',
    services: { database: true, redis: true },
  }));
  app.get('/', async (_request, reply) =>
    reply.type('text/html').send('<html>Fixture</html>'),
  );
  app.post('/api/reason', async (_request, reply) =>
    reply.code(400).send({ error: 'Empty prompt' }),
  );
  app.get('/ws', { websocket: true }, (socket) => socket.on('error', () => {}));
  return app.listen({ port: 0, host: '127.0.0.1' });
}

async function runScript(
  url: string,
  options: { local?: boolean; tokens?: string; integration?: boolean } = {},
) {
  const cwd = mkdtempSync(join(tmpdir(), 'ryanai-smoke-'));
  directories.push(cwd);
  const port = new URL(url).port;
  writeFileSync(
    join(cwd, '.env'),
    options.local
      ? `API_BASE_URL=http://127.0.0.1:1\nWEB_BASE_URL=http://127.0.0.1:1\nAPI_HEALTH_URL=http://127.0.0.1:1\nPORT=${port}\nVITE_PORT=${port}\n${options.tokens || ''}`
      : `API_BASE_URL=${url}/\nWEB_BASE_URL=${url}/\nAPI_HEALTH_URL=${url}/health\n${options.tokens || ''}`,
  );
  try {
    const result = await exec(
      process.execPath,
      [
        '--import',
        fileURLToPath(
          new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url),
        ),
        fileURLToPath(
          new URL(
            options.integration
              ? '../scripts/test-integration.ts'
              : '../scripts/test-e2e-flow.ts',
            import.meta.url,
          ),
        ),
        ...(options.local ? ['--local'] : []),
      ],
      {
        cwd,
        timeout: 20_000,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          E2E_TIMEOUT_MS: '1000',
          INTEGRATION_TIMEOUT_MS: '1000',
          DATABASE_URL: 'postgresql://fixture@127.0.0.1:1/fixture',
          REDIS_URL: 'redis://127.0.0.1:1',
        },
      },
    );
    return { ...result, code: 0 };
  } catch (error) {
    return error as { code: number; stdout: string; stderr: string };
  }
}

describe('live smoke script contracts', () => {
  it('loads .env, verifies anonymous rejection, and reports missing credentials as skipped', async () => {
    const result = await runScript(await fixture());
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('End-to-end checks: 4/4 passed; 2 skipped');
  });

  it('uses local ports and bearer headers for authenticated positive checks', async () => {
    const result = await runScript(await fixture(), {
      local: true,
      tokens:
        'TEST_USER_ACCESS_TOKEN=fixture-user\nTEST_ADMIN_ACCESS_TOKEN=fixture-admin',
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('End-to-end checks: 6/6 passed; 0 skipped');
  });

  it('fails rather than skipping invalid tokens or non-admin WebSocket users', async () => {
    const result = await runScript(await fixture(), {
      tokens:
        'TEST_USER_ACCESS_TOKEN=fixture-invalid\nTEST_ADMIN_ACCESS_TOKEN=fixture-user',
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Expected HTTP 400, received HTTP 401');
    expect(result.stderr).toContain(
      'Expected WebSocket upgrade, received HTTP 403',
    );
    expect(result.stderr).not.toContain('fixture-invalid');
    expect(result.stderr).not.toContain('fixture-user');
  });

  it('fails when anonymous reasoning and WebSocket access are exposed', async () => {
    const result = await runScript(await fixture(false));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Expected HTTP 401, received HTTP 400');
    expect(result.stderr).toContain(
      'Expected HTTP 401, received WebSocket upgrade',
    );
  });

  it('integration checks share the authenticated WebSocket contract while reporting unavailable databases', async () => {
    const result = await runScript(await fixture(), {
      integration: true,
      tokens: 'TEST_ADMIN_ACCESS_TOKEN=fixture-admin',
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      'PASS WebSocket endpoint rejects anonymous upgrades',
    );
    expect(result.stdout).toContain(
      'PASS Authenticated admin WebSocket accepts upgrades',
    );
    expect(result.stdout).toContain(
      'Integration checks: 6/8 passed; 0 skipped',
    );
  });

  it('does not treat transport failures as successful access denial', async () => {
    await expect(
      checkWebSocket('http://127.0.0.1:1', 1000, { expectedStatus: 401 }),
    ).rejects.toThrow('WebSocket connection failed');
  });
});
