import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('supported CLI entrypoints all launch the persistent API runtime', () => {
  for (const path of ['cli.ts', 'bin/ryan-cli.js', 'src/utils/nodeSupport.ts']) {
    const source = read(path);
    assert.match(source, /src\/server\/launcher\.ts/, path + ' must launch the supported API runtime');
    assert.doesNotMatch(source, /src\/server\/index\.ts/, path + ' must not launch the legacy server');
  }
});

test('legacy server entrypoints are quarantined before they can start services', () => {
  for (const path of ['src/server/index.ts', 'src/server.ts']) {
    const source = read(path);
    assert.match(source, /intentionally quarantined/, path + ' must identify its quarantine');
    assert.match(source, /Unsupported legacy API entrypoint/, path + ' must fail with migration guidance');
    assert.doesNotMatch(source, /from ['"]fastify['"]|JWT_SECRET|server\.listen|startTelemetry\(\)|startMeshBroadcast/, path + ' must not initialize a legacy server');
  }
});

test('package scripts use the same persistent API runtime and run the regression test', () => {
  const packageJson = JSON.parse(read('package.json'));
  assert.equal(packageJson.scripts.start, 'node dist/server/server/launcher.js');
  assert.match(packageJson.scripts['dev:api'], /src\/server\/launcher\.ts/);
  assert.equal(
    packageJson.scripts['test:legacy-server-entrypoints'],
    'node --test scripts/legacy-server-entrypoints.node-test.mjs',
  );
  assert.match(packageJson.scripts.validate, /npm run test:legacy-server-entrypoints/);
});
