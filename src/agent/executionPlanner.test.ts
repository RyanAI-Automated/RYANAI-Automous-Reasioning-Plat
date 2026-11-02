import { describe, expect, it } from 'vitest';
import { areOwnedOutputsEquivalent, planExecution } from './executionPlanner.js';

describe('planExecution', () => {
  it('selects only the named resources for a known, fresh, bounded change', () => {
    expect(planExecution({ eventKnown: true, snapshotFresh: true, resourceKeys: ['www', 'api'] })).toMatchObject({
      kind: 'targeted',
      resourceKeys: ['api', 'www'],
    });
  });

  it('includes shared metadata when the change affects shared state', () => {
    expect(planExecution({
      eventKnown: true,
      snapshotFresh: true,
      resourceKeys: ['*.example.test'],
      requiresSharedMetadata: true,
    }).kind).toBe('targeted-with-metadata');
  });

  it('escalates unknown events, stale snapshots and unbounded changes to full execution', () => {
    expect(planExecution({ eventKnown: false, snapshotFresh: true, resourceKeys: ['one'] }).kind).toBe('full');
    expect(planExecution({ eventKnown: true, snapshotFresh: false, resourceKeys: ['one'] }).kind).toBe('full');
    expect(planExecution({ eventKnown: true, snapshotFresh: true, affectsEntireSubsystem: true }).kind).toBe('full');
    expect(planExecution({ eventKnown: true, snapshotFresh: true }).kind).toBe('full');
    expect(planExecution({ eventKnown: true, snapshotFresh: true, resourceKeys: ['  '] }).kind).toBe('full');
  });

  it('deduplicates resource identifiers and treats verified purge as a distinct plan', () => {
    expect(planExecution({ eventKnown: true, snapshotFresh: true, resourceKeys: ['a', 'a', ' b '] })).toMatchObject({
      kind: 'targeted',
      resourceKeys: ['a', 'b'],
    });
    expect(planExecution({ eventKnown: true, snapshotFresh: true, purge: true }).kind).toBe('purge');
  });

  it('does not turn stale or unknown deletion signals into a destructive purge', () => {
    expect(planExecution({ eventKnown: false, snapshotFresh: true, purge: true }).kind).toBe('full');
    expect(planExecution({ eventKnown: true, snapshotFresh: false, purge: true }).kind).toBe('full');
  });
});

describe('areOwnedOutputsEquivalent', () => {
  const full = [
    { key: 'a', value: 'A\u0000record' },
    { key: 'b', value: 'B-record' },
    { key: 'unrelated', value: 'unchanged' },
  ];

  it('accepts byte-for-byte identical output for every owned key', () => {
    expect(areOwnedOutputsEquivalent([
      { key: 'b', value: 'B-record' },
      { key: 'a', value: 'A\u0000record' },
    ], full, ['a', 'b'])).toBe(true);
  });

  it('rejects changed, missing, extra, duplicate or unscoped output', () => {
    expect(areOwnedOutputsEquivalent([{ key: 'a', value: 'different' }, { key: 'b', value: 'B-record' }], full, ['a', 'b'])).toBe(false);
    expect(areOwnedOutputsEquivalent([{ key: 'a', value: 'A\u0000record' }], full, ['a', 'b'])).toBe(false);
    expect(areOwnedOutputsEquivalent([...full.slice(0, 2), { key: 'extra', value: 'x' }], full, ['a', 'b'])).toBe(false);
    expect(areOwnedOutputsEquivalent([{ key: 'a', value: 'A' }, { key: 'a', value: 'A' }, { key: 'b', value: 'B-record' }], full, ['a', 'b'])).toBe(false);
    expect(areOwnedOutputsEquivalent([{ key: 'a', value: 'A\u0000record' }, { key: 'b', value: 'B-record' }], full, [])).toBe(false);
  });
});
