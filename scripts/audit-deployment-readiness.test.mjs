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
            repo: https://github.com/RyanAI-Automated/RYANAI-Automous-Reasioning-Plat
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
  const result = auditDeploymentTargets(fixture(t), {});
  assert.deepEqual(result.map((item) => item.status), ['DISABLED','DISABLED','DISABLED']);
});

test('rejects a Render Blueprint that points at a fork', (t) => {
  const root = fixture(t);
  const file = path.join(root,'render.yaml');
  writeFileSync(file,readFileSync(file,'utf8').replace('RyanAI-Automated/RYANAI-Automous-Reasioning-Plat','rmnganyane-dev/RYANAI-Automous-Reasioning-Plat'));
  const result = auditDeploymentTargets(root, {});
  assert.equal(result[1].status,'BLOCKED');
  assert.match(result[1].errors.join(' '),/official GitHub repository/);
});

test('Railway readiness contract matches the production workflow service ID', (t) => {
  const result = auditDeploymentTargets(fixture(t), { RAILWAY_DEPLOY_ENABLED:'true' });
  assert.equal(result[2].status,'BLOCKED');
  assert.deepEqual(result[2].missing,['RAILWAY_TOKEN','RAILWAY_PROJECT_ID','RAILWAY_SERVICE_ID','RAILWAY_ENVIRONMENT_ID']);
});

test('enabled platform checks report missing variable names without exposing values', (t) => {
  const secret = 'sensitive-fixture-value-must-not-appear';
  const result = auditDeploymentTargets(fixture(t), {
    VERCEL_DEPLOY_ENABLED:'true',
    VERCEL_TOKEN:secret,
  });
  assert.equal(result[0].status,'BLOCKED');
  assert.deepEqual(result[0].missing,['VERCEL_ORG_ID','VERCEL_PROJECT_ID','VITE_API_BASE_URL']);
  assert.equal(JSON.stringify(result).includes(secret),false);
});

test('blocks missing Railway deployment configuration', (t) => {
  const root = fixture(t);
  unlinkSync(path.join(root,'railway.json'));
  const result = auditDeploymentTargets(root, {});
  assert.equal(result[2].status,'BLOCKED');
  assert.match(result[2].errors.join(' '),/missing railway.json/);
});
