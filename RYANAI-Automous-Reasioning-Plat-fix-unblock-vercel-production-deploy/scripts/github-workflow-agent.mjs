#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const validator = join(root, 'scripts', 'validate-github-workflows.mjs');
const mode = process.argv.includes('--fix') ? 'fix' : 'audit';
const errors = [];

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function fail(file, message) {
  errors.push(`${relative(root, file)}: ${message}`);
}

function runValidator() {
  execFileSync(process.execPath, [validator], { cwd: root, stdio: 'inherit' });
}

const workflowDir = join(root, '.github', 'workflows');
const files = walk(workflowDir).filter((file) => /\.(yml|yaml)$/i.test(file));
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  if (/<<<<<<<|^=======$|>>>>>>>/m.test(text)) fail(file, 'merge marker');
  if (/\[cite:\s*\d+\]/.test(text)) fail(file, 'citation artifact');
  if (/uses:\s+[^\s@]+@(master|main|latest)\b/.test(text)) fail(file, 'mutable action reference');
}

if (errors.length) {
  console.error(errors.map((error) => `ERROR ${error}`).join('\n'));
  if (mode === 'audit') process.exit(1);
}

if (mode === 'fix') {
  console.log('FIX mode only applies deterministic repairs already encoded in repository scripts.');
  console.log('Run the workflow validator after reviewing the diff.');
}

runValidator();
try {
  execFileSync('git', ['diff', '--check'], { cwd: root, stdio: 'inherit' });
} catch {
  process.exit(1);
}
console.log(`PASS GitHub Workflow Maintainer ${mode} audit`);
