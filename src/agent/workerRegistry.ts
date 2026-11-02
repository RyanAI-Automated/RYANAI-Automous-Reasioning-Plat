export const RYANAI_WORKER_ROSTER = [
  { id: 'coordinator', name: 'Coordinator', responsibility: 'Break down requests, assign bounded subtasks, track dependencies, and consolidate evidence.', taskTypes: ['planning', 'triage', 'coordination'], allowedActions: ['read-task', 'assign-subtask', 'record-progress'] },
  { id: 'repository-auditor', name: 'Repository Auditor', responsibility: 'Inventory packages, scripts, workflows, manifests, and documentation consistency.', taskTypes: ['repository-audit', 'inventory', 'documentation-audit'], allowedActions: ['read-repository', 'write-audit-report'] },
  { id: 'ci-diagnostics', name: 'CI Diagnostics', responsibility: 'Inspect completed workflow logs, identify reproducible failures, and propose focused fixes.', taskTypes: ['ci-failure', 'test-failure', 'build-failure'], allowedActions: ['read-workflow-runs', 'read-job-logs', 'write-diagnostic-report'] },
  { id: 'security-auditor', name: 'Security Auditor', responsibility: 'Review dependency, code, container, secret-scan, and application-security findings.', taskTypes: ['security-audit', 'dependency-audit', 'container-audit'], allowedActions: ['read-security-results', 'write-security-report'] },
  { id: 'runtime-infrastructure', name: 'Runtime and Infrastructure', responsibility: 'Assess API, MCP, Redis, deployment descriptors, health checks, and graceful shutdown.', taskTypes: ['runtime-audit', 'infrastructure-audit', 'health-check'], allowedActions: ['read-runtime-config', 'write-runtime-report'] },
  { id: 'data-queue', name: 'Database and Queue', responsibility: 'Review PostgreSQL persistence, queue claims, leases, retries, idempotency, and recovery.', taskTypes: ['database-audit', 'queue-audit', 'worker-recovery'], allowedActions: ['read-schema', 'read-migration-files', 'write-data-report'] },
  { id: 'provider-verification', name: 'Provider Verification', responsibility: 'Verify NVIDIA, Qwen, and Logic independently; distinguish live authentication from static checks.', taskTypes: ['provider-audit', 'brain-health', 'inference-verification'], allowedActions: ['read-provider-config-presence', 'run-approved-provider-probe', 'write-provider-report'] },
  { id: 'communications', name: 'Communications and Identity', responsibility: 'Audit email, WhatsApp, SMS, voice, consent, localization, webhooks, and delivery history.', taskTypes: ['communications-audit', 'identity-audit', 'localization-audit'], allowedActions: ['read-integration-config', 'write-communications-report'] },
  { id: 'frontend-accessibility', name: 'Frontend and Accessibility', responsibility: 'Review UI behavior, responsive layouts, accessibility, and frontend regression coverage.', taskTypes: ['frontend-audit', 'accessibility-audit', 'ui-regression'], allowedActions: ['read-frontend-source', 'write-frontend-report'] },
  { id: 'release-readiness', name: 'Documentation and Release Readiness', responsibility: 'Verify operational documentation, acceptance evidence, release gates, and unresolved blockers.', taskTypes: ['release-audit', 'documentation', 'readiness-review'], allowedActions: ['read-readiness-evidence', 'write-readiness-report'] },
];

export const RYANAI_WORKER_COUNT = 10;

export function getWorkerProfile(workerId: string) {
  return RYANAI_WORKER_ROSTER.find((worker) => worker.id === workerId) ?? null;
}

export function findWorkerForTask(taskType: string) {
  return RYANAI_WORKER_ROSTER.find((worker) => worker.taskTypes.includes(taskType)) ?? null;
}
