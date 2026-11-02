import { describe, expect, it } from 'vitest';
import { buildAgentRunExecutionPrompt, parseAgentRunExecutionChange, planQueuedAgentRun } from './agentRunExecution.js';

describe('durable agent-run execution planning', () => {
  it('defaults missing, malformed and unknown persisted scope to full reconciliation', () => {
    expect(planQueuedAgentRun(undefined).kind).toBe('full');
    expect(planQueuedAgentRun(null).kind).toBe('full');
    expect(planQueuedAgentRun('not-json-object').kind).toBe('full');
    expect(planQueuedAgentRun({ resourceKeys: ['one'] }).kind).toBe('full');
    expect(planQueuedAgentRun({ eventKnown: true, snapshotFresh: false, resourceKeys: ['one'] }).kind).toBe('full');
  });

  it('selects a targeted plan only when known and fresh are explicitly persisted', () => {
    const plan = planQueuedAgentRun({
      eventKnown: true,
      snapshotFresh: true,
      resourceKeys: ['api', 'web', 'api'],
    });
    expect(plan).toMatchObject({ kind: 'targeted', resourceKeys: ['api', 'web'] });
  });

  it('includes shared metadata and rejects untrusted non-string resource keys', () => {
    expect(planQueuedAgentRun({
      eventKnown: true,
      snapshotFresh: true,
      resourceKeys: ['*.example.test', 12],
      requiresSharedMetadata: true,
    })).toMatchObject({ kind: 'targeted-with-metadata', resourceKeys: ['*.example.test'] });
  });

  it('does not let stale or unknown state authorize a purge', () => {
    expect(planQueuedAgentRun({ eventKnown: false, snapshotFresh: true, purge: true }).kind).toBe('full');
    expect(planQueuedAgentRun({ eventKnown: true, snapshotFresh: false, purge: true }).kind).toBe('full');
    expect(planQueuedAgentRun({ eventKnown: true, snapshotFresh: true, purge: true }).kind).toBe('purge');
  });

  it('embeds the resolved scope and approval boundary in the worker prompt', () => {
    const plan = planQueuedAgentRun({ eventKnown: true, snapshotFresh: true, resourceKeys: ['api'] });
    const prompt = buildAgentRunExecutionPrompt('Fix the API', plan);
    expect(prompt).toContain('EXECUTION PLAN: targeted');
    expect(prompt).toContain('verified resources: api');
    expect(prompt).toContain('not authorization');
    expect(prompt).toContain('Fix the API');
  });

  it('treats non-true event/freshness flags as unverified', () => {
    const parsed = parseAgentRunExecutionChange({ eventKnown: 'true', snapshotFresh: 1, resourceKeys: ['x'] });
    expect(parsed.eventKnown).toBe(false);
    expect(parsed.snapshotFresh).toBe(false);
    expect(planQueuedAgentRun(parsed).kind).toBe('full');
  });
});
