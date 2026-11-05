import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await sourceFiles(path));
    else if (/\\.(?:ts|tsx|js|jsx)$/.test(entry.name)) results.push(path);
  }
  return results;
}

test('audiobook Prisma client stays on the server-only boundary', async () => {
  const serverClient = join(root, 'src/server/audiobookPrisma.ts');
  const legacyClient = join(root, 'src/lib/audiobookPrisma.ts');
  const config = JSON.parse(await readFile(join(root, 'tsconfig.app.json'), 'utf8'));
  const excluded = config.exclude ?? [];

  assert.ok((await stat(serverClient)).isFile(), 'server-only Prisma client must exist');
  await assert.rejects(stat(legacyClient), 'shared lib must not contain the server-only Prisma client');
  assert.ok(
    excluded.some((entry) => entry === 'src/server/**' || entry === 'src/server/**/*'),
    'browser TypeScript project must exclude server modules',
  );

  const browserRoots = [
    'src/pages',
    'src/components',
    'src/hooks',
    'src/store',
    'src/lib',
    'src/shared',
    'src/services',
  ];
  const files = (await Promise.all(browserRoots.map((path) => sourceFiles(join(root, path))))).flat();
  const offenders = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (/(?:from\\s*|import\\s*\\()(['"])(?:@\\/server|@\\/lib\\/audiobookPrisma|\\.\\.\\/server\\/audiobookPrisma)/.test(source)) {
      offenders.push(relative(root, file));
    }
  }
  assert.deepEqual(offenders, [], 'browser source must not import the server-only audiobook Prisma client');

  const launcher = await readFile(join(root, 'src/server/launcher.ts'), 'utf8');
  const worker = await readFile(join(root, 'scripts/audiobook-render-worker.ts'), 'utf8');
  assert.match(launcher, /from ['"]\\.\\/audiobookPrisma\\.js['"]/);
  assert.match(worker, /from ['"]\\.\\.\\/src\\/server\\/audiobookPrisma\\.js['"]/);
});
