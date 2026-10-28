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


const jarvisSmokePath = join(workflowDir, 'jarvis-staging-smoke.yml');
if (!statSafe(jarvisSmokePath)) {
  errors.push('Missing .github/workflows/jarvis-staging-smoke.yml');
} else {
  const smokeText = readFileSync(jarvisSmokePath, 'utf8');
  const patchLine = smokeText.split('\n').find((line) => line.includes('patchContent:'));
  const literalBackslashN = String.fromCharCode(92, 92) + 'n';
  if (patchLine?.includes(literalBackslashN)) {
    fail(jarvisSmokePath, 'test patch payload must use a newline escape, not a literal backslash-n sequence');
  }
  for (const secret of [
    'JARVIS_STAGING_BASE_URL',
    'JARVIS_STAGING_API_TOKEN',
    'RYANAI_STAGING_API_BASE_URL',
    'JARVIS_STAGING_INGRESS_TOKEN',
  ]) {
    if (!smokeText.includes(`secrets.${secret}`)) {
      fail(jarvisSmokePath, `staging smoke workflow is missing the ${secret} secret binding`);
    }
  }
  if (!smokeText.includes("JARVIS_ALLOW_PRODUCTION_SYNC: 'false'")) {
    fail(jarvisSmokePath, 'staging smoke workflow must keep production sync disabled');
  }

  const smokeDocument = parse(smokeText);
  const jobEnv = smokeDocument?.jobs?.smoke?.env ?? {};
  for (const secretName of ['JARVIS_BASE_URL', 'JARVIS_API_TOKEN', 'RYANAI_STAGING_API_BASE_URL', 'JARVIS_INGRESS_TOKEN']) {
    if (Object.prototype.hasOwnProperty.call(jobEnv, secretName)) {
      fail(jarvisSmokePath, secretName + ' must be scoped to the step that needs it, not the whole job');
    }
  }
  if (!smokeText.includes('Enforce HTTPS-only staging origins')) {
    fail(jarvisSmokePath, 'staging smoke workflow must validate HTTPS-only origin URLs');
  }

}

const vercelValidationPath = join(workflowDir, 'vercel-deploy.yml');
if (!statSafe(vercelValidationPath)) {
  errors.push('Missing .github/workflows/vercel-deploy.yml');
} else {
  const vercelText = readFileSync(vercelValidationPath, 'utf8');
  if (/secrets\.VERCEL_(?:TOKEN|ORG_ID|PROJECT_ID)/i.test(vercelText)) {
    fail(vercelValidationPath, 'validation-only workflow must not receive Vercel deployment credentials');
  }
  if (/\bvercel(?:@latest)?\s+(?:build|deploy)\b/i.test(vercelText)) {
    fail(vercelValidationPath, 'validation-only workflow must not build or deploy production output');
  }
}

const productionDeployPath = join(workflowDir, 'deploy-vercel.yml');
if (statSafe(productionDeployPath)) {
  const productionDeployText = readFileSync(productionDeployPath, 'utf8');
  const productionDeployDocument = parse(productionDeployText);
  if (Object.prototype.hasOwnProperty.call(productionDeployDocument?.on ?? {}, 'workflow_dispatch')) {
    fail(productionDeployPath, 'production deployment must not bypass the successful-CI gate through workflow_dispatch');
  }
  for (const required of [
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.event == 'push'",
    "vars.VERCEL_DEPLOY_ENABLED == 'true'",
  ]) {
    if (!productionDeployText.includes(required)) {
      fail(productionDeployPath, 'production deployment is missing required gate: ' + required);
    }
  }
}

function statSafe(path) {
  try { return statSync(path).isFile() || statSync(path).isDirectory(); } catch { return false; }
}

if (errors.length) {
  console.error(errors.map((error) => `ERROR ${error}`).join('\n'));
  process.exit(1);
}
console.log(`PASS ${files.length} GitHub workflow files validated`);
