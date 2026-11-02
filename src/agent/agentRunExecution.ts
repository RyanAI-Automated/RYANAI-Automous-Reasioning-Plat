import { planExecution, type ExecutionChange, type ExecutionPlan } from './executionPlanner.js';

/**
 * Parse the persisted scope as untrusted data. Only explicit true values can
 * establish known/fresh state; malformed or absent fields remain conservative.
 */
export function parseAgentRunExecutionChange(value: unknown): ExecutionChange {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { eventKnown: false, snapshotFresh: false };
  }
  const candidate = value as Record<string, unknown>;
  const resourceKeys = Array.isArray(candidate.resourceKeys)
    ? candidate.resourceKeys.filter((key): key is string => typeof key === 'string')
    : undefined;

  return {
    eventKnown: candidate.eventKnown === true,
    snapshotFresh: candidate.snapshotFresh === true,
    resourceKeys,
    requiresSharedMetadata: candidate.requiresSharedMetadata === true,
    affectsEntireSubsystem: candidate.affectsEntireSubsystem === true,
    purge: candidate.purge === true,
  };
}

/** Resolve the persisted queue scope using the shared conservative planner. */
export function planQueuedAgentRun(value: unknown): ExecutionPlan {
  return planExecution(parseAgentRunExecutionChange(value));
}

/** Keep execution scope visible to every reasoning brain and in the durable run result. */
export function buildAgentRunExecutionPrompt(objective: string, plan: ExecutionPlan): string {
  const scope = plan.kind === 'full'
    ? 'FULL RECONCILIATION: inspect the complete relevant task context; do not assume a narrower scope.'
    : plan.kind === 'purge'
      ? 'PURGE: verify the desired removal state and all authorization constraints before proposing removal.'
      : plan.kind === 'targeted-with-metadata'
        ? 'TARGETED WITH SHARED METADATA: cover these resources and their shared metadata: ' + plan.resourceKeys.join(', ')
        : 'TARGETED: limit proposed work to these verified resources: ' + plan.resourceKeys.join(', ');

  return [
    'EXECUTION PLAN: ' + plan.kind,
    'PLAN REASON: ' + plan.reason,
    'SCOPE RULE: ' + scope,
    'This plan is a work-scope hint, not authorization. Do not perform writes, merges, deployments, migrations, secret changes, or external side effects without the RyanAI control plane and required human approval.',
    '',
    'TASK OBJECTIVE:',
    objective,
  ].join('\n');
}
