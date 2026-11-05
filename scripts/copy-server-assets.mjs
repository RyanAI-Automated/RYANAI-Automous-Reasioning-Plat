import { access, cp, copyFile, mkdir } from 'node:fs/promises';

// These JSON imports resolve outside dist/server after TypeScript compilation.
for (const file of ['app/routes.json', 'models/catalog.json', 'stacks/ryanai.stack.json']) {
  const source = new URL(`../${file}`, import.meta.url);
  const destination = new URL(`../dist/${file}`, import.meta.url);
  await mkdir(new URL('.', destination), { recursive: true });
  await copyFile(source, destination);
}

// Prisma generates this separate client inside src/ before build:server runs.
// TypeScript resolves its declarations for type-checking but does not reliably
// emit the generated JavaScript package. Copy the complete runtime client into
// the directory referenced by dist/server/lib/audiobookPrisma.js.
const generatedClientSource = new URL('../src/generated/audiobook-prisma/', import.meta.url);
const generatedClientEntry = new URL('index.js', generatedClientSource);
const generatedClientDestination = new URL('../dist/server/generated/audiobook-prisma/', import.meta.url);

await access(generatedClientEntry);
await mkdir(new URL('../dist/server/generated/', import.meta.url), { recursive: true });
await cp(generatedClientSource, generatedClientDestination, {
  recursive: true,
  force: true,
});
