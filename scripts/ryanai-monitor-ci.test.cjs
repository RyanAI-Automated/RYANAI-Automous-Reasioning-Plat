const test = require('node:test');
const assert = require('node:assert/strict');
const { REQUIRED_CHECKS, summarizeCi } = require('./ryanai-monitor-ci.cjs');

function successfulRuns() {
  return {
    check_runs: REQUIRED_CHECKS.map((name) => ({
      name,
      status: 'completed',
      conclusion: 'success',
      completed_at: '2026-11-05T12:00:00Z',
    })),
  };
}

test('requires every release-gate check and a successful combined status', () => {
  const result = summarizeCi(successfulRuns(), { state: 'success', statuses: [] });
  assert.equal(result.level, 'passing');
  assert.equal(result.counts.requiredPassed, 13);
  assert.equal(result.counts.missingRequired, 0);
});

test('missing check data never becomes a pass', () => {
  assert.equal(summarizeCi({ check_runs: [] }, { state: 'unknown' }).level, 'no-check-data');
});

test('all neutral or skipped checks cannot produce a passing CI state', () => {
  const neutralRuns = { check_runs: REQUIRED_CHECKS.map((name) => ({ name, status: 'completed', conclusion: 'skipped' })) };
  const result = summarizeCi(neutralRuns, { state: 'success', statuses: [] });
  assert.equal(result.level, 'pending');
  assert.equal(result.counts.requiredPassed, 0);
  assert.equal(result.counts.requiredPending, 13);
});

test('a missing required context remains pending even if unrelated checks are successful', () => {
  const runs = { check_runs: successfulRuns().check_runs.filter((run) => run.name !== REQUIRED_CHECKS[2]) };
  const result = summarizeCi(runs, { state: 'success', statuses: [] });
  assert.equal(result.level, 'pending');
  assert.equal(result.counts.missingRequired, 1);
});

test('a failed required or optional check is failing', () => {
  const runs = successfulRuns();
  runs.check_runs[0] = { ...runs.check_runs[0], conclusion: 'failure' };
  assert.equal(summarizeCi(runs, { state: 'success', statuses: [] }).level, 'failing');
  assert.equal(summarizeCi(successfulRuns(), { state: 'failure', statuses: [] }).level, 'failing');
});

test('queued checks remain pending', () => {
  const runs = successfulRuns();
  runs.check_runs[0] = { ...runs.check_runs[0], status: 'queued', conclusion: null };
  assert.equal(summarizeCi(runs, { state: 'success', statuses: [] }).level, 'pending');
});

test('optional skipped jobs do not block a complete required-check pass', () => {
  const runs = successfulRuns();
  runs.check_runs.push({ name: 'Optional preview deploy', status: 'completed', conclusion: 'skipped' });
  assert.equal(summarizeCi(runs, { state: 'success', statuses: [] }).level, 'passing');
});
