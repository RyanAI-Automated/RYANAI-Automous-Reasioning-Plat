import { randomUUID } from 'node:crypto';

const AGENTS = new Set(['claude', 'codex', 'copilot', 'cursor', 'gemini', 'opencode', 'muse', 'vibe', 'antigravity']);
const DIGEST = /^[a-f0-9]{64}$/i;
const COMMIT = /^[a-f0-9]{40}$/i;
const WORKSPACE_KEY = /^(?!\.{1,2}$)[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

function validateTask(input) {
  if (!input || typeof input !== 'object') throw new Error('Coding task input is required.');
  if (typeof input.workbenchRunId !== 'string' || !input.workbenchRunId.trim()) throw new Error('Workbench run ID is required.');
  if (typeof input.approvalId !== 'string' || !input.approvalId.trim()) throw new Error('Persisted approval evidence ID is required.');
  if (!DIGEST.test(input.planHash) || !COMMIT.test(input.baseCommitSha) || !DIGEST.test(input.proposedDiffHash)) {
    throw new Error('Coding task must include valid plan, base commit and proposed diff bindings.');
  }
  if (!AGENTS.has(input.agent)) throw new Error('Unsupported coding agent.');
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 32_000) {
    throw new Error('Coding prompt must be non-empty and no longer than 32000 characters.');
  }
  if (typeof input.workspaceKey !== 'string' || !WORKSPACE_KEY.test(input.workspaceKey)) {
    throw new Error('Workspace key must be a safe server-resolved workspace identifier.');
  }
  const maxAttempts = input.maxAttempts ?? 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) throw new Error('maxAttempts must be between 1 and 5.');
}

function approvalMatches(run, evidence, input) {
  const payload = evidence?.payload && typeof evidence.payload === 'object' ? evidence.payload : {};
  return Boolean(
    run && evidence &&
    run.status === 'queued' &&
    run.approvalStatus === 'approved' &&
    run.planHash === input.planHash &&
    run.baseCommitSha?.toLowerCase() === input.baseCommitSha.toLowerCase() &&
    run.proposedDiffHash === input.proposedDiffHash &&
    run.approvedPlanHash === input.planHash &&
    run.approvedCommitSha?.toLowerCase() === input.baseCommitSha.toLowerCase() &&
    run.approvedDiffHash === input.proposedDiffHash &&
    typeof run.approvedBy === 'string' &&
    run.approvedBy !== run.userId &&
    evidence.id === input.approvalId &&
    evidence.actorId === run.approvedBy &&
    payload.planHash === input.planHash &&
    payload.baseCommitSha?.toLowerCase() === input.baseCommitSha.toLowerCase() &&
    payload.proposedDiffHash === input.proposedDiffHash
  );
}

export async function enqueueApprovedCodingTask(prisma, input) {
  validateTask(input);
  const task = await prisma.$transaction(async (tx) => {
    const run = await tx.agentRun.findUnique({ where: { id: input.workbenchRunId } });
    const approval = await tx.agentRunEvidence.findFirst({
      where: { runId: input.workbenchRunId, eventType: 'plan.approved' },
      orderBy: { sequence: 'desc' },
    });
    if (!approvalMatches(run, approval, input)) {
      throw new Error('No current independent workbench approval matches this exact coding task.');
    }
    return tx.codingTask.create({
      data: {
        id: randomUUID(), userId: run.userId, workbenchRunId: run.id,
        approvalId: approval.id, planHash: input.planHash,
        baseCommitSha: input.baseCommitSha.toLowerCase(),
        proposedDiffHash: input.proposedDiffHash, agent: input.agent,
        prompt: input.prompt, workspaceKey: input.workspaceKey,
        maxAttempts: input.maxAttempts ?? 3, status: 'queued',
      },
    });
  });
  try {
    await prisma.$queryRawUnsafe('SELECT pg_notify($1, $2)', 'coding_task_queue', task.id);
  } catch {
    // The committed task remains durable and will be found by the worker recovery sweep.
  }
  return task;
}

export function createWorkbenchTaskAuthorizer(prisma) {
  return async ({ taskId, approvalId, planHash, baseCommitSha, proposedDiffHash }) => {
    const run = await prisma.agentRun.findUnique({ where: { id: taskId } });
    const evidence = await prisma.agentRunEvidence.findFirst({
      where: { runId: taskId, eventType: 'plan.approved' },
      orderBy: { sequence: 'desc' },
    });
    const binding = { workbenchRunId: taskId, approvalId, planHash, baseCommitSha, proposedDiffHash };
    if (!approvalMatches(run, evidence, binding)) return null;
    return {
      approved: true, taskId, approvalId, planHash,
      baseCommitSha: baseCommitSha.toLowerCase(), proposedDiffHash,
      approverId: run.approvedBy, authorId: run.userId,
    };
  };
}

export function createCodingTaskQueue(prisma, { now = () => new Date() } = {}) {
  return Object.freeze({
    async claimNext(workerId, leaseMs = 60_000) {
      if (typeof workerId !== 'string' || !workerId.trim()) throw new Error('Worker ID is required.');
      if (!Number.isInteger(leaseMs) || leaseMs < 5_000 || leaseMs > 300_000) throw new Error('Lease must be between 5 seconds and 5 minutes.');
      const rows = await prisma.$queryRawUnsafe(
        'UPDATE "coding_tasks" SET "status" = \\'running\\', "worker_id" = $1, "locked_at" = NOW(), "lease_expires_at" = NOW() + ($2 * INTERVAL \\'1 millisecond\\'), "attempts" = "attempts" + 1, "updated_at" = NOW() ' +
        'WHERE "id" = (SELECT "id" FROM "coding_tasks" WHERE "cancel_requested_at" IS NULL AND "attempts" < "max_attempts" AND "next_attempt_at" <= NOW() AND ("status" = \\'queued\\' OR ("status" = \\'running\\' AND "lease_expires_at" < NOW())) ORDER BY "created_at" ASC LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *',
        workerId, leaseMs,
      );
      return rows[0] ?? null;
    },
    async get(taskId) {
      return prisma.codingTask.findUnique({ where: { id: taskId } });
    },
    async heartbeat(taskId, workerId, leaseMs = 60_000) {
      const timestamp = now();
      const result = await prisma.codingTask.updateMany({
        where: { id: taskId, status: 'running', workerId, cancelRequestedAt: null, leaseExpiresAt: { gt: timestamp } },
        data: { lockedAt: timestamp, leaseExpiresAt: new Date(timestamp.getTime() + leaseMs), updatedAt: timestamp },
      });
      return result.count === 1;
    },
    async requestCancellation(taskId, userId) {
      const timestamp = now();
      const queued = await prisma.codingTask.updateMany({
        where: { id: taskId, userId, status: 'queued' },
        data: { status: 'cancelled', cancelRequestedAt: timestamp, completedAt: timestamp, updatedAt: timestamp },
      });
      if (queued.count === 1) return 'cancelled';
      const running = await prisma.codingTask.updateMany({
        where: { id: taskId, userId, status: 'running' },
        data: { status: 'cancel_requested', cancelRequestedAt: timestamp, updatedAt: timestamp },
      });
      return running.count === 1 ? 'cancel_requested' : 'not_cancellable';
    },
    async markCancelled(taskId, workerId, attempts) {
      const timestamp = now();
      const result = await prisma.codingTask.updateMany({
        where: { id: taskId, workerId, attempts, status: 'cancel_requested' },
        data: { status: 'cancelled', workerId: null, lockedAt: null, leaseExpiresAt: null, completedAt: timestamp, updatedAt: timestamp },
      });
      return result.count === 1;
    },
    async complete(taskId, workerId, attempts, result) {
      const timestamp = now();
      const updated = await prisma.codingTask.updateMany({
        where: { id: taskId, workerId, attempts, status: 'running', cancelRequestedAt: null, leaseExpiresAt: { gt: timestamp } },
        data: { status: 'completed', result, error: null, workerId: null, lockedAt: null, leaseExpiresAt: null, completedAt: timestamp, updatedAt: timestamp },
      });
      return updated.count === 1;
    },
    async fail(taskId, workerId, attempts, error, { retryable = true } = {}) {
      const current = await prisma.codingTask.findUnique({ where: { id: taskId } });
      if (!current || current.workerId !== workerId || current.attempts !== attempts || !['running', 'cancel_requested'].includes(current.status)) return false;
      const timestamp = now();
      const cancelled = retryable && (current.status === 'cancel_requested' || current.cancelRequestedAt !== null);
      const retry = !cancelled && retryable && attempts < current.maxAttempts;
      const delayMs = Math.min(15 * 60_000, 5_000 * (2 ** Math.max(0, attempts - 1)));
      const updated = await prisma.codingTask.updateMany({
        where: { id: taskId, workerId, attempts, status: current.status },
        data: {
          status: cancelled ? 'cancelled' : retry ? 'queued' : retryable ? 'failed' : 'orphaned',
          error: String(error instanceof Error ? error.message : error).slice(0, 2000),
          nextAttemptAt: retry ? new Date(timestamp.getTime() + delayMs) : current.nextAttemptAt,
          workerId: null, lockedAt: null, leaseExpiresAt: null,
          completedAt: cancelled || !retry ? timestamp : null, updatedAt: timestamp,
        },
      });
      return updated.count === 1;
    },
    async recoverExpired() {
      return prisma.$queryRawUnsafe(
        'UPDATE public.coding_tasks SET status = CASE WHEN cancel_requested_at IS NOT NULL THEN \\'cancelled\\' WHEN attempts >= max_attempts THEN \\'failed\\' ELSE \\'queued\\' END, ' +
        'error = CASE WHEN cancel_requested_at IS NOT NULL THEN \\'Cancelled worker lease expired.\\' WHEN attempts >= max_attempts THEN \\'Worker lease expired after the maximum number of attempts.\\' ELSE \\'Worker lease expired; task returned to the coding queue.\\' END, ' +
        'next_attempt_at = CASE WHEN cancel_requested_at IS NULL AND attempts < max_attempts THEN NOW() + LEAST(900000, 5000 * POWER(2, GREATEST(0, attempts - 1))) * INTERVAL \\'1 millisecond\\' ELSE next_attempt_at END, ' +
        'worker_id = NULL, locked_at = NULL, lease_expires_at = NULL, ' +
        'completed_at = CASE WHEN cancel_requested_at IS NOT NULL OR attempts >= max_attempts THEN NOW() ELSE NULL END, updated_at = NOW() ' +
        'WHERE status IN (\\'running\\', \\'cancel_requested\\') AND lease_expires_at < NOW() RETURNING id, status, attempts',
      );
    },
  });
}

export function startCodingTaskWorker({ queue, executeTask, concurrency = 1, leaseMs = 60_000, recoveryIntervalMs = 15_000 }) {
  if (!queue || typeof queue.claimNext !== 'function' || typeof executeTask !== 'function') {
    throw new Error('A coding-task queue and execution function are required.');
  }
  const limit = Math.max(1, Math.min(4, Math.trunc(concurrency)));
  const workerId = randomUUID();
  const active = new Map();
  let stopped = false;
  let draining = false;

  const processTask = async (task, controller) => {
    const heartbeatTimer = setInterval(async () => {
      try {
        const alive = await queue.heartbeat(task.id, workerId, leaseMs);
        if (!alive && !controller.signal.aborted) controller.abort(new Error('Coding task lease lost or cancellation requested.'));
      } catch {
        if (!controller.signal.aborted) controller.abort(new Error('Coding task heartbeat failed; execution is being stopped.'));
      }
    }, Math.max(1_000, Math.floor(leaseMs / 3)));
    heartbeatTimer.unref?.();
    try {
      const result = await executeTask(task, { signal: controller.signal });
      const latest = await queue.get(task.id);
      if (latest?.status === 'cancel_requested') await queue.markCancelled(task.id, workerId, task.attempts);
      else if (!controller.signal.aborted) {
        const saved = await queue.complete(task.id, workerId, task.attempts, result);
        if (!saved) throw new Error('Coding task ownership was lost before completion.');
      }
    } catch (error) {
      const latest = await queue.get(task.id).catch(() => null);
      if (error?.code === 'SANDBOX_TERMINATION_UNCONFIRMED') await queue.fail(task.id, workerId, task.attempts, error, { retryable: false });
      else if (latest?.status === 'cancel_requested') await queue.markCancelled(task.id, workerId, task.attempts);
      else if (!controller.signal.aborted) await queue.fail(task.id, workerId, task.attempts, error);
    } finally {
      clearInterval(heartbeatTimer);
      active.delete(task.id);
      void drain();
    }
  };

  const drain = async () => {
    if (stopped || draining) return;
    draining = true;
    try {
      await queue.recoverExpired();
      while (!stopped && active.size < limit) {
        const task = await queue.claimNext(workerId, leaseMs);
        if (!task) break;
        const controller = new AbortController();
        active.set(task.id, controller);
        void processTask(task, controller);
      }
    } finally {
      draining = false;
    }
  };

  const timer = setInterval(() => { void drain().catch(() => {}); }, recoveryIntervalMs);
  timer.unref?.();
  void drain().catch(() => {});
  return () => {
    stopped = true;
    clearInterval(timer);
    for (const controller of active.values()) controller.abort(new Error('Coding worker is shutting down.'));
  };
}
