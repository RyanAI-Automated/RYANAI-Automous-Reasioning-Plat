import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const loader = new URL('./loadEnv.ts', import.meta.url).href;
const tsx = fileURLToPath(
  new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url),
);
const directories: string[] = [];

function runWithEnv(contents?: string, overrides: NodeJS.ProcessEnv = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'ryanai-env-'));
  directories.push(cwd);
  if (contents !== undefined) writeFileSync(join(cwd, '.env'), contents);
  const result = execFileSync(
    process.execPath,
    [
      '--import',
      tsx,
      '--input-type=module',
      '--eval',
      `import ${JSON.stringify(loader)}; console.log(JSON.stringify({redis:process.env.REDIS_URL, token:process.env.NGROK_AUTHTOKEN, port:process.env.PORT}));`,
    ],
    {
      cwd,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        ...overrides,
      },
      encoding: 'utf8',
    },
  );
  return JSON.parse(result);
}

afterEach(() => {
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe('local environment loading', () => {
  it('loads Redis credentials and tunnel configuration without logging their values', () => {
    expect(
      runWithEnv(
        'REDIS_URL=redis://:test-password@localhost:6379\nNGROK_AUTHTOKEN=test-token\nPORT=3002\n',
      ),
    ).toEqual({
      redis: 'redis://:test-password@localhost:6379',
      token: 'test-token',
      port: '3002',
    });
  });

  it('preserves values supplied by a shell or container', () => {
    expect(
      runWithEnv('REDIS_URL=redis://localhost:6379\nPORT=3002\n', {
        REDIS_URL: 'redis://:container-password@redis:6379',
        PORT: '3000',
      }),
    ).toEqual({
      redis: 'redis://:container-password@redis:6379',
      port: '3000',
    });
  });

  it('allows deployment without a local .env file', () => {
    expect(runWithEnv()).toEqual({});
  });
});