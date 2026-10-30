#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const brainDefinitions = [
  {
    id: 'primary',
    label: 'Primary reasoning brain',
    keyNames: ['NVIDIA_API_KEY'],
    credentialFlags: ['RYANAI_NVIDIA_KEY_CONFIGURED'],
    defaultEndpoint: 'https://integrate.api.nvidia.com/v1',
    usesLocalCredential: (env) => env.RYANAI_NVIDIA_ENDPOINT_CONFIGURED !== 'true'
      && !firstConfigured(env, ['NVIDIA_API_ENDPOINT'])
      && ((firstConfigured(env, ['LM_STUDIO_URL', 'OLLAMA_URL']))
        || env.RYANAI_LM_STUDIO_URL_CONFIGURED === 'true'
        || env.RYANAI_OLLAMA_URL_CONFIGURED === 'true'),
  },
  {
    id: 'secondary',
    label: 'Secondary analysis brain',
    keyNames: ['QWEN_API_KEY'],
    credentialFlags: ['RYANAI_QWEN_KEY_CONFIGURED'],
    defaultEndpoint: 'https://api.together.xyz/v1',
    usesLocalCredential: (env) => env.RYANAI_QWEN_ENDPOINT_CONFIGURED !== 'true'
      && !firstConfigured(env, ['QWEN_API_ENDPOINT'])
      && (firstConfigured(env, ['LM_STUDIO_URL']) || env.RYANAI_LM_STUDIO_URL_CONFIGURED === 'true'),
  },
  {
    id: 'logic',
    label: 'Logic and tool-use brain',
    keyNames: ['LOGIC_API_KEY', 'OPENAI_API_KEY'],
    credentialFlags: ['RYANAI_LOGIC_KEY_CONFIGURED', 'RYANAI_OPENAI_KEY_CONFIGURED'],
    defaultEndpoint: 'https://api.openai.com/v1',
    usesLocalCredential: (env) => env.RYANAI_LOGIC_USES_LM_STUDIO === 'true'
      || (!firstConfigured(env, ['LOGIC_API_ENDPOINT', 'OPENAI_BASE_URL'])
        && firstConfigured(env, ['LM_STUDIO_URL'])
        && env.RYANAI_LM_STUDIO_URL_CONFIGURED !== 'false'),
  },
];
const agentDefinitions = [
  { id: 'communications', label: 'Communications sub-agent', file: 'src/agent/subAgents.ts', marker: 'commsSubAgent', kind: 'tool-agent' },
  { id: 'compliance', label: 'Compliance sub-agent', file: 'src/agent/subAgents.ts', marker: 'complianceSubAgent', kind: 'tool-agent' },
  { id: 'enterprise-supervisor', label: 'Enterprise supervisor', file: 'src/agent/supervisorGraph.ts', marker: 'enterpriseMultiAgent', kind: 'supervisor' },
  { id: 'security-sentinel', label: 'Security Sentinel', file: 'src/engine/agentWorkers.ts', marker: 'runSecurityAuditor', kind: 'specialist' },
  { id: 'performance-profiler', label: 'Performance Profiler', file: 'src/engine/agentWorkers.ts', marker: 'runPerformanceProfiler', kind: 'specialist' },
  { id: 'reasoning-agent-factory', label: 'Model-backed reasoning agent factory', file: 'src/agent/engine.ts', marker: 'getReasoningAgent', kind: 'dynamic-factory' },
  { id: 'tool-using-agent-graph', label: 'Tool-using self-patch agent graph', file: 'src/engine/agentGraph.ts', marker: 'ryanAgentApp', kind: 'tool-agent' },
  { id: 'react-simulation', label: 'ReAct reasoning-loop scaffold', file: 'src/services/langGraphAgent.ts', marker: 'executeReasoningLoop', kind: 'simulation-unverified' },
];

function firstConfigured(env, names) {
  return names.some((name) => typeof env[name] === 'string' && env[name].trim() !== '');
}

export function auditAgentReadiness({ env = process.env, sourceRoot = root } = {}) {
  const localCredentialPresent = firstConfigured(env, ['LM_STUDIO_API_KEY'])
    || env.RYANAI_LM_STUDIO_KEY_CONFIGURED === 'true';
  const brains = brainDefinitions.map((brain) => {
    const dedicatedCredentialPresent = firstConfigured(env, brain.keyNames)
      || brain.credentialFlags.some((name) => env[name] === 'true');
    const credentialPresent = dedicatedCredentialPresent
      || (localCredentialPresent && brain.usesLocalCredential(env));
    const endpointPresent = Boolean(brain.defaultEndpoint);
    return {
      id: brain.id,
      label: brain.label,
      status: endpointPresent && credentialPresent ? 'CONFIGURED_NOT_PROBED' : 'UNCONFIGURED',
      credentialPresent,
      endpointPresent,
      liveInvocationVerified: false,
    };
  });

  const agents = agentDefinitions.map((agent) => {
    const sourcePath = path.join(sourceRoot, agent.file);
    const sourceExists = fs.existsSync(sourcePath);
    const source = sourceExists ? fs.readFileSync(sourcePath, 'utf8') : '';
    const implemented = source.includes(agent.marker);
    return {
      id: agent.id,
      label: agent.label,
      kind: agent.kind,
      implemented,
      runtimeState: 'UNKNOWN',
      executionVerified: false,
    };
  });

  return {
    brains,
    agents,
    summary: {
      configuredBrainRoles: brains.length,
      credentialConfiguredBrains: brains.filter((brain) => brain.credentialPresent).length,
      codeDefinedAgents: agents.filter((agent) => agent.implemented).length,
      liveAgentsVerified: agents.filter((agent) => agent.executionVerified).length,
      runtimeTelemetryAvailable: false,
    },
    note: 'Static source/configuration audit only. No model calls are made and no agent is claimed active without runtime heartbeat/invocation evidence.',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = auditAgentReadiness();
  console.log(JSON.stringify(report, null, 2));
}
