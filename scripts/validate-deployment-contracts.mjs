#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const render = read('render.yaml');
const renderConfig = parseYaml(render);
const renderServices = Array.isArray(renderConfig.services) ? renderConfig.services : [];
const renderApi = renderServices.find((service) => service.name === 'ryanai-api');
const renderWeb = renderServices.find((service) => service.name === 'ryanai-web');
const renderRedis = renderServices.find((service) => service.name === 'ryanai-redis');
const renderServiceNames = renderServices.map((service) => service.name);
const expectedRenderServiceNames = ['ryanai-api', 'ryanai-web', 'ryanai-redis'];
const hasUniqueEnvKeys = (service) => {
  const keys = (service?.envVars ?? []).map((item) => item.key);
  return keys.length === new Set(keys).size;
};
const envVar = (service, key) => service?.envVars?.find((item) => item.key === key);
const isSyncFalse = (service, key) => envVar(service, key)?.sync === false;
const isFalse = (service, key) => envVar(service, key)?.value === 'false';

const rootDockerfile = read('Dockerfile');
const apiDockerfile = read('Dockerfile.api');
const poolerAdapter = read('src/server/supabasePooler.ts');
const generatedClientCopy = read('scripts/copy-server-assets.mjs');
const packageJson = JSON.parse(read('package.json'));
const envExample = read('.env.example');
const featureFlags = read('src/server/comms/featureFlags.ts');
const commsPlugin = read('src/server/comms/index.ts');
const commsAttachments = read('src/server/comms/attachments.ts');
const twilioWebhook = read('src/server/routes/twilioWebhook.ts');
const slackInteractions = read('src/server/routes/slackInteractions.ts');
const railway = JSON.parse(read('railway.json'));
const renderRepair = read('.github/workflows/guarded-render-api-source-repair.yml');
const renderDeploy = read('.github/workflows/deploy-render.yml');
const ciWorkflow = read('.github/workflows/ci.yml');
const railwayDeploy = read('.github/workflows/deploy-railway.yml');

function apiRuntimeStage(source) {
  const marker = 'FROM node:24-alpine AS api\n';
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const remainder = source.slice(start);
  const nextStage = remainder.indexOf('\nFROM ', marker.length);
  return nextStage < 0 ? remainder : remainder.slice(0, nextStage);
}

const rootApiStage = apiRuntimeStage(rootDockerfile);
const standaloneApiStage = apiRuntimeStage(apiDockerfile);
const hasVerifiedCaContract = (stage) =>
  stage.includes('NODE_USE_SYSTEM_CA=1')
  && stage.includes('NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/supabase-prod-ca-2021.crt')
  && stage.includes('SUPABASE_SSL_ROOT_CERT_PATH=/usr/local/share/ca-certificates/supabase-prod-ca-2021.crt')
  && stage.includes('COPY certs/supabase/prod-ca-2021.crt /usr/local/share/ca-certificates/supabase-prod-ca-2021.crt')
  && stage.includes('update-ca-certificates')
  && stage.includes('test -s /etc/ssl/cert.pem')
  && stage.includes('test -s /usr/local/share/ca-certificates/supabase-prod-ca-2021.crt')
  && stage.includes('scripts/verify-node-ca.sh')
  && !stage.includes('NODE_TLS_REJECT_UNAUTHORIZED');

const checks = [
  ['Render Blueprint uses a top-level services list', Array.isArray(renderConfig.services)],
  ['Render Blueprint declares exactly the API, web, and Redis resources', renderServices.length === 3 && expectedRenderServiceNames.every((name) => renderServiceNames.includes(name)) && new Set(renderServiceNames).size === 3],
  ['Render API and web environment variable keys are unique', hasUniqueEnvKeys(renderApi) && hasUniqueEnvKeys(renderWeb)],
  ['Render API and web use the official repository and main branch', renderApi?.repo === 'https://github.com/RyanAI-Automated/RYANAI-Automous-Reasioning-Plat' && renderWeb?.repo === renderApi?.repo && renderApi?.branch === 'main' && renderWeb?.branch === 'main'],
  ['Render API uses the standalone Docker image and /health', renderApi?.runtime === 'docker' && renderApi?.dockerfilePath === './Dockerfile.api' && renderApi?.healthCheckPath === '/health'],
  ['Render web is the live-aligned Static Site and publishes the Vite dist output', renderWeb?.runtime === 'static' && renderWeb?.buildCommand === 'npm ci --legacy-peer-deps && npm run build:web' && renderWeb?.staticPublishPath === './dist' && !renderWeb?.dockerfilePath && !renderWeb?.dockerTarget && !renderWeb?.healthCheckPath],
  ['Render API, web, and Redis are in Oregon', renderApi?.region === 'oregon' && renderRedis?.region === 'oregon' && Array.isArray(renderRedis?.ipAllowList) && renderRedis.ipAllowList.length === 0],
  ['Render API and web auto-deploy remain disabled', renderApi?.autoDeployTrigger === 'off' && renderWeb?.autoDeployTrigger === 'off'],
  ['Render web points to the official API origin', envVar(renderWeb, 'VITE_API_BASE_URL')?.value === 'https://ryanai-api.onrender.com'],
  ['Render does not override the API Docker command', !renderApi?.dockerCommand],
  ['Render does not run automatic Prisma migrations during API deployment', !renderApi?.preDeployCommand && !render.includes('prisma migrate deploy')],
  ['Render requires the exact protected Supabase Session Pooler hostname', isSyncFalse(renderApi, 'SUPABASE_SESSION_POOLER_HOST') && !/aws-[^\s]+\.pooler\.supabase\.com/.test(render)],
  ['Render restores the optional pooled audiobook database setting', isSyncFalse(renderApi, 'AUDIOBOOK_DATABASE_URL')],
  ['Render restores the optional direct audiobook migration database setting', isSyncFalse(renderApi, 'AUDIOBOOK_DATABASE_URL_UNPOOLED')],
  ['Render keeps communications disabled by default', isFalse(renderApi, 'COMMUNICATIONS_ENABLED')],
  ['Render keeps communication attachments disabled by default', isFalse(renderApi, 'COMMUNICATION_ATTACHMENTS_ENABLED')],
  ['Render keeps malware scanning and orphan cleanup disabled by default', isFalse(renderApi, 'ATTACHMENT_SCANNER_ENABLED') && isFalse(renderApi, 'ATTACHMENT_ORPHAN_CLEANUP_ENABLED')],
  ['Both production API Docker targets use system and Supabase CA roots with verified TLS', hasVerifiedCaContract(rootApiStage) && hasVerifiedCaContract(standaloneApiStage)],
  ['Neither API runtime image disables TLS certificate verification', !rootApiStage.includes('NODE_TLS_REJECT_UNAUTHORIZED') && !standaloneApiStage.includes('NODE_TLS_REJECT_UNAUTHORIZED')],
  ['Both API runtime images execute the CA validation wrapper before the server', rootApiStage.includes('exec sh scripts/verify-node-ca.sh') && standaloneApiStage.includes('exec sh scripts/verify-node-ca.sh')],
  ['Supabase Session Pooler uses full TLS and strict certificate acceptance', poolerAdapter.includes("database.searchParams.set('sslmode', 'verify-full')") && poolerAdapter.includes("database.searchParams.set('sslaccept', 'strict')")],
  ['Server build copies and verifies the generated audiobook Prisma runtime client', packageJson.scripts['build:server'] === 'tsc -p tsconfig.server.json && node scripts/copy-server-assets.mjs' && generatedClientCopy.includes('../src/generated/audiobook-prisma/') && generatedClientCopy.includes('../dist/server/generated/audiobook-prisma/index.js') && generatedClientCopy.includes('await access(')],
  ['Example environment defaults keep communications and uploads disabled', envExample.includes('COMMUNICATIONS_ENABLED=false') && envExample.includes('COMMUNICATION_ATTACHMENTS_ENABLED=false') && envExample.includes('ATTACHMENT_SCANNER_ENABLED=false') && envExample.includes('ATTACHMENT_ORPHAN_CLEANUP_ENABLED=false')],
  ['Communications and attachment switches require exact explicit opt-in', featureFlags.includes("process.env.COMMUNICATIONS_ENABLED === 'true'") && featureFlags.includes("process.env.COMMUNICATION_ATTACHMENTS_ENABLED === 'true'") && featureFlags.includes("process.env.ATTACHMENT_SCANNER_ENABLED === 'true'")],
  ['Comms, Twilio, and Slack plugins fail closed when communications are disabled', commsPlugin.includes('if (!isCommunicationsEnabled())') && twilioWebhook.includes('if (!isCommunicationsEnabled())') && slackInteractions.includes('if (!isCommunicationsEnabled())')],
  ['Comms attachment routes and storage helpers fail closed when uploads are disabled', (commsPlugin.split('areCommunicationAttachmentsEnabled()').length - 1) >= 5 && (commsAttachments.split('areCommunicationAttachmentsEnabled()').length - 1) >= 2],
  ['Render API source repair workflow is manual and does not deploy', renderRepair.includes('workflow_dispatch:') && renderRepair.includes("inputs.confirmation == 'REPAIR-ONLY'") && !renderRepair.includes('workflow_run:') && !renderRepair.includes('/deploys')],
  ['Render API config repair runs only after the core CI dependencies', ciWorkflow.includes('render-api-config-repair:') && ciWorkflow.includes('needs: [validate, subprojects, integration, issue-435-supabase]') && ciWorkflow.includes("github.event_name == 'push' && github.ref == 'refs/heads/main'")],
  ['Render CI config repair is PATCH-only and keeps auto-deploy disabled', ciWorkflow.includes('--request PATCH') && ciWorkflow.includes('autoDeployTrigger":"off"') && !ciWorkflow.includes('/deploys')],
  ['Render deployment requires explicit enablement and approval', renderDeploy.includes("vars.RENDER_DEPLOY_ENABLED == 'true'") && renderDeploy.includes("vars.RENDER_DEPLOY_APPROVED == 'true'")],
  ['Render deployment verifies the exact provider commit before promotion', renderDeploy.includes('provider-verification.yml') && renderDeploy.includes('--commit "$TARGET_SHA"') && renderDeploy.includes('headSha == env.TARGET_SHA') && renderDeploy.includes('conclusion != "success"')],
  ['Render checks Redis availability before API rollout', renderDeploy.includes('ryanai-redis') && renderDeploy.includes('.status == "available"') && renderDeploy.includes('.region == "oregon"')],
  ['Railway uses Dockerfile.api and /health', railway.build?.dockerfilePath === 'Dockerfile.api' && railway.deploy?.healthcheckPath === '/health'],
  ['Render is the default frontend and API delivery provider', renderWeb?.runtime === 'static' && renderApi?.runtime === 'docker'],
  ['Railway is the default Docker and persistent-workload provider', railway.build?.dockerfilePath === 'Dockerfile.api' && railway.deploy?.healthcheckPath === '/health'],
  ['Railway production deployment requires manual confirmation, exact main, and approval gates', railwayDeploy.includes('workflow_dispatch:') && !railwayDeploy.includes('workflow_run:') && railwayDeploy.includes("inputs.confirmation == 'DEPLOY'") && railwayDeploy.includes("vars.RAILWAY_DEPLOY_APPROVED == 'true'") && railwayDeploy.includes('--commit') === false && railwayDeploy.includes('TARGET_SHA')],
];

for (const [name, passed] of checks) console.log((passed ? 'PASS' : 'FAIL') + ' | ' + name);
const failed = checks.filter(([, passed]) => !passed);
console.log('\nDeployment contract validation: ' + (checks.length - failed.length) + '/' + checks.length + ' passed.');
if (failed.length) process.exitCode = 1;
