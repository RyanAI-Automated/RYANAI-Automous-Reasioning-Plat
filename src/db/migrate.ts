/**
 * Apply committed Prisma migrations explicitly.
 *
 * Application startup must only verify schema readiness; it must never use
 * prisma db push or run schema DDL implicitly.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const prismaCli = resolve(
  process.cwd(),
  'node_modules',
  'prisma',
  'build',
  'index.js',
);

const child = spawn(process.execPath, [prismaCli, 'migrate', 'deploy'], {
  stdio: 'inherit',
  shell: false,
});

child.on('error', (error) => {
  console.error('Failed to start Prisma migration deployment:', error.message);
  process.exitCode = 1;
});

child.on('close', (code) => {
  process.exitCode = code ?? 1;
});
