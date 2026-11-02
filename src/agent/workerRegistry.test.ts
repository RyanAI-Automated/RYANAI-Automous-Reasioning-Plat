import { describe, expect, it } from 'vitest';
import { findWorkerForTask, getWorkerProfile, RYANAI_WORKER_COUNT, RYANAI_WORKER_ROSTER } from './workerRegistry.js';

describe('RyanAI worker roster', () => {
  it('defines ten uniquely identified specialist profiles', () => {
    expect(RYANAI_WORKER_ROSTER).toHaveLength(RYANAI_WORKER_COUNT);
    expect(new Set(RYANAI_WORKER_ROSTER.map((worker) => worker.id)).size).toBe(RYANAI_WORKER_COUNT);
  });

  it('gives every worker a responsibility, task types, and bounded actions', () => {
    for (const worker of RYANAI_WORKER_ROSTER) {
      expect(worker.name.trim()).not.toBe('');
      expect(worker.responsibility.trim()).not.toBe('');
      expect(worker.taskTypes.length).toBeGreaterThan(0);
      expect(worker.allowedActions.length).toBeGreaterThan(0);
    }
  });

  it('does not grant production, secret, deployment, or merge privileges', () => {
    const forbiddenActions = new Set([
      'production-write',
      'secret-read',
      'secret-write',
      'deploy',
      'merge-pull-request',
    ]);

    for (const worker of RYANAI_WORKER_ROSTER) {
      for (const action of worker.allowedActions) {
        expect(forbiddenActions.has(action)).toBe(false);
      }
    }
  });

  it('resolves known worker IDs and safely rejects unknown IDs', () => {
    expect(getWorkerProfile('ci-diagnostics')?.name).toBe('CI Diagnostics');
    expect(getWorkerProfile('unknown-worker')).toBeNull();
  });

  it('routes supported task types to a single specialist', () => {
    expect(findWorkerForTask('security-audit')?.id).toBe('security-auditor');
    expect(findWorkerForTask('queue-audit')?.id).toBe('data-queue');
    expect(findWorkerForTask('unknown-task')).toBeNull();
  });
});
