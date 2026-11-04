import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { auditDeploymentTargets } from './audit-deployment-readiness.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ryanai-deployment-audit-'));
  t.after(() => rmSync(root, { recursive:true, force:true }));
  const put = (name, value) => {
    const file = path.join(root,name);
    mkdirSync(path.dirname(file),{recursive:true});
    writeFileSync(file,value,'utf8');
  };
  put('package.json',JSON.stringify({scripts:{'build:web':'npm run build:client'}}));
  put('vercel.json',JSON.stringify({framework:'vite',outputDirectory:'dist',buildCommand:'npm run build:web'}));
  put('.github/workflows/deploy-vercel.yml','name: Vercel deploy\n');
  put('.github/workflows/deploy.yml','name: reusable Vercel deploy\n');
  put('render.yaml',`projects:
  - name: RyanAI
    environments:
      - name: Production
        services:
          - type: web
            name: ryanai-web
            runtime: static
            repo: https://github.com/RyanAI-Automated/RYANAI-Automous-Reasioning-Plat
            buildCommand: npm ci --legacy-peer-deps && npm run build
            staticPublishPath: ./dist
          - type: web
            name: ryanai-api
            repo: https://github.com/RyanAI-Automated/RYANAI-Automous-Reasioning-Plat
            branch: main
            runtime: docker
            dockerfilePath: ./Dockerfile.api
            healthCheckPath: /health
`);
  put('Dockerfile.api','FROM node:24-alpine\n');
  put('railway.json',JSON.stringify({build:{builder:'DOCKERFILE',dockerfilePath:'Dockerfile.api'},deploy:{healthcheckPath:'/health'}}));
  put('.github/workflows/deploy-render.yml','name: Render deploy\n');
  put('.github/workflows/deploy-railway.yml','name: Railway deploy\n');
  return root;
}

test('all three platform configurations pass static checks while deployment gates remain disabled', (t) => {
  const result = auditDeploymentTargets({}, fixture(t));
  assert.deepEqual(result.map((item) => item.status), ['DISABLED','DISABLED','DISABLED']);
  assert.ok(result.every((item) => item.deploymentAttempted === false));
});

test('rejects a Render Blueprint that points at a fork', (t) => {
  const root = fixture(t);
  const file = path.join(root,'render.yaml');
  writeFileSync(file,readFileSync(file,'utf8').replace('RyanAI-Automated/RYANAI-Automous-Reasioning-Plat','rmnganyane-dev/RYANAI-Automous-Reasioning-Plat'));
  const result = auditDeploymentTargets({}, root);
  assert.equal(result[1].status,'BLOCKED');
  assert.match(result[1].errors.join(' '),/official GitHub repository/);
});

test('Railway readiness contract matches the production workflow service ID', (t) => {
  const result = auditDeploymentTargets({ RAILWAY_DEPLOY_ENABLED:'true' }, fixture(t));
  assert.equal(result[2].status,'BLOCKED');
  assert.deepEqual(result[2].missing,['RAILWAY_TOKEN','RAILWAY_PROJECT_ID','RAILWAY_SERVICE_ID','RAILWAY_ENVIRONMENT_ID']);
});

test('enabled platform checks report missing variable names without exposing values', (t) => {
  const secret = 'sensitive-fixture-value-must-not-appear';
  const result = auditDeploymentTargets({
    VERCEL_DEPLOY_ENABLED:'true',
    VERCEL_TOKEN:secret,
  }, fixture(t));
  assert.equal(result[0].status,'BLOCKED');
  assert.deepEqual(result[0].missing,['VERCEL_ORG_ID','VERCEL_PROJECT_ID','VITE_API_BASE_URL']);
  assert.equal(JSON.stringify(result).includes(secret),false);
});

test('a boolean false from GitHub secret-presence checks is treated as missing', (t) => {
  const result = auditDeploymentTargets({
    RENDER_DEPLOY_ENABLED:'true',
    RENDER_DEPLOY_HOOK_URL:'false',
  }, fixture(t));
  assert.equal(result[1].status,'BLOCKED');
  assert.deepEqual(result[1].missing,['RENDER_DEPLOY_HOOK_URL']);
});

test('all three platform targets become ready only when their own gate and prerequisites exist', (t) => {
  const result = auditDeploymentTargets({
    RENDER_DEPLOY_ENABLED:'true',
    RENDER_DEPLOY_HOOK_URL:'true',
    VERCEL_DEPLOY_ENABLED:'true',
    VERCEL_TOKEN:'true',
    VERCEL_ORG_ID:'org',
    VERCEL_PROJECT_ID:'project',
    VITE_API_BASE_URL:'https://api.example.invalid',
    RAILWAY_DEPLOY_ENABLED:'true',
    RAILWAY_TOKEN:'true',
    RAILWAY_PROJECT_ID:'project',
    RAILWAY_SERVICE_ID:'service',
    RAILWAY_ENVIRONMENT_ID:'environment',
  }, fixture(t));
  assert.deepEqual(result.map((item) => item.status), ['READY','READY','READY']);
  assert.ok(result.every((item) => item.deploymentAttempted === false));
});

test('blocks missing Railway deployment configuration', (t) => {
  const root = fixture(t);
  unlinkSync(path.join(root,'railway.json'));
  const result = auditDeploymentTargets({}, root);
  assert.equal(result[2].status,'BLOCKED');
  assert.match(result[2].errors.join(' '),/missing railway.json/);
});
