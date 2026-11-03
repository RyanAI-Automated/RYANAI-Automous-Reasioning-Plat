const TOOL_POLICY = Object.freeze({
  tool_registry: { owner: 'platform', risk: 'read-only', description: 'Read the MCP tool catalogue and current enablement state.' },
  run_project_checks: { owner: 'platform', risk: 'code-execution', description: 'Run repository validation and Docker Compose configuration checks.' },
  repository_status: { owner: 'platform', risk: 'read-only', description: 'Read Git status and whitespace diagnostics.' },
  ryanai_stack_manifest: { owner: 'platform', risk: 'read-only', description: 'Read the non-secret service stack manifest.' },
  platform_health: { owner: 'platform', risk: 'network-read', description: 'Read the configured RyanAI API health endpoint.' },
  agent_tasks_list: { owner: 'orchestration', risk: 'scoped-read', description: 'Read tasks owned by the configured agent principal.' },
  agent_task_comment: { owner: 'orchestration', risk: 'scoped-write', description: 'Append an auditable progress comment to an owned task.' },
  reasoning_route: { owner: 'reasoning', risk: 'external-model-request', description: 'Send a prompt to a configured reasoning provider.' },
});

const REGISTRY_TOOL = 'tool_registry';
const ENABLED_TOOLS_ENV = 'RYANAI_MCP_ENABLED_TOOLS';

/**
 * Resolve the runtime tool surface from an explicit operator-managed allowlist.
 * All action tools are disabled unless their exact names are configured.
 * The read-only registry remains discoverable so clients can inspect the catalogue.
 */
export function resolveToolRegistry(tools, env = process.env) {
  const requested = String(env[ENABLED_TOOLS_ENV] ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const enabled = new Set(requested);
  const knownNames = new Set(Object.keys(TOOL_POLICY));
  const unknown = requested.filter((name) => !knownNames.has(name) || name === REGISTRY_TOOL);
  if (unknown.length) {
    throw new Error(`Unknown or non-configurable MCP tool name(s) in ${ENABLED_TOOLS_ENV}: ${unknown.join(', ')}`);
  }

  const availableNames = new Set(tools.map((tool) => tool.name));
  const unavailable = requested.filter((name) => !availableNames.has(name));
  if (unavailable.length) {
    throw new Error(`Configured MCP tool(s) are not available in this runtime: ${unavailable.join(', ')}`);
  }

  const registry = Object.entries(TOOL_POLICY).map(([name, policy]) => ({
    name,
    available: name === REGISTRY_TOOL || availableNames.has(name),
    owner: policy.owner,
    risk: policy.risk,
    description: policy.description,
    enabled: name === REGISTRY_TOOL || (availableNames.has(name) && enabled.has(name)),
    enablement: name === REGISTRY_TOOL ? 'always-on-read-only' : 'explicit-operator-allowlist',
  }));

  const visibleNames = new Set(registry.filter((entry) => entry.enabled).map((entry) => entry.name));
  return {
    registry,
    tools: tools.filter((tool) => visibleNames.has(tool.name)),
  };
}
