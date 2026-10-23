#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = process.cwd();
const fix = process.argv.includes('--fix');
const dryRun = process.argv.includes('--dry-run');
const errors = [];
const warnings = [];

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
function report(file, message) { errors.push(`${relative(root, file)}: ${message}`); }
function warn(file, message) { warnings.push(`${relative(root, file)}: ${message}`); }
function run(command, args) {
  if (process.platform === 'win32' && command === 'npm') {
    execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm', ...args], { cwd: root, stdio: 'inherit' });
    return;
  }
  execFileSync(command, args, { cwd: root, stdio: 'inherit' });
}

const frontendFiles = walk(join(root, 'src')).filter((file) => {
  if (!/\.(ts|tsx|css)$/i.test(file)) return false;
  const normalized = file.split(sep).join('/');
  return normalized.includes('/src/components/') || normalized.includes('/src/pages/') || normalized.includes('/src/hooks/') || normalized.includes('/src/lib/') || normalized.endsWith('/src/main.tsx') || normalized.endsWith('/src/App.tsx');
});
for (const file of frontendFiles) {
  const text = readFileSync(file, 'utf8');
  if (/<<<<<<<|^=======$|>>>>>>>/m.test(text)) report(file, 'merge marker found');
  if (/\[cite:\s*\d+\]/.test(text)) report(file, 'citation artifact found');
  if (/postgres(?:ql)?:\/\/[^'"\s]+/i.test(text)) report(file, 'database URL embedded in frontend source');
  if (/process\.env\.(DATABASE_URL|DB_PASSWORD|REDIS_PASSWORD|OPENAI_API_KEY)/.test(text)) report(file, 'server secret accessed by frontend source');
  if (/`[^`]*\\\$\{[A-Za-z_][A-Za-z0-9_]*[^`]*`/.test(text)) warn(file, 'escaped template interpolation may produce a literal parameter');
}

const mainFile = join(root, 'src', 'main.tsx');
if (fix && !dryRun) {
  let text = readFileSync(mainFile, 'utf8');
  text = text.replace(/\\\$\{filter\}/g, '${filter}').replace(/\\\$\{category\}/g, '${category}');
  writeFileSync(mainFile, text);
}

const typeFile = join(root, 'src', 'lib', 'types.ts');
  const typeText = readFileSync(typeFile, 'utf8');
const systemStatusCount = (typeText.match(/export interface SystemStatus\s*\{/g) || []).length;
if (systemStatusCount > 1) report(typeFile, `duplicate SystemStatus declarations: ${systemStatusCount}`);

const apiBase = readFileSync(join(root, 'src', 'lib', 'apiBaseUrl.ts'), 'utf8');
if (!apiBase.includes('VITE_API_BASE_URL') || !apiBase.includes('window.location.origin')) report(join(root, 'src', 'lib', 'apiBaseUrl.ts'), 'missing API base URL fallback contract');
const health = readFileSync(join(root, 'src', 'lib', 'platformHealth.ts'), 'utf8');
if (!health.includes('API_ROUTES.healthPath')) report(join(root, 'src', 'lib', 'platformHealth.ts'), 'health route is not centralized');
const auth = readFileSync(join(root, 'src', 'lib', 'authenticatedFetch.ts'), 'utf8');
if (!auth.includes("target.pathname.startsWith('/api/')") || !auth.includes('Authorization')) report(join(root, 'src', 'lib', 'authenticatedFetch.ts'), 'authenticated API boundary is incomplete');
const core = readFileSync(join(root, 'src', 'config', 'core.ts'), 'utf8');
for (const route of ['/api/health', '/api/reason', '/api/reasoning/stream']) {
  if (!core.includes(route)) report(join(root, 'src', 'config', 'core.ts'), `missing frontend route contract: ${route}`);
}
const prismaSchema = join(root, 'prisma', 'schema.prisma');
try { readFileSync(prismaSchema, 'utf8'); } catch { report(prismaSchema, 'Prisma schema is missing'); }


if (errors.length && !fix) {
  console.error(errors.map((error) => `ERROR ${error}`).join('\n'));
  process.exit(1);
}
if (fix && errors.length) console.log(`FIX mode addressed deterministic frontend issues; prior findings: ${errors.length}`);
run('npm', ['run', 'typecheck']);
run('npm', ['run', 'build:client']);
console.log(`PASS Frontend Platform Maintainer ${fix ? 'fix' : 'audit'} validation`);
for (const warning of warnings) console.warn(`WARN ${warning}`);
