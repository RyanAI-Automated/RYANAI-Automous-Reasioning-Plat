import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const sourceHelper = new URL('./copy-server-assets.mjs', import.meta.url);

test('copy-server-assets includes the generated audiobook Prisma runtime client', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ryanai-server-assets-'));
  try {
    const fixturePaths = [
      'scripts',
      'app',
      'models',
      'stacks',
      'src/generated/audiobook-prisma/runtime',
    ];
    for (const relativePath of fixturePaths) {
      await mkdir(path.join(root, relativePath), { recursive: true });
    }

    await cp(sourceHelper, path.join(root, 'scripts/copy-server-assets.mjs'));
    await writeFile(path.join(root, 'app/routes.json'), '{}\n');
    await writeFile(path.join(root, 'models/catalog.json'), '{}\n');
    await writeFile(path.join(root, 'stacks/ryanai.stack.json'), '{}\n');
    await writeFile(path.join(root, 'src/generated/audiobook-prisma/index.js'), 'export const fixture = true;\n');
    await writeFile(path.join(root, 'src/generated/audiobook-prisma/runtime/client.js'), 'export const runtimeFixture = true;\n');

    const helperPath = pathToFileURL(path.join(root, 'scripts/copy-server-assets.mjs')).href;
    await import(`${helperPath}?test=${Date.now()}`);

    assert.equal(
      await readFile(path.join(root, 'dist/server/generated/audiobook-prisma/index.js'), 'utf8'),
      'export const fixture = true;\n',
    );
    assert.equal(
      await readFile(path.join(root, 'dist/server/generated/audiobook-prisma/runtime/client.js'), 'utf8'),
      'export const runtimeFixture = true;\n',
    );
    assert.equal(await readFile(path.join(root, 'dist/app/routes.json'), 'utf8'), '{}\n');
    assert.equal(await readFile(path.join(root, 'dist/models/catalog.json'), 'utf8'), '{}\n');
    assert.equal(await readFile(path.join(root, 'dist/stacks/ryanai.stack.json'), 'utf8'), '{}\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
