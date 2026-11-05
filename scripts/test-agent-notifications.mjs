#!/usr/bin/env node
/**
 * End-to-end PostgreSQL notification test against a disposable CI database.
 * Exercises real enqueue, LISTEN, claim, three-brain orchestration and
 * completion persistence. Deterministic brain responses avoid provider calls
 * and are enabled only in NODE_ENV=test.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const databaseUrl = process.env.RYANAI_NOTIFICATION_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('RYANAI_NOTIFICATION_TEST_DATABASE_URL must point to disposable CI PostgreSQL.');
if (process.env.NODE_ENV === 'production') throw new Error('Notification integration tests are forbidden in production mode.');
const parsedDatabaseUrl = new URL(databaseUrl);
if (!['localhost', '127.0.0.1', '::1'].includes(parsedDatabaseUrl.hostname)) {
  throw new Error('Notification integration tests only allow loopback PostgreSQL hosts.');
}
if (!/^postgres(?:ql)?:$/.test(parsedDatabaseUrl.protocol)) throw new Error('Notification integration tests require PostgreSQL.');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = databaseUrl;

const { prisma } = await import('../src/lib/prisma.ts');
const { dispatchAutonomousTask, getAgentTaskWorkerStatus, startAgentTaskWorker } =
  await import('../src/agent/operations.ts');

const waitFor = async (predicate, timeoutMs, message) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
};
const handoffFixture = (runId) => [
  { runId, fromAgent: 'supervisor', toAgent: 'primary', input: 'Missed-notification fixture', status: 'pending' },
  { runId, fromAgent: 'supervisor', toAgent: 'secondary', input: 'Missed-notification fixture', status: 'pending' },
  { runId, fromAgent: 'primary', toAgent: 'logic', input: 'Awaiting primary analysis', status: 'pending' },
  { runId, fromAgent: 'secondary', toAgent: 'logic', input: 'Awaiting secondary analysis', status: 'pending' },
];

const suffix = randomUUID();
let userId;
let stopWorker;
const evidence = {
  startedAt: new Date().toISOString(),
  database: { host: parsedDatabaseUrl.hostname, database: decodeURIComponent(parsedDatabaseUrl.pathname.slice(1)) },
  notificationTaskId: null,
  missedNotificationTaskId: null,
  notificationReceivedAt: null,
  notificationProcessedAt: null,
  missedNotificationQueuedAt: null,
  missedNotificationProcessedAt: null,
  missedNotificationRecoveryDelayMs: null,
  missedNotificationRecoverySweepAt: null,
  workerId: null,
};

try {
  await prisma.$connect();
  const user = await prisma.user.create({
    data: { email: 'agent-notification-' + suffix + '@example.invalid', passwordHash: 'ci-only-not-a-real-password-hash' },
    select: { id: true },
  });
  userId = user.id;

  stopWorker = startAgentTaskWorker({
    concurrency: 1,
    recoveryIntervalMs: 30_000,
    testBrainInvoker: async (brain) => ({
      brain,
      output: 'Deterministic CI reasoning result for ' + brain,
      latencyMs: 1,
    }),
  });

  await waitFor(
    () => getAgentTaskWorkerStatus().listener?.state === 'listening'
      && getAgentTaskWorkerStatus().listener?.subscribed === true,
    15_000,
    'Reasoning worker did not establish LISTEN agent_task_queue.',
  );
  evidence.workerId = getAgentTaskWorkerStatus().workerId;

  // Real enqueue transaction + post-commit pg_notify; require the matching
  // payload and normal reasoning-run processing on the real worker.
  const notifiedRun = await dispatchAutonomousTask(userId, 'CI: process a task after PostgreSQL notification.');
  evidence.notificationTaskId = notifiedRun.id;
  await waitFor(async () => {
    const run = await prisma.agentRun.findUnique({ where: { id: notifiedRun.id }, select: { status: true, completedAt: true } });
    const worker = getAgentTaskWorkerStatus();
    return run?.status === 'completed' && Boolean(run.completedAt)
      && worker.lastProcessedTask?.runId === notifiedRun.id
      && worker.lastProcessedTask.status === 'completed';
  }, 15_000, 'Notification-triggered reasoning task was not completed by the worker.');
  const firstStatus = getAgentTaskWorkerStatus();
  assert.equal(firstStatus.listener?.lastNotificationPayload, notifiedRun.id);
  assert.equal(firstStatus.lastClaimedTask?.runId, notifiedRun.id);
  assert.equal(firstStatus.lastClaimedTask?.trigger, 'notification');
  evidence.notificationReceivedAt = firstStatus.listener?.lastNotificationAt ?? null;
  evidence.notificationProcessedAt = firstStatus.lastProcessedTask?.completedAt ?? null;

  // Let the prior task-completion drain settle before creating the missed item.
  await new Promise((resolve) => setTimeout(resolve, 300));

  // Insert a committed queue item without emitting NOTIFY. No task is
  // enqueued afterward, so the recovery sweep must be the worker wake-up path.
  const missed = await prisma.agentRun.create({
    data: {
      userId,
      objective: 'CI: recover a committed task when PostgreSQL notification is missed.',
      status: 'queued',
      approvalStatus: 'approved',
      queueType: 'reasoning',
    },
    select: { id: true, createdAt: true },
  });
  await prisma.agentHandoff.createMany({ data: handoffFixture(missed.id) });
  evidence.missedNotificationTaskId = missed.id;
  evidence.missedNotificationQueuedAt = missed.createdAt.toISOString();

  await waitFor(async () => {
    const run = await prisma.agentRun.findUnique({ where: { id: missed.id }, select: { status: true, completedAt: true } });
    const worker = getAgentTaskWorkerStatus();
    return run?.status === 'completed' && Boolean(run.completedAt)
      && worker.lastProcessedTask?.runId === missed.id
      && worker.lastProcessedTask.status === 'completed';
  }, 36_000, '30-second recovery sweep did not process the task whose notification was intentionally omitted.');

  const secondStatus = getAgentTaskWorkerStatus();
  assert.equal(secondStatus.lastClaimedTask?.runId, missed.id);
  assert.equal(secondStatus.lastClaimedTask?.trigger, 'recovery-sweep');
  assert.notEqual(secondStatus.listener?.lastNotificationPayload, missed.id);
  const processed = await prisma.agentRun.findUnique({
    where: { id: missed.id },
    select: { status: true, completedAt: true, result: true },
  });
  assert.equal(processed?.status, 'completed');
  evidence.missedNotificationProcessedAt = processed?.completedAt?.toISOString() ?? null;
  evidence.missedNotificationRecoveryDelayMs =
    Date.parse(evidence.missedNotificationProcessedAt) - Date.parse(evidence.missedNotificationQueuedAt);
  evidence.missedNotificationRecoverySweepAt = secondStatus.lastRecoverySweepAt;
  assert.ok(evidence.missedNotificationRecoveryDelayMs <= 36_000, 'missed notification recovery exceeded one sweep window');

  const completedEvidence = await prisma.agentRunEvidence.findMany({
    where: { runId: { in: [notifiedRun.id, missed.id] } },
    orderBy: [{ runId: 'asc' }, { sequence: 'asc' }],
    select: { runId: true, sequence: true, eventType: true, createdAt: true },
  });
  assert.ok(completedEvidence.some((event) => event.runId === notifiedRun.id && event.eventType === 'execution.completed'));
  assert.ok(completedEvidence.some((event) => event.runId === missed.id && event.eventType === 'execution.completed'));

  evidence.finishedAt = new Date().toISOString();
  console.log(JSON.stringify({
    status: 'PASS',
    checks: {
      realListenerSubscribed: true,
      committedTaskNotificationReceived: true,
      realReasoningWorkerProcessedNotificationTask: true,
      intentionallyMissedNotificationRecoveredByThirtySecondSweep: true,
      appendOnlyExecutionEvidenceRecorded: true,
    },
    evidence,
    listener: secondStatus.listener,
    lastClaimedTask: secondStatus.lastClaimedTask,
    lastProcessedTask: secondStatus.lastProcessedTask,
    runEvidence: completedEvidence.map((event) => ({
      runId: event.runId, sequence: event.sequence, eventType: event.eventType, createdAt: event.createdAt.toISOString(),
    })),
  }, null, 2));
} catch (error) {
  console.error('FAIL PostgreSQL agent notification integration:', error instanceof Error ? error.message : String(error));
  console.error(JSON.stringify({ evidence, worker: getAgentTaskWorkerStatus() }, null, 2));
  process.exitCode = 1;
} finally {
  stopWorker?.();
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  await prisma.$disconnect();
}
