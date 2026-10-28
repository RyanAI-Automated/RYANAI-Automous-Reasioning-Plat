import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const expectedVersion = '2.4.0';
const locked = lock.packages?.['node_modules/body-parser'];
const errors = [];

if (packageJson.overrides?.['body-parser'] !== expectedVersion) {
  errors.push(`package.json must override body-parser to ${expectedVersion}`);
}
if (locked?.version !== expectedVersion) {
  errors.push(`package-lock.json resolves body-parser to ${locked?.version ?? 'missing'}; expected ${expectedVersion}`);
}
if (locked?.resolved !== `https://registry.npmjs.org/body-parser/-/body-parser-${expectedVersion}.tgz`) {
  errors.push('package-lock.json does not use the official patched body-parser tarball');
}
if (!locked?.integrity) {
  errors.push('package-lock.json is missing the body-parser integrity checksum');
}

if (errors.length) {
  console.error(errors.map((message) => `ERROR ${message}`).join('\n'));
  process.exit(1);
}
console.log(`PASS MCP dependency policy: body-parser ${expectedVersion} is pinned and locked`);
