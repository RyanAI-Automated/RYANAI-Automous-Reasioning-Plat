const REQUIRED_CHECKS = Object.freeze([
  'Validate (typecheck, lint, test, build)',
  'MCP server and workflow worker',
  'Issue 435 migrations and attachment security',
  'validate-database',
  'Upgrade legacy pgvector database safely (quoted)',
  'Upgrade legacy pgvector database safely (unquoted)',
  'Test agent API contracts',
  'Dependency audit',
  'Trivy filesystem scan',
  'Analyze (javascript-typescript)',
  'Analyze (python)',
  'TruffleHog secret audit',
  'Codacy Security Scan',
]);

const PENDING_STATUSES = new Set(['queued', 'pending', 'requested', 'waiting', 'in_progress']);
const FAILURE_CONCLUSIONS = new Set(['failure', 'timed_out', 'action_required', 'startup_failure']);
const NEUTRAL_CONCLUSIONS = new Set(['cancelled', 'skipped', 'neutral', 'stale']);

function latestByName(runs) {
  const latest = new Map();
  for (const run of runs) {
    const previous = latest.get(run.name);
    const timestamp = Date.parse(run.started_at || run.created_at || run.completed_at || '') || 0;
    const previousTimestamp = previous
      ? (Date.parse(previous.started_at || previous.created_at || previous.completed_at || '') || 0)
      : -1;
    if (!previous || timestamp >= previousTimestamp) latest.set(run.name, run);
  }
  return latest;
}

/**
 * Summarize exact-head GitHub checks without interpreting absent, skipped or
 * cancelled required checks as a green result.
 */
function summarizeCi(checkRuns, combined) {
  const runs = Array.isArray(checkRuns && checkRuns.check_runs) ? checkRuns.check_runs : [];
  const statuses = Array.isArray(combined && combined.statuses) ? combined.statuses : [];
  const combinedState = combined && typeof combined.state === 'string' ? combined.state : 'unknown';
  const byName = latestByName(runs);
  const required = REQUIRED_CHECKS.map((name) => {
    const run = byName.get(name);
    if (run) {
      if (run.status !== 'completed') return { name, state: 'pending' };
      if (run.conclusion === 'success') return { name, state: 'success' };
      if (FAILURE_CONCLUSIONS.has(run.conclusion)) return { name, state: 'failure' };
      return { name, state: 'neutral' };
    }
    const status = statuses.find((entry) => entry.context === name);
    if (status) {
      if (status.state === 'success') return { name, state: 'success' };
      if (status.state === 'failure' || status.state === 'error') return { name, state: 'failure' };
      return { name, state: 'pending' };
    }
    return { name, state: 'missing' };
  });

  const counts = {
    total: runs.length,
    queued: runs.filter((run) => PENDING_STATUSES.has(run.status) && run.status !== 'in_progress').length,
    inProgress: runs.filter((run) => run.status === 'in_progress').length,
    passed: runs.filter((run) => run.status === 'completed' && run.conclusion === 'success').length,
    failed: runs.filter((run) => run.status === 'completed' && FAILURE_CONCLUSIONS.has(run.conclusion)).length,
    neutral: runs.filter((run) => run.status === 'completed' && NEUTRAL_CONCLUSIONS.has(run.conclusion)).length,
    requiredTotal: REQUIRED_CHECKS.length,
    requiredPassed: required.filter((item) => item.state === 'success').length,
    requiredFailed: required.filter((item) => item.state === 'failure').length,
    requiredPending: required.filter((item) => item.state === 'pending' || item.state === 'neutral').length,
    missingRequired: required.filter((item) => item.state === 'missing').length,
  };

  const hasData = runs.length > 0 || statuses.length > 0;
  const failing = counts.failed > 0 || counts.requiredFailed > 0
    || combinedState === 'failure' || combinedState === 'error';
  const pending = counts.queued > 0 || counts.inProgress > 0
    || counts.requiredPending > 0 || counts.missingRequired > 0
    || combinedState === 'pending';

  let level = 'no-check-data';
  if (failing) level = 'failing';
  else if (pending) level = 'pending';
  else if (hasData && counts.requiredPassed === counts.requiredTotal && combinedState === 'success') {
    level = 'passing';
  } else if (hasData) {
    level = 'pending';
  }

  return { level, combinedState, counts, requiredChecks: required };
}

module.exports = { REQUIRED_CHECKS, summarizeCi };
