#!/usr/bin/env node
/**
 * Read-only inventory of package scripts, repository scripts, and GitHub Actions
 * workflows. It never executes discovered commands or reads environment values.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  '.git', '.next', '.turbo', '.vercel', '.vite', 'build', 'coverage',
  'dist', 'node_modules', 'out', 'target', '.venv', 'venv',
]);
const SCRIPT_EXTENSIONS = new Set([
  '.cjs', '.js', '.mjs', '.cts', '.ts', '.mts', '.tsx', '.py', '.sh', '.ps1',
]);

async function walkFiles(directory, ignoredDirectories) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...await walkFiles(absolutePath, ignoredDirectories));
      }
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

function relative(rootDir, absolutePath) {
  return path.relative(rootDir, absolutePath).split(path.sep).join('/');
}

export async function generateRepositoryInventory({
  rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  ignoredDirectories = DEFAULT_IGNORED_DIRECTORIES,
} = {}) {
  const root = path.resolve(rootDir);
  const files = await walkFiles(root, ignoredDirectories);
  const packageFiles = files.filter((file) => path.basename(file) === 'package.json');
  const packages = [];

  for (const manifestPath of packageFiles) {
    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    } catch (error) {
      packages.push({
        path: relative(root, manifestPath),
        name: null,
        status: 'INVALID_MANIFEST',
        error: error instanceof Error ? error.message : 'Unable to parse package manifest',
        scripts: [],
      });
      continue;
    }

    const packagePath = relative(root, manifestPath);
    const scripts = Object.entries(manifest.scripts ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, command]) => ({
        name,
        command: String(command),
        status: 'NOT_EXECUTED',
      }));

    packages.push({
      path: packagePath,
      name: typeof manifest.name === 'string' ? manifest.name : null,
      packageManager: manifest.packageManager ?? null,
      nodeEngine: manifest.engines?.node ?? null,
      scripts,
    });
  }

  const workflows = files
    .filter((file) => {
      const normalized = relative(root, file);
      return normalized.startsWith('.github/workflows/')
        && (normalized.endsWith('.yml') || normalized.endsWith('.yaml'));
    })
    .map((file) => ({
      path: relative(root, file),
      status: 'NOT_EXECUTED',
    }));

  const repositoryScripts = files
    .filter((file) => {
      const normalized = relative(root, file);
      return (normalized.startsWith('scripts/') || normalized.includes('/scripts/'))
        && SCRIPT_EXTENSIONS.has(path.extname(file).toLowerCase());
    })
    .map((file) => ({
      path: relative(root, file),
      status: 'NOT_EXECUTED',
    }));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: 'READ_ONLY_STATIC_INVENTORY',
    commandsExecuted: false,
    environmentValuesRead: false,
    packages,
    packageScriptCount: packages.reduce((total, item) => total + item.scripts.length, 0),
    repositoryScripts,
    workflows,
    notes: [
      'NOT_EXECUTED means inventory only; it is not a test result.',
      'Run commands individually in an isolated environment and record results against an exact commit SHA.',
      'Generated build output, dependencies, caches, and VCS internals are excluded.',
    ],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inventory = await generateRepositoryInventory();
  process.stdout.write(JSON.stringify(inventory, null, 2) + '\n');
}
