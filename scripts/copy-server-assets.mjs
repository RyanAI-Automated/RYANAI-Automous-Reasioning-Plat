import { access, cp, copyFile, mkdir } from 'node:fs/promises';

// These JSON imports resolve outside dist/server after TypeScript compilation.
for (const file of ['app/routes.json', 'models/catalog.json', 'stacks/ryanai.stack.json']) {
  const source = new URL(`../${file}`, import.meta.url);
  const destination = new URL(`../dist/${file}`, import.meta.url);
  await mkdir(new URL('.', destination), { recursive: true });
  await copyFile(source, destination);
}

// Prisma's generated audiobook client is JavaScript, not TypeScript source.
// TypeScript resolves its declarations for type-checking but does not reliably
// emit the generated runtime files. Copy the complete client beside the
// compiled server import so audiobook routes can load without using the main
// DATABASE_URL as a fallback.
const audiobookClientSource = new URL('../src/generated/audiobook-prisma/', import.meta.url);
const audiobookClientDestination = new URL('../dist/server/generated/audiobook-prisma/', import.meta.url);
await mkdir(new URL('../dist/server/generated/', import.meta.url), { recursive: true });
await cp(audiobookClientSource, audiobookClientDestination, { recursive: true, force: true });

// Fail the build now rather than shipping an image that crashes at module load.
await access(new URL('../dist/server/generated/audiobook-prisma/index.js', import.meta.url));
