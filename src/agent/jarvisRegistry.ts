export type JarvisRisk = 'read-only' | 'diagnostic' | 'code-change' | 'privileged';
export type JarvisCapability = 'repository.inspect' | 'diagnostics.run' | 'patch.propose' | 'tests.run' | 'evidence.record' | 'secrets.read' | 'production.change' | 'deployment.execute';

export interface JarvisAgentDefinition {
  id: string;
  role: 'supervisor' | 'repository' | 'diagnostics' | 'security' | 'patch' | 'verification';
  capabilities: readonly JarvisCapability[];
  permissions: readonly JarvisRisk[];
}

export const JARVIS_AGENT_REGISTRY: readonly JarvisAgentDefinition[] = Object.freeze([
  { id: 'jarvis-supervisor', role: 'supervisor', capabilities: ['repository.inspect', 'diagnostics.run', 'patch.propose', 'tests.run', 'evidence.record'], permissions: ['read-only', 'diagnostic', 'code-change'] },
  { id: 'repository-inspector', role: 'repository', capabilities: ['repository.inspect', 'evidence.record'], permissions: ['read-only'] },
  { id: 'diagnostics-agent', role: 'diagnostics', capabilities: ['diagnostics.run', 'tests.run', 'evidence.record'], permissions: ['read-only', 'diagnostic'] },
  { id: 'security-reviewer', role: 'security', capabilities: ['repository.inspect', 'diagnostics.run', 'evidence.record'], permissions: ['read-only', 'diagnostic'] },
  { id: 'patch-proposer', role: 'patch', capabilities: ['patch.propose'], permissions: ['code-change'] },
  { id: 'verification-agent', role: 'verification', capabilities: ['tests.run', 'evidence.record'], permissions: ['read-only', 'diagnostic'] },
]);

const PRIVILEGED_CAPABILITIES = new Set<JarvisCapability>(['secrets.read', 'production.change', 'deployment.execute']);
const KNOWN_CAPABILITIES = new Set<JarvisCapability>(['repository.inspect', 'diagnostics.run', 'patch.propose', 'tests.run', 'evidence.record', 'secrets.read', 'production.change', 'deployment.execute']);

export function authorizeJarvisCapability(agentId: string, capability: JarvisCapability, approved = false): { allowed: boolean; requiresApproval: boolean; reason: string } {
  const agent = JARVIS_AGENT_REGISTRY.find((candidate) => candidate.id === agentId);
  if (!agent || !KNOWN_CAPABILITIES.has(capability)) return { allowed: false, requiresApproval: false, reason: 'Unknown agent or capability.' };
  if (PRIVILEGED_CAPABILITIES.has(capability)) {
    return approved
      ? { allowed: false, requiresApproval: true, reason: 'Approval is necessary but does not grant this runtime permission.' }
      : { allowed: false, requiresApproval: true, reason: 'Privileged actions are blocked pending a separate approved execution boundary.' };
  }
  if (!agent.capabilities.includes(capability)) return { allowed: false, requiresApproval: false, reason: 'Agent is not granted this capability.' };
  return { allowed: true, requiresApproval: false, reason: 'Capability granted by the internal registry.' };
}

export function getJarvisAgentRegistry() {
  return JARVIS_AGENT_REGISTRY.map((agent) => ({ ...agent, capabilities: [...agent.capabilities], permissions: [...agent.permissions] }));
}
