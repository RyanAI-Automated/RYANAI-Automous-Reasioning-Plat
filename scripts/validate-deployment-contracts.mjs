#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const render = read('render.yaml');
const renderConfig = parseYaml(render);
const renderServices = renderConfig.projects?.[0]?.environments?.[0]?.services ?? [];
const renderApi = renderServices.find((service) => service.name === 'RYANAI-Automous-Reasioning-Plat');
const renderWeb = renderServices.find((service) => service.name === 'ryanai-web');
const renderRedis = renderServices.find((service) => service.name === 'ryanai-redis');
const vercel = JSON.parse(read('vercel.json'));
const railway = JSON.parse(read('railway.json'));
const renderRepair = read('.github/workflows/guarded-render-api-source-repair.yml');
const renderDeploy = read('.github/workflows/deploy-render.yml');
const vercelDeploy = read('.github/workflows/deploy-vercel.yml');
const vercelCliDeploy = read('.github/workflows/deploy.yml');
const ciWorkflow = read('.github/workflows/ci.yml');
const railwayDeploy = read('.github/workflows/deploy-railway.yml');
const checks = [
  ['Render API maps to the official existing service', render.includes('name: RYANAI-Automous-Reasioning-Plat')],
  ['Render API uses Dockerfile.api', renderApi?.dockerfilePath === './Dockerfile.api'],
  ['Render API health check is configured', renderApi?.healthCheckPath === '/health'],
  ['Render API uses Virginia region', renderApi?.region === 'virginia'],
  ['Render Redis shares the API region', Boolean(renderRedis) && renderRedis.region === renderApi?.region],
  ['Render frontend builds the Vite app from repository root', renderWeb?.rootDir === '.' && renderWeb?.buildCommand?.includes('npm run build:web') && renderWeb?.staticPublishPath === './dist'],
  ['Render frontend targets the official API origin', renderWeb?.envVars?.some((item) => item.key === 'VITE_API_BASE_URL' && item.value === 'https://ryanai-automous-reasoning-plat.onrender.com')],
  ['Render repair targets the official service ID only', renderRepair.includes('srv-dafvs4ht0dsc7380mapg') && !renderRepair.includes('srv-dbk4giu7bikc7394a4r0')],
  ['Render repair checks the official health endpoint', renderRepair.includes('https://ryanai-automous-reasoning-plat.onrender.com/health') && !renderRepair.includes('ryanai-api.onrender.com')],
  ['Render auto-deploy targets the official service after successful CI', renderDeploy.includes('srv-dafvs4ht0dsc7380mapg') && renderDeploy.includes('CI - Build, Test, and Integrate') && renderDeploy.includes('secrets.RENDER_API_KEY') && !renderDeploy.includes('RENDER_DEPLOY_HOOK_URL')],
  ['Render readiness audit requires the API key, not a deploy hook', read('scripts/audit-deployment-readiness.mjs').includes("name: 'Render', gate: 'RENDER_DEPLOY_ENABLED', required: ['RENDER_API_KEY']")],
  ['Deployment audit treats false secret-presence flags as missing', read('scripts/audit-deployment-readiness.mjs').includes("normalized !== 'false'")],
  ['Vercel builds the Vite frontend to dist', vercel.framework === 'vite' && vercel.outputDirectory === 'dist' && vercel.buildCommand.includes('build:web')],
  ['Vercel deployment is explicitly gated', vercelDeploy.includes("vars.VERCEL_DEPLOY_ENABLED == 'true'")],
  ['Vercel CLI deployment uses the official Render API origin', vercelCliDeploy.includes('VITE_API_BASE_URL: https://ryanai-automous-reasoning-plat.onrender.com') && !vercelCliDeploy.includes('vars.VITE_API_BASE_URL')],
  ['CI deployment audit uses the official Render API origin', ciWorkflow.includes('VITE_API_BASE_URL: https://ryanai-automous-reasoning-plat.onrender.com') && !ciWorkflow.includes('vars.VITE_API_BASE_URL')],
  ['Railway uses Dockerfile.api and /health', railway.build?.dockerfilePath === 'Dockerfile.api' && railway.deploy?.healthcheckPath === '/health'],
  ['Railway deployment is explicitly gated', railwayDeploy.includes("vars.RAILWAY_DEPLOY_ENABLED == 'true'")],
];
for (const [name, passed] of checks) console.log((passed ? 'PASS' : 'FAIL') + ' | ' + name);
const failed = checks.filter(([, passed]) => !passed);
console.log('\nDeployment contract validation: ' + (checks.length - failed.length) + '/' + checks.length + ' passed.');
if (failed.length) process.exitCode = 1;
