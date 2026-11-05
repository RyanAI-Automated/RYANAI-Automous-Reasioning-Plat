#!/usr/bin/env node
import process from 'node:process';

const targets = [
  { name: 'Render', role: 'frontend-delivery-and-api', default: true, gate: 'RENDER_DEPLOY_ENABLED', required: ['RENDER_API_KEY'] },
  { name: 'Railway', role: 'Docker-and-persistent-workloads', default: true, gate: 'RAILWAY_DEPLOY_ENABLED', required: ['RAILWAY_TOKEN','RAILWAY_PROJECT_ID','RAILWAY_SERVICE_ID','RAILWAY_ENVIRONMENT_ID'] },
  { name: 'AWS ECS', role: 'optional-container-platform', default: false, gate: 'AWS_ECS_DEPLOY_ENABLED', required: ['AWS_REGION','ECR_REPOSITORY','ECS_SERVICE','ECS_CLUSTER','ECS_TASK_DEFINITION','ECS_CONTAINER_NAME','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY'] },
  { name: 'Azure AKS', role: 'optional-container-platform', default: false, gate: 'AZURE_AKS_DEPLOY_ENABLED', required: ['AZURE_CONTAINER_REGISTRY','AZURE_CONTAINER_NAME','AZURE_RESOURCE_GROUP','AZURE_CLUSTER_NAME','AZURE_KUSTOMIZE_PATH','AZURE_CLIENT_ID','AZURE_TENANT_ID','AZURE_SUBSCRIPTION_ID'] },
  { name: 'Datadog Synthetics', role: 'optional-observability', default: false, gate: 'DATADOG_SYNTHETICS_ENABLED', required: ['DD_API_KEY','DD_APP_KEY'] },
];

function isConfigured(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== '' && normalized !== 'false' && normalized !== '0';
}

export function auditDeploymentTargets(env = process.env) {
  return targets.map(({ name, role, default: isDefault, gate, required }) => {
    const enabled = env[gate] === 'true';
    const missing = enabled ? required.filter((key) => !isConfigured(env[key])) : [];
    return {
      name,
      role,
      default: isDefault,
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
  const primary = item.default ? ' | DEFAULT' : '';
  console.log(`${item.status}${primary} | ${item.name} | role: ${item.role} | gate: ${item.gate}${suffix}`);
}
const blocked = results.filter((item) => item.status === 'BLOCKED');
console.log(`\nDeployment readiness: ${results.filter((item) => item.status === 'READY').length} ready, ${blocked.length} blocked, ${results.filter((item) => item.status === 'DISABLED').length} disabled. No deployments were triggered.`);
if (process.argv.includes('--strict') && blocked.length) process.exitCode = 1;
