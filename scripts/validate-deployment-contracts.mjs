#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const render = read('render.yaml');
const renderConfig = parseYaml(render);
const renderServices = Array.isArray(renderConfig.services)
  ? renderConfig.services
  : (renderConfig.projects?.[0]?.environments?.[0]?.services ?? []);
const renderApi = renderServices.find((service) => service.name === 'ryanai-api');
const renderWeb = renderServices.find((service) => service.name === 'ryanai-web');
const renderDockerWeb = renderServices.find((service) => service.name === 'ryanai-web-docker-canary');
const renderRedis = renderServices.find((service) => service.name === 'ryanai-redis');
const expectedRenderServiceNames = ['ryanai-api', 'ryanai-web', 'ryanai-web-docker-canary', 'ryanai-redis'];
const renderServiceNames = renderServices.map((service) => service.name);
const hasUniqueEnvKeys = (service) => {
  const keys = (service?.envVars ?? []).map((item) => item.key);
  return keys.length === new Set(keys).size;
};
const apiDockerfile = read('Dockerfile.api');
const poolerAdapter = read('src/server/supabasePooler.ts');
const generatedClientCopy = read('scripts/copy-server-assets.mjs');
const packageJson = JSON.parse(read('package.json'));
const vercel = JSON.parse(read('vercel.json'));
const railway = JSON.parse(read('railway.json'));
const renderRepair = read('.github/workflows/guarded-render-api-source-repair.yml');
const renderDeploy = read('.github/workflows/deploy-render.yml');
const vercelDeploy = read('.github/workflows/deploy-vercel.yml');
const vercelCliDeploy = read('.github/workflows/deploy.yml');
const ciWorkflow = read('.github/workflows/ci.yml');
const railwayDeploy = read('.github/workflows/deploy-railway.yml');
const checks = [
  ['Render API maps to the current service', renderApi?.name === 'ryanai-api'],
  ['Render Blueprint uses top-level services declaration', Array.isArray(renderConfig.services)],
  ['Render Blueprint has exactly four expected unique resources, including the Docker frontend canary', renderServices.length === 4 && expectedRenderServiceNames.every((name) => renderServiceNames.includes(name)) && new Set(renderServiceNames).size === 4],
  ['Render API, static frontend and Docker canary environment variable keys are unique', hasUniqueEnvKeys(renderApi) && hasUniqueEnvKeys(renderWeb) && hasUniqueEnvKeys(renderDockerWeb)],
  ['Render services use canonical repository and main branch', renderApi?.repo === 'https://github.com/RyanAI-Automated/RYANAI-Automous-Reasioning-Plat' && renderWeb?.repo === renderApi?.repo && renderDockerWeb?.repo === renderApi?.repo && renderApi?.branch === 'main' && renderWeb?.branch === 'main' && renderDockerWeb?.branch === 'main'],
  ['Render API uses root context and Dockerfile.api', renderApi?.rootDir === '.' && renderApi?.dockerContext === '.' && renderApi?.dockerfilePath === './Dockerfile.api'],
  ['Supabase pooler adapter enforces verified TLS rather than the legacy require alias', poolerAdapter.includes("database.searchParams.set('sslmode', 'verify-full')")],
  ['Render API clears Docker command override', renderApi?.dockerCommand === ''],
  ['Dockerfile.api declares runtime entrypoint and command', apiDockerfile.includes('ENTRYPOINT ["/usr/bin/dumb-init", "--"]') && apiDockerfile.includes('CMD ["sh", "-c", "node scripts/backup-on-startup.mjs; exec node dist/server/server/launcher.js"]')],
  ['Server build always copies and verifies the generated audiobook Prisma runtime client', packageJson.scripts['build:server'] === 'tsc -p tsconfig.server.json && node scripts/copy-server-assets.mjs' && generatedClientCopy.includes("../src/generated/audiobook-prisma/") && generatedClientCopy.includes("../dist/server/generated/audiobook-prisma/index.js") && generatedClientCopy.includes('await access(')],
  ['Render API health check is configured', renderApi?.healthCheckPath === '/health'],
  ['Render API uses Oregon region', renderApi?.region === 'oregon'],
  ['Render API and frontend keep auto-deploy disabled', renderApi?.autoDeployTrigger === 'off' && renderWeb?.autoDeployTrigger === 'off' && renderDockerWeb?.autoDeployTrigger === 'off'],
  ['Render preview generation remains disabled', renderConfig.previews?.generation === 'off'],
  ['Render Redis shares the API region', Boolean(renderRedis) && renderRedis.name === 'ryanai-redis' && renderRedis.region === renderApi?.region],
  ['Render frontend builds the Vite app from repository root', renderWeb?.rootDir === '.' && renderWeb?.buildCommand?.includes('npm run build:web') && renderWeb?.staticPublishPath === './dist'],
  ['Render frontend targets the official API origin', renderWeb?.envVars?.some((item) => item.key === 'VITE_API_BASE_URL' && item.value === 'https://ryanai-api.onrender.com')],
  ['Docker frontend canary uses the root Dockerfile and health check', renderDockerWeb?.runtime === 'docker' && renderDockerWeb?.rootDir === '.' && renderDockerWeb?.dockerContext === '.' && renderDockerWeb?.dockerfilePath === './Dockerfile' && renderDockerWeb?.healthCheckPath === '/health'],
  ['Docker frontend canary receives the API private host and port', renderDockerWeb?.envVars?.some((item) => item.key === 'API_HOST' && item.fromService?.name === 'ryanai-api' && item.fromService?.property === 'host') && renderDockerWeb?.envVars?.some((item) => item.key === 'API_PORT' && item.fromService?.name === 'ryanai-api' && item.fromService?.property === 'port')],
  ['Docker frontend canary uses same-origin API requests through nginx', !renderDockerWeb?.envVars?.some((item) => item.key === 'VITE_API_BASE_URL')],
  ['API CORS allowlist includes the Docker frontend canary', renderApi?.envVars?.some((item) => item.key === 'CORS_ORIGINS' && item.value?.includes('https://ryanai-web-docker-canary.onrender.com'))],
  ['API requires the exact Supabase Session Pooler hostname to be supplied without inferring a cluster index', renderApi?.envVars?.some((item) => item.key === 'SUPABASE_SESSION_POOLER_HOST' && item.sync === false) && !render.includes('aws-1-eu-west-1.pooler.supabase.com')],
  ['Render CI repair targets the current API service ID', ciWorkflow.includes('srv-dbk4giu7bikc7394a4r0')],
  ['Manual Render repair fallback is explicit and has no workflow_run chain', renderRepair.includes("inputs.confirmation == 'REPAIR-ONLY'") && !renderRepair.includes('workflow_run:') && !renderRepair.includes('/deploys')],
  ['Render API config repair runs inside main CI after core jobs succeed', ciWorkflow.includes('render-api-config-repair:') && ciWorkflow.includes('needs: [validate, subprojects, integration, issue-435-supabase]') && ciWorkflow.includes("if: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}")],
  ['Render CI repair is config-only and never calls the deploy endpoint', ciWorkflow.includes('--request PATCH') && ciWorkflow.includes('autoDeployTrigger":"off"') && !ciWorkflow.includes('/deploys')],
  ['Render CI repair verifies the Docker settings in the actual service response shape', ciWorkflow.includes('serviceDetails.envSpecificDetails.dockerCommand') && ciWorkflow.includes('serviceDetails.envSpecificDetails.dockerContext')],
  ['Render repair checks the official health endpoint', renderRepair.includes('"healthCheckPath":"/health"')],
  ['Render deploy checks the existing Redis dependency before API rollout', renderDeploy.includes('ryanai-redis') && renderDeploy.includes('.status == "available"') && renderDeploy.includes('.region == "oregon"')],
  ['Render production deployment is explicitly approval-gated', renderDeploy.includes("vars.RENDER_DEPLOY_ENABLED == 'true'") && renderDeploy.includes("vars.RENDER_DEPLOY_APPROVED == 'true'")],
  ['Render deploy targets the official service after successful CI', renderDeploy.includes('srv-dbk4giu7bikc7394a4r0') && renderDeploy.includes('CI - Build, Test, and Integrate') && renderDeploy.includes('secrets.RENDER_API_KEY') && !renderDeploy.includes('RENDER_DEPLOY_HOOK_URL')],
  ['Render deployment requires provider verification for the exact commit', renderDeploy.includes('provider-verification.yml') && renderDeploy.includes('--commit "$TARGET_SHA"') && renderDeploy.includes('headSha == env.TARGET_SHA') && renderDeploy.includes('conclusion != "success"')],
  ['Render readiness audit requires the API key, not a deploy hook', read('scripts/audit-deployment-readiness.mjs').includes("name: 'Render', gate: 'RENDER_DEPLOY_ENABLED', required: ['RENDER_API_KEY']")],
  ['Deployment audit treats false secret-presence flags as missing', read('scripts/audit-deployment-readiness.mjs').includes("normalized !== 'false'")],
  ['Vercel builds the Vite frontend to dist', vercel.framework === 'vite' && vercel.outputDirectory === 'dist' && vercel.buildCommand.includes('build:web')],
  ['Vercel deployment is explicitly gated', vercelDeploy.includes("vars.VERCEL_DEPLOY_ENABLED == 'true'")],
  ['Vercel CLI deployment uses the official Render API origin', vercelCliDeploy.includes('VITE_API_BASE_URL: https://ryanai-api.onrender.com') && !vercelCliDeploy.includes('vars.VITE_API_BASE_URL')],
  ['CI deployment audit uses the official Render API origin', ciWorkflow.includes('VITE_API_BASE_URL: https://ryanai-api.onrender.com') && !ciWorkflow.includes('vars.VITE_API_BASE_URL')],
  ['Railway uses Dockerfile.api and /health', railway.build?.dockerfilePath === 'Dockerfile.api' && railway.deploy?.healthcheckPath === '/health'],
  ['Railway deployment is explicitly gated', railwayDeploy.includes("vars.RAILWAY_DEPLOY_ENABLED == 'true'")],
];
for (const [name, passed] of checks) console.log((passed ? 'PASS' : 'FAIL') + ' | ' + name);
const failed = checks.filter(([, passed]) => !passed);
console.log('\nDeployment contract validation: ' + (checks.length - failed.length) + '/' + checks.length + ' passed.');
if (failed.length) process.exitCode = 1;
