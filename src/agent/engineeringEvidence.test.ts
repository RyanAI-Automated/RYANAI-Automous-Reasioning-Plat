import { describe, expect, it } from 'vitest';
import { sha256, verifyEvidenceChain } from './engineeringEvidence.js';

function event(input: {
  runId: string; sequence: number; eventType: string; actorId?: string | null;
  payload: unknown; previousHash?: string | null;
}) {
  const canonical = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + canonical(record[key])).join(',') + '}';
  };
  const previousHash = input.previousHash ?? null;
  const hash = sha256([
    input.runId, String(input.sequence), input.eventType, input.actorId ?? '',
    previousHash ?? '', canonical(input.payload),
  ].join('\n'));
  return { ...input, actorId: input.actorId ?? null, previousHash, hash };
}

describe('immutable engineering evidence chain', () => {
  it('accepts an empty evidence history', () => {
    expect(verifyEvidenceChain([])).toMatchObject({ valid: true, eventCount: 0, finalHash: null });
  });

  it('verifies ordered, hash-linked events', () => {
    const first = event({ runId: 'job-1', sequence: 1, eventType: 'plan.submitted', actorId: 'author', payload: { plan: { b: 2, a: 1 } } });
    const second = event({ runId: 'job-1', sequence: 2, eventType: 'plan.approved', actorId: 'reviewer', payload: { approved: true }, previousHash: first.hash });
    expect(verifyEvidenceChain([first, second])).toMatchObject({ valid: true, eventCount: 2, finalHash: second.hash });
  });

  it('detects payload tampering', () => {
    const first = event({ runId: 'job-1', sequence: 1, eventType: 'execution.completed', payload: { result: 'pass' } });
    expect(verifyEvidenceChain([{ ...first, payload: { result: 'changed' } }])).toMatchObject({ valid: false, firstInvalidSequence: 1 });
  });

  it('detects missing or reordered events', () => {
    const first = event({ runId: 'job-1', sequence: 1, eventType: 'start', payload: {} });
    const second = event({ runId: 'job-1', sequence: 2, eventType: 'finish', payload: {}, previousHash: first.hash });
    expect(verifyEvidenceChain([second])).toMatchObject({ valid: false, firstInvalidSequence: 2 });
    expect(verifyEvidenceChain([second, first])).toMatchObject({ valid: false });
  });
});
