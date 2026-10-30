#!/usr/bin/env node
import process from 'node:process';

const targets = [
  { name: 'AWS ECS', gate: 'AWS_ECS_DEPLOY_ENABLED', required: ['AWS_REGION','ECR_REPOSITORY','ECS_SERVICE','ECS_CLUSTER','ECS_TASK_DEFINITION','ECS_CONTAINER_NAME','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY'] },
  { name: 'Azure AKS', gate: 'AZURE_AKS_DEPLOY_ENABLED', required: ['AZURE_CONTAINER_REGISTRY','AZURE_CONTAINER_NAME','AZURE_RESOURCE_GROUP','AZURE_CLUSTER_NAME','AZURE_KUSTOMIZE_PATH','AZURE_CLIENT_ID','AZURE_TENANT_ID','AZURE_SUBSCRIPTION_ID'] },
  { name: 'Datadog Synthetics', gate: 'DATADOG_SYNTHETICS_ENABLED', required: ['DD_API_KEY','DD_APP_KEY'] },
  { name: 'Render', gate: 'RENDER_DEPLOY_ENABLED', required: ['RENDER_DEPLOY_HOOK_URL'] },
  { name: 'Vercel', gate: 'VERCEL_DEPLOY_ENABLED', required: ['VERCEL_TOKEN','VERCEL_ORG_ID','VERCEL_PROJECT_ID','VITE_API_BASE_URL'] },
];

export function auditDeploymentTargets(env = process.env) {
  return targets.map(({ name, gate, required }) => {
    const enabled = env[gate] === 'true';
    const missing = enabled ? required.filter((key) => typeof env[key] !== 'string' || env[key].trim() === '') : [];
    return {
      name,
      gate,
      status: !enabled ? 'DISABLED' : missing.length ? 'BLOCKED' : 'READY',
      missing,
      deploymentAttempted: false,
    };
  });
}

const results = auditDeploymentTargets();
for (const item of results) {
  const suffix = item.status === 'BLOCKED' ? ` | missing: ${item.missing.join(', ')}` : '';
  console.log(`${item.status} | ${item.name} | gate: ${item.gate}${suffix}`);
}
const blocked = results.filter((item) => item.status === 'BLOCKED');
console.log(`\nDeployment readiness: ${results.filter((item) => item.status === 'READY').length} ready, ${blocked.length} blocked, ${results.filter((item) => item.status === 'DISABLED').length} disabled. No deployments were triggered.`);
if (process.argv.includes('--strict') && blocked.length) process.exitCode = 1;
