/**
 * Dedicated module ownership for RyanAI's 12-module agent workforce.
 *
 * This registry defines accountable specialist identities and bounded work
 * types. It does not start workers, schedule runs, grant credentials, or
 * authorize privileged operations. Runtime dispatch must still pass through
 * the existing task queue, Jarvis orchestration, and RyanAI/Gen-X policy.
 */
export type ModuleAgentAction =
  | 'module.read'
  | 'health.inspect'
  | 'task.propose'
  | 'diagnostics.run'
  | 'tests.run'
  | 'evidence.record'
  | 'patch.propose';

export interface ModuleAgentDefinition {
  readonly id: string;
  readonly moduleId: string;
  readonly moduleName: string;
  readonly name: string;
  readonly responsibility: string;
  readonly taskTypes: readonly string[];
  readonly allowedActions: readonly ModuleAgentAction[];
  readonly kpis: readonly string[];
}

const SAFE_MODULE_ACTIONS: readonly ModuleAgentAction[] = Object.freeze([
  'module.read',
  'health.inspect',
  'task.propose',
  'diagnostics.run',
  'tests.run',
  'evidence.record',
  'patch.propose',
]);

/**
 * One accountable primary agent for each of the 12 operational modules.
 * Cross-module specialists in workerRegistry.ts remain available for
 * shared engineering, security, CI, data, and release work.
 */
export const RYANAI_MODULE_AGENT_ROSTER: readonly ModuleAgentDefinition[] = Object.freeze([
  {
    id: 'admin-module-agent',
    moduleId: 'admin',
    moduleName: 'Admin Console',
    name: 'Admin Steward',
    responsibility: 'Audit administrative workflows, configuration consistency, access boundaries, and policy visibility. Report unsafe or missing controls; never change roles or permissions autonomously.',
    taskTypes: ['admin-health-audit', 'configuration-audit', 'access-boundary-review'],
    allowedActions: SAFE_MODULE_ACTIONS,
    kpis: ['verified configuration findings', 'access-control regressions detected', 'evidence completeness'],
  },
  {
    id: 'operator-module-agent',
    moduleId: 'operator',
    moduleName: 'Operator Console',
    name: 'Operations Operator',
    responsibility: 'Triage assigned work, maintain task clarity, identify dependencies, and report execution blockers through the approved task workflow.',
    taskTypes: ['operator-task-triage', 'workflow-audit', 'task-handoff-review'],
    allowedActions: SAFE_MODULE_ACTIONS,
    kpis: ['tasks correctly triaged', 'blocked tasks with actionable reasons', 'handoff completeness'],
  },
  {
    id: 'cockpit-module-agent',
    moduleId: 'cockpit',
    moduleName: 'Command Cockpit',
    name: 'Cockpit Observer',
    responsibility: 'Review reported platform, API, database, queue, and three-brain telemetry; distinguish fresh, stale, missing, and failed signals.',
    taskTypes: ['cockpit-health-audit', 'telemetry-freshness-review', 'incident-correlation'],
    allowedActions: SAFE_MODULE_ACTIONS,
    kpis: ['verified health signals', 'stale telemetry correctly flagged', 'incident detection lead time'],
  },
  {
    id: 'quant-module-agent',
    moduleId: 'quant',
    moduleName: 'Quant Lab',
    name: 'Quant Researcher',
    responsibility: 'Research market data, assess strategy quality, inspect paper-trading risk controls, and run isolated simulations only. No brokerage access or live orders.',
    taskTypes: ['quant-research', 'paper-strategy-review', 'market-data-quality-audit'],
    allowedActions: SAFE_MODULE_ACTIONS,
    kpis: ['reproducible simulations', 'risk-control findings', 'market-data provenance'],
  },
  {
    id: 'audiobook-module-agent',
    moduleId: 'audiobook',
    moduleName: 'Audiobook Studio',
    name: 'Audiobook Producer',
    responsibility: 'Review audiobook project workflows, transcription and rendering quality, job state, asset provenance, and staging-only processing readiness.',
    taskTypes: ['audiobook-job-audit', 'transcription-quality-review', 'render-pipeline-diagnostics'],
    allowedActions: SAFE_MODULE_ACTIONS,
    kpis: ['verified job outcomes', 'quality issues detected', 'asset provenance completeness'],
  },
  {
    id: 'comms-module-agent',
    moduleId: 'comms',
    moduleName: 'Communications',
    name: 'Communications Steward',
    responsibility: 'Review channel configuration, consent, identity, attachments, templates, webhook evidence, and delivery state. Prepare drafts only; never dispatch external messages or calls.',
    taskTypes: ['comms-readiness-audit', 'consent-review', 'delivery-evidence-audit'],
    allowedActions: SAFE_MODULE_ACTIONS,
    kpis: ['consent gaps detected', 'delivery states correctly classified', 'attachment safety findings'],
  },
  {
    id: 'github-module-agent',
    moduleId: 'github',
    moduleName: 'GitHub Engineering',
    name: 'Repository Engineer',
    responsibility: 'Inspect the official repository, diagnose code and CI issues, prepare isolated patches and pull requests, and attach exact-head test/security evidence.',
    taskTypes: ['repository-maintenance', 'ci-diagnostics', 'engineering-patch'],
    allowedActions: SAFE_MODULE_ACTIONS,
    kpis: ['reproducible defects resolved', 'exact-head evidence completeness', 'review-ready pull requests'],
  },
  {
    id: 'inference-module-agent',
    moduleId: 'inference',
    moduleName: 'Inference Console',
    name: 'Inference Analyst',
    responsibility: 'Evaluate NVIDIA, Qwen, Logic, Ollama, and approved specialist models independently; report quality, latency, availability, provenance, and cost without self-selecting production models.',
    taskTypes: ['inference-health-audit', 'model-benchmark', 'routing-quality-review'],
    allowedActions: SAFE_MODULE_ACTIONS,
    kpis: ['reproducible benchmark runs', 'provider states independently verified', 'routing regressions detected'],
  },
  {
    id: 'memory-module-agent',
    moduleId: 'memory',
    moduleName: 'Memory Vault',
    name: 'Memory Curator',
    responsibility: 'Review authorised memory retrieval, provenance, freshness, contradictions, retention, and user-directed correction/deletion workflows. PostgreSQL and pgvector remain authoritative.',
    taskTypes: ['memory-quality-audit', 'retrieval-evaluation', 'provenance-review'],
    allowedActions: SAFE_MODULE_ACTIONS,
    kpis: ['retrieval quality on approved fixtures', 'stale/conflicting facts flagged', 'provenance coverage'],
  },
  {
    id: 'voice-module-agent',
    moduleId: 'voice',
    moduleName: 'Voice',
    name: 'Voice Quality Analyst',
    responsibility: 'Evaluate speech recognition, synthesis, latency, accessibility, device readiness, and consent gates using approved test fixtures.',
    taskTypes: ['voice-quality-audit', 'speech-regression-test', 'voice-readiness-review'],
    allowedActions: SAFE_MODULE_ACTIONS,
    kpis: ['speech test coverage', 'latency measurements with provenance', 'consent and device blockers surfaced'],
  },
  {
    id: 'studio-module-agent',
    moduleId: 'studio',
    moduleName: 'RyanAI Studio',
    name: 'Studio Builder',
    responsibility: 'Review creative and development workspace workflows, editor reliability, project scaffolding, and user-facing quality; propose isolated improvements.',
    taskTypes: ['studio-workflow-audit', 'workspace-quality-review', 'studio-regression-test'],
    allowedActions: SAFE_MODULE_ACTIONS,
    kpis: ['workflow defects detected', 'verified UX improvements', 'regression coverage'],
  },
  {
    id: 'operations-module-agent',
    moduleId: 'operations',
    moduleName: 'Operations Center',
    name: 'Reliability Coordinator',
    responsibility: 'Correlate operational incidents, service readiness, queues, retries, and recovery evidence across modules; escalate systemic risks to Jarvis and Gen-X.',
    taskTypes: ['operations-health-audit', 'incident-review', 'queue-reliability-audit'],
    allowedActions: SAFE_MODULE_ACTIONS,
    kpis: ['incident triage accuracy', 'recovery evidence completeness', 'repeat incident reduction'],
  },
]);

export const RYANAI_MODULE_AGENT_COUNT = 12;

export function getModuleAgentProfile(agentId: string): ModuleAgentDefinition | null {
  return RYANAI_MODULE_AGENT_ROSTER.find((agent) => agent.id === agentId) ?? null;
}

export function getModuleAgentForModule(moduleId: string): ModuleAgentDefinition | null {
  return RYANAI_MODULE_AGENT_ROSTER.find((agent) => agent.moduleId === moduleId) ?? null;
}

export function findModuleAgentForTask(taskType: string): ModuleAgentDefinition | null {
  return RYANAI_MODULE_AGENT_ROSTER.find((agent) => agent.taskTypes.includes(taskType)) ?? null;
}
