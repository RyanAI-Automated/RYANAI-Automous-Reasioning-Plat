#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import yaml from 'yaml';
const { parse } = yaml;

const root = process.cwd();
const workflowDir = join(root, '.github', 'workflows');
const errors = [];
const allowedActionMajors = new Map([
  ['actions/checkout', [4]],
  ['actions/setup-node', [4]],
  ['actions/upload-artifact', [4, 7]],
  ['actions/download-artifact', [4]],
  ['actions/labeler', [6, 7]],
  ['docker/setup-buildx-action', [3]],
  ['docker/login-action', [3]],
  ['docker/metadata-action', [5, 6]],
  ['docker/build-push-action', [6, 7]],
  ['github/codeql-action/init', [3, 4]],
  ['github/codeql-action/analyze', [3, 4]],
  ['github/codeql-action/upload-sarif', [3, 4]],
]);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function fail(file, message) {
  errors.push(`${relative(root, file)}: ${message}`);
}

const files = walk(workflowDir).filter((file) => /\.(yml|yaml)$/i.test(file));
if (files.length === 0) errors.push('No workflow YAML files found');

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const name = relative(root, file);
  if (/<<<<<<<|^=======$|>>>>>>>/m.test(text)) fail(file, 'merge-conflict marker found');
  if (/\[cite:\s*\d+\]/.test(text)) fail(file, 'citation marker found');

  let document;
  try {
    document = parse(text);
  } catch (error) {
    fail(file, `invalid YAML: ${error.message}`);
    continue;
  }

  if (!document?.name) fail(file, 'missing workflow name');
  if (!document?.on && !Object.prototype.hasOwnProperty.call(document || {}, 'on')) fail(file, 'missing workflow trigger');
  if (!document?.jobs || typeof document.jobs !== 'object') fail(file, 'missing jobs');

  for (const match of text.matchAll(/uses:\s*([^\s#]+)/g)) {
    const action = match[1];
    const actionMatch = action.match(/^([^@]+)@v(\d+)(?:\.\d+(?:\.\d+)?)?$/);
    if (!actionMatch) {
      if (!action.startsWith('./') && !action.startsWith('aquasecurity/trivy-action@') && !action.startsWith('dtolnay/rust-toolchain@') && !action.startsWith('snyk/actions/node@')) fail(file, `unpinned or malformed action: ${action}`);
      continue;
    }
    if (actionMatch[1].startsWith('aquasecurity/trivy-action') || actionMatch[1].startsWith('dtolnay/rust-toolchain') || actionMatch[1].startsWith('snyk/actions/node')) continue;
    const expected = allowedActionMajors.get(actionMatch[1]);
    if (expected && !expected.includes(Number(actionMatch[2]))) {
      fail(file, `${actionMatch[1]} must use one of ${expected.map((major) => `v${major}`).join(", ")}, found v${actionMatch[2]}`);
    }
  }

  for (const match of text.matchAll(/(?:dockerfile|configuration-path|path|schema(?:-file)?):\s*['"]?([^'"\s${}]+)['"]?/gi)) {
    const candidate = match[1];
    if (candidate.startsWith('.') && !candidate.includes('*') && !candidate.includes('/')) {
      const target = join(root, candidate);
      if (!statSafe(target)) fail(file, `referenced path does not exist: ${candidate}`);
    }
  }

  if (name.endsWith('deploy.yml') && !document.on?.workflow_call) fail(file, 'reusable deployment workflow must define workflow_call');
}

function statSafe(path) {
  try { return statSync(path).isFile() || statSync(path).isDirectory(); } catch { return false; }
}

if (errors.length) {
  console.error(errors.map((error) => `ERROR ${error}`).join('\n'));
  process.exit(1);
}
console.log(`PASS ${files.length} GitHub workflow files validated`);
