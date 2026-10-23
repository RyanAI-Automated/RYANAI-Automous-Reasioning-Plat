import { copyFile, mkdir } from 'node:fs/promises';

// These JSON imports resolve outside dist/server after TypeScript compilation.
for (const file of ['app/routes.json', 'models/catalog.json']) {
  const source = new URL(`../${file}`, import.meta.url);
  const destination = new URL(`../dist/${file}`, import.meta.url);
  await mkdir(new URL('.', destination), { recursive: true });
  await copyFile(source, destination);
}
