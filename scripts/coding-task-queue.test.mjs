import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueApprovedCodingTask, createWorkbenchTaskAuthorizer, createCodingTaskQueue, startCodingTaskWorker } from '../src/engineering/codingTaskQueue.mjs';

const HASH = 'a'.repeat(64);
const COMMIT = 'b'.repeat(40);
function approvedFixture() {
  const run = {
    id: 'workbench-1', userId: 'author-1', status: 'queued', approvalStatus: 'approved',
    planHash: HASH, baseCommitSha: COMMIT, proposedDiffHash: HASH,
    approvedPlanHash: HASH, approvedCommitSha: COMMIT, approvedDiffHash: HASH,
    approvedBy: 'reviewer-2',
  };
  const evidence = {
    id: 'approval-evidence-1', actorId: 'reviewer-2', eventType: 'plan.approved',
    payload: { planHash: HASH, baseCommitSha: COMMIT, proposedDiffHash: HASH },
  };
  return { run, evidence };
}
function input() {
  return {
    workbenchRunId: 'workbench-1', approvalId: 'approval-evidence-1',
    planHash: HASH, baseCommitSha: COMMIT, proposedDiffHash: HASH,
    agent: 'codex', prompt: 'Implement the approved patch', workspaceKey: 'task-workspace',
  };
}

test('enqueue requires the exact persisted independent workbench approval', async () => {
  const { run, evidence } = approvedFixture();
  let created;
  const prisma = {
    $transaction: async (fn) => fn(prisma),
    $queryRawUnsafe: async () => [],
    agentRun: { findUnique: async () => run },
    agentRunEvidence: { findFirst: async () => evidence },
    codingTask: { create: async ({ data }) => (created = data) },
  };
  const result = await enqueueApprovedCodingTask(prisma, input());
  assert.equal(result.status, 'queued');
  assert.equal(result.workbenchRunId, run.id);
  assert.equal(result.approvalId, evidence.id);
  assert.equal(created.userId, run.userId);
  await assert.rejects(() => enqueueApprovedCodingTask(prisma, { ...input(), proposedDiffHash: 'c'.repeat(64) }), /No current independent workbench approval/);
  await assert.rejects(() => enqueueApprovedCodingTask(prisma, { ...input(), workspaceKey: '../outside' }), /safe server-resolved workspace identifier/);
});

test('execution authorizer rechecks approval evidence and rejects stale or self-approved plans', async () => {
  const { run, evidence } = approvedFixture();
  const prisma = {
    agentRun: { findUnique: async () => run },
    agentRunEvidence: { findFirst: async () => evidence },
  };
  const authorize = createWorkbenchTaskAuthorizer(prisma);
  const binding = { taskId: run.id, approvalId: evidence.id, planHash: HASH, baseCommitSha: COMMIT, proposedDiffHash: HASH };
  const result = await authorize(binding);
  assert.equal(result.approved, true);
  assert.equal(result.approverId, 'reviewer-2');
  run.approvedBy = run.userId;
  assert.equal(await authorize(binding), null);
});

test('claim uses a dedicated atomic SKIP LOCKED coding queue, not agent_runs', async () => {
  let query = '';
  let params;
  const expected = { id: 'coding-1', status: 'running', attempts: 1, maxAttempts: 3 };
  const queue = createCodingTaskQueue({
    $queryRawUnsafe: async (sql, ...values) => { query = sql; params = values; return [expected]; },
  });
  const result = await queue.claimNext('worker-1', 30_000);
  assert.equal(result.id, 'coding-1');
  assert.match(query, /UPDATE "coding_tasks"/);
  assert.match(query, /FOR UPDATE SKIP LOCKED/);
  assert.doesNotMatch(query, /agent_runs/);
  assert.deepEqual(params, ['worker-1', 30_000]);
});

test('running task cancellation is persisted and lease heartbeat stops', async () => {
  const calls = [];
  const queue = createCodingTaskQueue({
    codingTask: { updateMany: async (args) => { calls.push(args); return { count: args.where.status === 'running' ? 1 : 0 }; } },
  });
  assert.equal(await queue.requestCancellation('coding-1', 'author-1'), 'cancel_requested');
  assert.equal(calls[0].where.status, 'queued');
  assert.equal(calls[1].where.status, 'running');
  assert.equal(calls[1].data.status, 'cancel_requested');
});

test('expired leases are recovered into retry, failed or cancelled states by one SQL transition', async () => {
  let query = '';
  const queue = createCodingTaskQueue({
    $queryRawUnsafe: async (sql) => { query = sql; return [{ id: 'coding-1', status: 'queued', attempts: 1 }]; },
  });
  const recovered = await queue.recoverExpired();
  assert.equal(recovered[0].status, 'queued');
  assert.match(query, /UPDATE public\.coding_tasks/);
  assert.match(query, /lease_expires_at < NOW\(\)/);
  assert.match(query, /cancel_requested_at IS NOT NULL/);
});

test('worker executes a claimed task and records durable completion', async () => {
  const task = { id: 'coding-2', attempts: 1, status: 'running' };
  const updates = [];
  let calls = 0;
  const queue = {
    recoverExpired: async () => [],
    claimNext: async () => calls++ === 0 ? task : null,
    heartbeat: async () => true,
    get: async () => ({ ...task, status: 'running' }),
    complete: async (...args) => { updates.push(args); return true; },
    fail: async () => false,
    markCancelled: async () => false,
  };
  const stop = startCodingTaskWorker({
    queue, concurrency: 1, recoveryIntervalMs: 60_000,
    executeTask: async () => ({ status: 'completed', verification: 'not-run' }),
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  stop();
  assert.equal(updates.length, 1);
  assert.equal(updates[0][0], task.id);
  assert.equal(updates[0][2], task.attempts);
});

test('worker aborts an active coding task when its lease heartbeat is lost', async () => {
  const task = { id: 'coding-cancel', attempts: 1, status: 'running' };
  let cancelled = 0;
  let executions = 0;
  const queue = {
    recoverExpired: async () => [],
    claimNext: async () => executions++ === 0 ? task : null,
    heartbeat: async () => false,
    get: async () => ({ ...task, status: 'cancel_requested' }),
    markCancelled: async () => { cancelled += 1; return true; },
    complete: async () => false,
    fail: async () => false,
  };
  const stop = startCodingTaskWorker({
    queue, leaseMs: 5_000, recoveryIntervalMs: 60_000,
    executeTask: async (_task, { signal }) => new Promise((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  });
  await new Promise((resolve) => setTimeout(resolve, 1_800));
  stop();
  assert.equal(cancelled, 1);
});
