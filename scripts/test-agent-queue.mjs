#!/usr/bin/env node
/**
 * Verify the real PostgreSQL agent_runs claim SQL against disposable CI DB.
 * No model/provider calls are made. This exercises durable queue state,
 * competing SKIP LOCKED claims, expired lease recovery, retry eligibility,
 * and terminal attempt exhaustion.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma.ts';
import { claimNextAgentRun } from '../src/agent/operations.ts';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must target a disposable PostgreSQL database.');
}

const suffix = randomUUID();
const workerA = 'ci-worker-a-' + suffix;
const workerB = 'ci-worker-b-' + suffix;
const recoveryWorker = 'ci-worker-recovery-' + suffix;
const retryWorker = 'ci-worker-retry-' + suffix;
let userId;

try {
  const user = await prisma.user.create({
    data: {
      email: 'agent-queue-' + suffix + '@example.invalid',
      passwordHash: 'ci-only-not-a-real-password-hash',
    },
    select: { id: true },
  });
  userId = user.id;

  const [first, second] = await Promise.all([
    prisma.agentRun.create({ data: { userId, objective: 'CI queue claim fixture A', status: 'queued' } }),
    prisma.agentRun.create({ data: { userId, objective: 'CI queue claim fixture B', status: 'queued' } }),
  ]);

  // Two independent workers must claim different rows under concurrent load.
  const claims = await Promise.all([
    claimNextAgentRun(workerA),
    claimNextAgentRun(workerB),
  ]);
  assert.equal(claims.filter(Boolean).length, 2, 'both workers should claim one queued run');
  const claimedIds = claims.map((claim) => claim?.id).sort();
  assert.deepEqual(claimedIds, [first.id, second.id].sort(), 'a run must never be claimed twice');
  assert.deepEqual(claims.map((claim) => claim?.attempts).sort(), [1, 1]);

  // A dead worker's expired lease is reclaimable, with the attempt counter fenced.
  const expired = claims[0];
  assert.ok(expired);
  await prisma.agentRun.update({
    where: { id: expired.id },
    data: {
      lockedAt: new Date(Date.now() - 4 * 60_000),
      nextAttemptAt: new Date(Date.now() - 1_000),
    },
  });
  const recovered = await claimNextAgentRun(recoveryWorker);
  assert.equal(recovered?.id, expired.id, 'expired lease should be recovered');
  assert.equal(recovered?.attempts, 2, 'recovery must increment the attempt counter');
  assert.equal(recovered?.worker_id, recoveryWorker, 'new worker must own the recovered lease');

  // A stale run at its maximum attempt count must be terminal, not reclaimed.
  const exhausted = claims[1];
  assert.ok(exhausted);
  await prisma.agentRun.update({
    where: { id: exhausted.id },
    data: {
      attempts: 3,
      maxAttempts: 3,
      lockedAt: new Date(Date.now() - 4 * 60_000),
      nextAttemptAt: new Date(Date.now() - 1_000),
    },
  });
  const noExhaustedClaim = await claimNextAgentRun('ci-worker-exhausted-' + suffix);
  assert.equal(noExhaustedClaim, null, 'exhausted stale work must not be claimed');
  const exhaustedState = await prisma.agentRun.findUnique({
    where: { id: exhausted.id },
    select: { status: true, workerId: true, lockedAt: true },
  });
  assert.deepEqual(exhaustedState, { status: 'failed', workerId: null, lockedAt: null });

  // Backoff timestamps prevent early retries; due retries become claimable.
  const delayed = await prisma.agentRun.create({
    data: {
      userId,
      objective: 'CI queue retry backoff fixture',
      status: 'queued',
      nextAttemptAt: new Date(Date.now() + 60_000),
    },
  });
  assert.equal(await claimNextAgentRun(retryWorker), null, 'a future retry must not be claimed early');
  await prisma.agentRun.update({
    where: { id: delayed.id },
    data: { nextAttemptAt: new Date(Date.now() - 1_000) },
  });
  const due = await claimNextAgentRun(retryWorker);
  assert.equal(due?.id, delayed.id, 'a due retry should become claimable');

  console.log('PASS concurrent PostgreSQL claims: distinct rows, no duplicate ownership');
  console.log('PASS expired lease recovery: ownership transferred and attempt incremented');
  console.log('PASS retry policy: exhausted runs fail closed and future backoff is respected');
  console.log('Agent queue PostgreSQL checks passed.');
} finally {
  if (userId) {
    await prisma.user.delete({ where: { id: userId } });
  }
  await prisma.$disconnect();
}
