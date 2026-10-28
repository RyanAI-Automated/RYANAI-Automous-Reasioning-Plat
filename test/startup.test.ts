import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import { connectRedis } from '../src/server/connectRedis.js';

const apiUrl = process.env.VITE_API_BASE_URL || 'http://localhost:3000';
const cleanApiUrl = apiUrl.replace(/\/\$/, '');
const apiHealthUrl = `${cleanApiUrl}/health`;
const exec = promisify(execFile);
const configUrl = new URL('../scripts/health-config.mjs', import.meta.url).href;
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function readTargets(contents: string, local = false, overrides: NodeJS.ProcessEnv = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'ryanai-health-'));
  directories.push(cwd);
  writeFileSync(join(cwd, '.env'), contents);
  const { stdout } = await exec(process.execPath, [
    '--input-type=module', '--eval',
    `import * as targets from ${JSON.stringify(configUrl)}; console.log(JSON.stringify(targets));`,
    '--', ...(local ? ['--local'] : []),
  ], { cwd, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...overrides } });
  return JSON.parse(stdout);
}

describe('startup health targets', () => {
  it('defines a valid default health URL', () => {
    expect(apiHealthUrl).toBe('http://localhost:3000/health');
  });

  it('keeps Compose defaults when no environment file values are set', async () => {
    expect(await readTargets('')).toMatchObject({
      apiUrl: 'http://localhost:3000', webUrl: 'http://localhost:9090',
    });
  });

  it('loads custom targets from .env and preserves shell overrides', async () => {
    expect(await readTargets('API_BASE_URL=http://api:4000/\nWEB_BASE_URL=http://web:8080/\n', false, {
      API_BASE_URL: 'http://shell:4001/',
    })).toMatchObject({
      apiUrl: 'http://shell:4001', apiHealthUrl: 'http://shell:4001/health', webUrl: 'http://web:8080',
    });
  });

  it('selects local defaults instead of saved Compose targets', async () => {
    expect(await readTargets('API_BASE_URL=http://api:3000\nWEB_BASE_URL=http://web:9090\nAPI_HEALTH_URL=http://api:3000/health', true)).toMatchObject({
      apiUrl: 'http://localhost:3001', apiHealthUrl: 'http://localhost:3001/health', webUrl: 'http://localhost:1420',
    });
  });

  it('respects custom local ports', async () => {
    expect(await readTargets('PORT=3002\nVITE_PORT=5174\n', true)).toMatchObject({
      apiUrl: 'http://localhost:3002', webUrl: 'http://localhost:5174',
    });
  });
});

describe('Redis startup', () => {
  it('makes integration checks exit nonzero when Redis accepts TCP but never responds', async () => {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on('data', () => {});
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing TCP address');
    const cwd = mkdtempSync(join(tmpdir(), 'ryanai-integration-'));
    directories.push(cwd);
    try {
      const result = await exec(process.execPath, [
        '--import', new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url).href,
        fileURLToPath(new URL('../scripts/test-integration.ts', import.meta.url)),
      ], {
        cwd,
        // Allow cold module loading under concurrent CI workers; Redis itself has a 200ms deadline.
        timeout: 30_000,
        env: {
          PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
          DATABASE_URL: 'postgresql://fixture@127.0.0.1:1/fixture',
          REDIS_URL: `redis://127.0.0.1:${address.port}`,
          API_BASE_URL: 'http://127.0.0.1:1', WEB_BASE_URL: 'http://127.0.0.1:1',
          MCP_URL: 'http://127.0.0.1:1',
          INTEGRATION_TIMEOUT_MS: '200',
        },
      }).catch((error: { code: number; stdout: string; stderr: string }) => error);
      expect(result).toMatchObject({ code: 1 });
      expect(result.stderr).toContain('FAIL Redis connection: Redis connection or PING timed out');
      expect(result.stdout).toContain('Integration checks: 0/7 passed; 1 skipped');
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 35_000);

  it('bounds a stalled Redis handshake and disconnects the client', async () => {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on('data', () => {});
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing TCP address');
    try {
      await expect(connectRedis(`redis://127.0.0.1:${address.port}`, 100)).rejects.toThrow('Check REDIS_URL in .env');
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Redis socket was not disconnected')), 1000);
        server.close(() => { clearTimeout(timeout); resolve(); });
      });
    } finally {
      for (const socket of sockets) socket.destroy();
      server.close();
    }
  });

  it('reports a refused connection without printing credentials', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing TCP address');
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const error = await connectRedis(`redis://:private-test-value@127.0.0.1:${address.port}`, 100).catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Redis is unavailable');
    expect((error as Error).message).not.toContain('private-test-value');
  });
});
