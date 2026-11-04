import test from 'node:test';
import assert from 'node:assert/strict';
import { isEligiblePatchLogEvent } from './update-patch-log-guards.mjs';

test('accepts only confirmed merges into main from normal branches', () => {
  assert.equal(isEligiblePatchLogEvent({
    merged: true,
    base: { ref: 'main' },
    head: { ref: 'feature/provider-fix' },
  }), true);
});

test('rejects confirmed merges targeting branches other than main', () => {
  for (const target of ['develop', 'release/1.0', 'patch-log/pr-12']) {
    assert.equal(isEligiblePatchLogEvent({
      merged: true,
      base: { ref: target },
      head: { ref: 'feature/change' },
    }), false, target);
  }
});

test('rejects pull requests that are not confirmed merged', () => {
  assert.equal(isEligiblePatchLogEvent({
    merged: false,
    base: { ref: 'main' },
    head: { ref: 'feature/change' },
  }), false);
});

test('rejects the patch-log automation branch to prevent recursion', () => {
  assert.equal(isEligiblePatchLogEvent({
    merged: true,
    base: { ref: 'main' },
    head: { ref: 'patch-log/pr-814' },
  }), false);
});

test('rejects incomplete event metadata', () => {
  assert.equal(isEligiblePatchLogEvent(null), false);
  assert.equal(isEligiblePatchLogEvent({ merged: true, base: { ref: 'main' } }), false);
});
