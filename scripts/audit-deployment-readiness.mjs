#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import yaml from 'yaml';

const OFFICIAL_REPOSITORY = 'RyanAI-Automated/RYANAI-Automous-Reasioning-Plat';
const readJson = (root, file, errors) => {
  const fullPath = path.join(root, file);
  if (!existsSync(fullPath)) { errors.push(`missing ${file}`); return null; }
  try { return JSON.parse(readFileSync(fullPath, 'utf8')); }
  catch { errors.push(`invalid JSON in ${file}`); return null; }
};
const missingEnv = (env, names) => names.filter((name) => typeof env[name] !== 'string' || env[name].trim() === '' || env[name].trim().toLowerCase() === 'false');
const officialRepo = (value) => typeof value === 'string' && value.toLowerCase().replace(/\.git$/, '').endsWith(OFFICIAL_REPOSITORY.toLowerCase());

export function auditDeploymentTargets(env = process.env, root = process.cwd()) {
  const results = [];

  const vercelErrors = [];
  const vercel = readJson(root, 'vercel.json', vercelErrors);
  const packageJson = readJson(root, 'package.json', vercelErrors);
  if (vercel && vercel.framework !== 'vite') vercelErrors.push('Vercel framework must be vite');
  if (vercel && vercel.outputDirectory !== 'dist') vercelErrors.push('Vercel outputDirectory must be dist');
  if (vercel && !String(vercel.buildCommand || '').includes('build:web')) vercelErrors.push('Vercel buildCommand must run build:web');
  if (!packageJson?.scripts?.['build:web']) vercelErrors.push('package.json is missing build:web');
  if (!existsSync(path.join(root, '.github/workflows/deploy-vercel.yml'))) vercelErrors.push('missing Vercel deployment workflow');
  if (!existsSync(path.join(root, '.github/workflows/deploy.yml'))) vercelErrors.push('missing reusable Vercel deployment workflow');
  const vercelEnabled = env.VERCEL_DEPLOY_ENABLED === 'true';
  const vercelMissing = vercelEnabled ? missingEnv(env, ['VERCEL_TOKEN','VERCEL_ORG_ID','VERCEL_PROJECT_ID','VITE_API_BASE_URL']) : [];
  results.push({ name:'Vercel', gate:'VERCEL_DEPLOY_ENABLED', deploymentAttempted:false, status:vercelErrors.length || vercelMissing.length ? 'BLOCKED' : vercelEnabled ? 'READY' : 'DISABLED', errors:vercelErrors, missing:vercelMissing });

  const renderErrors = [];
  let render = null;
  const renderPath = path.join(root, 'render.yaml');
  if (!existsSync(renderPath)) renderErrors.push('missing render.yaml');
  else {
    try { render = yaml.parse(readFileSync(renderPath, 'utf8')); }
    catch { renderErrors.push('invalid YAML in render.yaml'); }
  }
  const services = (render?.projects || []).flatMap((project) => (project.environments || []).flatMap((environment) => environment.services || []));
  const api = services.find((service) => service.name === 'ryanai-api');
  const web = services.find((service) => service.name === 'ryanai-web');
  if (!api) renderErrors.push('Render Blueprint is missing ryanai-api');
  else {
    if (!officialRepo(api.repo)) renderErrors.push('Render API must use the official GitHub repository');
    if (api.branch !== 'main') renderErrors.push('Render API must deploy from main');
    if (api.runtime !== 'docker' || api.dockerfilePath !== './Dockerfile.api') renderErrors.push('Render API must use the Docker runtime and ./Dockerfile.api');
    if (api.healthCheckPath !== '/health') renderErrors.push('Render API healthCheckPath must be /health');
  }
  if (!web) renderErrors.push('Render Blueprint is missing ryanai-web');
  else {
    if (!officialRepo(web.repo)) renderErrors.push('Render web must use the official GitHub repository');
    if (web.runtime !== 'static') renderErrors.push('Render web must use the static runtime');
    if (web.rootDir && web.rootDir !== '.') renderErrors.push('Render web rootDir must be the repository root');
    if (web.staticPublishPath !== './dist') renderErrors.push('Render web staticPublishPath must be ./dist');
    if (!String(web.buildCommand || '').includes('npm run build')) renderErrors.push('Render web buildCommand must run the frontend build');
  }
  if (!existsSync(path.join(root, '.github/workflows/deploy-render.yml'))) renderErrors.push('missing Render deployment workflow');
  const renderEnabled = env.RENDER_DEPLOY_ENABLED === 'true';
  const renderMissing = renderEnabled ? missingEnv(env, ['RENDER_API_DEPLOY_HOOK_URL','RENDER_WEB_DEPLOY_HOOK_URL']) : [];
  results.push({ name:'Render', gate:'RENDER_DEPLOY_ENABLED', deploymentAttempted:false, status:renderErrors.length || renderMissing.length ? 'BLOCKED' : renderEnabled ? 'READY' : 'DISABLED', errors:renderErrors, missing:renderMissing });

  const railwayErrors = [];
  const railway = readJson(root, 'railway.json', railwayErrors);
  if (!existsSync(path.join(root, 'Dockerfile.api'))) railwayErrors.push('missing Dockerfile.api');
  if (railway && railway.build?.builder !== 'DOCKERFILE') railwayErrors.push('Railway builder must be DOCKERFILE');
  if (railway && railway.build?.dockerfilePath !== 'Dockerfile.api') railwayErrors.push('Railway must build Dockerfile.api');
  if (railway && railway.deploy?.healthcheckPath !== '/health') railwayErrors.push('Railway healthcheckPath must be /health');
  if (!existsSync(path.join(root, '.github/workflows/deploy-railway.yml'))) railwayErrors.push('missing Railway deployment workflow');
  const railwayEnabled = env.RAILWAY_DEPLOY_ENABLED === 'true';
  const railwayMissing = railwayEnabled ? missingEnv(env, ['RAILWAY_TOKEN','RAILWAY_PROJECT_ID','RAILWAY_SERVICE_ID','RAILWAY_ENVIRONMENT_ID']) : [];
  results.push({ name:'Railway', gate:'RAILWAY_DEPLOY_ENABLED', deploymentAttempted:false, status:railwayErrors.length || railwayMissing.length ? 'BLOCKED' : railwayEnabled ? 'READY' : 'DISABLED', errors:railwayErrors, missing:railwayMissing });

  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = auditDeploymentTargets();
  for (const item of results) {
    console.log(`${item.status} | ${item.name} | gate: ${item.gate}`);
    for (const error of item.errors) console.log(`  - ${error}`);
    if (item.missing.length) console.log(`  - missing environment variable names: ${item.missing.join(', ')}`);
  }
  const blocked = results.filter((item) => item.status === 'BLOCKED');
  const ready = results.filter((item) => item.status === 'READY');
  const disabled = results.filter((item) => item.status === 'DISABLED');
  console.log(`\nDeployment readiness: ${ready.length} ready, ${blocked.length} blocked, ${disabled.length} disabled. No deployments were triggered.`);
  if (process.argv.includes('--strict') && blocked.length) process.exitCode = 1;
}
