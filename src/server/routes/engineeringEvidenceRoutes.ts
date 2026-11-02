import type { FastifyPluginAsync } from 'fastify';
import { createHash } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { requireAdmin } from './auth.js';
import { publishAgentTaskNotification } from '../../agent/queueNotifications.js';
import { appendRunEvidence, buildEvidenceBundle, sha256 } from '../../agent/engineeringEvidence.js';

interface CreateJobBody {
  objective: string;
  plan: Record<string, unknown>;
  baseCommitSha: string;
  proposedDiff: string;
}
interface ApprovalBody {
  planHash: string;
  baseCommitSha: string;
  proposedDiffHash: string;
}
interface SteeringBody { instruction: string; plan: Record<string, unknown>; baseCommitSha: string; proposedDiff: string; }
interface ChecksBody { checks: Array<{ name: string; status: 'pass' | 'fail' | 'skipped' | 'pending' | 'unverified'; source: string; runUrl?: string }>; }
interface ReceiptBody {
  outcome: 'pass' | 'fail' | 'inconclusive';
  summary: string;
  evidenceRefs?: string[];
}

const isSha = (value: string) => /^[a-f0-9]{40}$/i.test(value);
const isDigest = (value: string) => /^[a-f0-9]{64}$/i.test(value);

export const engineeringEvidenceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdmin);

  fastify.post<{ Body: CreateJobBody }>('/api/engineering/jobs', {
    schema: { body: {
      type: 'object', required: ['objective', 'plan', 'baseCommitSha', 'proposedDiff'], additionalProperties: false,
      properties: {
        objective: { type: 'string', minLength: 5, maxLength: 20000 },
        plan: { type: 'object', minProperties: 1 },
        baseCommitSha: { type: 'string', pattern: '^[a-fA-F0-9]{40}$' },
        proposedDiff: { type: 'string', minLength: 1, maxLength: 1000000 },
      },
    } },
  }, async (request, reply) => {
    const { objective, plan, baseCommitSha, proposedDiff } = request.body;
    const planHash = sha256(JSON.stringify({ plan, steeringNotes: null }));
    const proposedDiffHash = createHash('sha256').update(proposedDiff, 'utf8').digest('hex');
    const run = await prisma.$transaction(async (tx) => {
      const created = await tx.agentRun.create({
        data: {
          userId: request.authUser!.id,
          objective: objective.trim(),
          status: 'queued',
          approvalStatus: 'pending',
          planSnapshot: plan,
          planHash,
          baseCommitSha: baseCommitSha.toLowerCase(),
          proposedDiffHash,
          executionScope: {},
        },
      });
      await tx.agentHandoff.createMany({ data: [
        { runId: created.id, fromAgent: 'supervisor', toAgent: 'primary', input: objective, status: 'pending' },
        { runId: created.id, fromAgent: 'supervisor', toAgent: 'secondary', input: objective, status: 'pending' },
        { runId: created.id, fromAgent: 'primary', toAgent: 'logic', input: 'Awaiting primary analysis', status: 'pending' },
        { runId: created.id, fromAgent: 'secondary', toAgent: 'logic', input: 'Awaiting secondary analysis', status: 'pending' },
      ] });
      await appendRunEvidence(tx, {
        runId: created.id,
        eventType: 'plan.submitted',
        actorId: request.authUser!.id,
        payload: { objective, plan, planHash, baseCommitSha: baseCommitSha.toLowerCase(), proposedDiff, proposedDiffHash },
      });
      return created;
    });
    return reply.code(202).send({
      jobId: run.id,
      status: run.status,
      approvalStatus: run.approvalStatus,
      planHash,
      baseCommitSha: run.baseCommitSha,
      proposedDiffHash,
      message: 'Job persisted. Worker execution is blocked until an independent approval matches this exact plan, commit and diff.',
    });
  });

  fastify.get<{ Params: { jobId: string } }>('/api/engineering/jobs/:jobId', async (request, reply) => {
    const job = await prisma.agentRun.findUnique({
      where: { id: request.params.jobId },
      include: {
        handoffs: { orderBy: { startedAt: 'asc' } },
        evidence: { orderBy: { sequence: 'asc' } },
      },
    });
    if (!job) return reply.code(404).send({ error: 'Engineering job not found.' });
    const { verifyEvidenceChain } = await import('../../agent/engineeringEvidence.js');
    return {
      job,
      evidenceIntegrity: verifyEvidenceChain(job.evidence),
    };
  });

  fastify.post<{ Params: { jobId: string }; Body: ApprovalBody }>('/api/engineering/jobs/:jobId/approve', async (request, reply) => {
    const { planHash, baseCommitSha, proposedDiffHash } = request.body;
    if (!isDigest(planHash) || !isSha(baseCommitSha) || !isDigest(proposedDiffHash)) {
      return reply.code(400).send({ error: 'Approval must include a valid plan digest, base commit SHA and diff digest.' });
    }
    const result = await prisma.$transaction(async (tx) => {
      const job = await tx.agentRun.findUnique({ where: { id: request.params.jobId } });
      if (!job) return { status: 'missing' as const };
      if (job.userId === request.authUser!.id) return { status: 'self_approval' as const };
      if (job.status !== 'queued' || job.approvalStatus !== 'pending') return { status: 'not_pending' as const };
      if (job.planHash !== planHash || job.baseCommitSha !== baseCommitSha.toLowerCase() || job.proposedDiffHash !== proposedDiffHash) {
        return { status: 'stale' as const };
      }
      const updated = await tx.agentRun.updateMany({
        where: { id: job.id, status: 'queued', approvalStatus: 'pending', planHash, baseCommitSha: baseCommitSha.toLowerCase(), proposedDiffHash },
        data: {
          approvalStatus: 'approved',
          approvedBy: request.authUser!.id,
          approvedAt: new Date(),
          approvedPlanHash: planHash,
          approvedCommitSha: baseCommitSha.toLowerCase(),
          approvedDiffHash: proposedDiffHash,
        },
      });
      if (updated.count !== 1) return { status: 'race' as const };
      await appendRunEvidence(tx, {
        runId: job.id, eventType: 'plan.approved', actorId: request.authUser!.id,
        payload: { planHash, baseCommitSha: baseCommitSha.toLowerCase(), proposedDiffHash },
      });
      return { status: 'approved' as const };
    });
    if (result.status !== 'approved') {
      const status = result.status === 'missing' ? 404 : result.status === 'self_approval' ? 403 : result.status === 'stale' || result.status === 'race' ? 409 : 422;
      return reply.code(status).send({ error: result.status === 'self_approval' ? 'The job creator cannot approve their own plan.' : 'Approval was not applied: ' + result.status });
    }
    await publishAgentTaskNotification(request.params.jobId, async (id) => {
      await prisma.$queryRaw`SELECT pg_notify('agent_task_queue', ${id})`;
    });
    return { success: true, approvalStatus: 'approved', jobId: request.params.jobId };
  });

  fastify.post<{ Params: { jobId: string }; Body: SteeringBody }>('/api/engineering/jobs/:jobId/steer', {
    schema: { body: { type: 'object', required: ['instruction', 'plan', 'baseCommitSha', 'proposedDiff'], additionalProperties: false, properties: {
      instruction: { type: 'string', minLength: 1, maxLength: 8000 },
      plan: { type: 'object', minProperties: 1 },
      baseCommitSha: { type: 'string', pattern: '^[a-fA-F0-9]{40}

  fastify.post<{ Params: { jobId: string }; Body: { reason: string } }>('/api/engineering/jobs/:jobId/reject', async (request, reply) => {
    const result = await prisma.$transaction(async (tx) => {
      const job = await tx.agentRun.findUnique({ where: { id: request.params.jobId } });
      if (!job) return 'missing';
      if (job.status !== 'queued' || job.approvalStatus !== 'pending') return 'not_pending';
      await tx.agentRun.update({ where: { id: job.id }, data: { status: 'rejected', approvalStatus: 'rejected', completedAt: new Date() } });
      await appendRunEvidence(tx, { runId: job.id, eventType: 'plan.rejected', actorId: request.authUser!.id, payload: { reason: request.body.reason } });
      return 'rejected';
    });
    if (result !== 'rejected') return reply.code(result === 'missing' ? 404 : 409).send({ error: 'Job is not awaiting approval.' });
    return { success: true, status: 'rejected' };
  });

  fastify.post<{ Params: { jobId: string }; Body: { reason?: string } }>('/api/engineering/jobs/:jobId/cancel', async (request, reply) => {
    const result = await prisma.$transaction(async (tx) => {
      const job = await tx.agentRun.findUnique({ where: { id: request.params.jobId } });
      if (!job) return 'missing';
      if (['completed', 'failed', 'cancelled', 'rejected'].includes(job.status)) return 'terminal';
      const queued = job.status === 'queued';
      await tx.agentRun.update({ where: { id: job.id }, data: queued
        ? { status: 'cancelled', approvalStatus: 'cancelled', completedAt: new Date() }
        : { cancelRequestedAt: new Date() } });
      await appendRunEvidence(tx, { runId: job.id, eventType: queued ? 'job.cancelled' : 'job.cancellation_requested', actorId: request.authUser!.id, payload: { reason: request.body.reason ?? null } });
      return queued ? 'cancelled' : 'requested';
    });
    if (result === 'missing') return reply.code(404).send({ error: 'Job not found.' });
    if (result === 'terminal') return reply.code(409).send({ error: 'Job is already terminal.' });
    return { success: true, status: result };
  });

  fastify.post<{ Params: { jobId: string }; Body: ChecksBody }>('/api/engineering/jobs/:jobId/checks', {
    schema: { body: { type: 'object', required: ['checks'], additionalProperties: false, properties: {
      checks: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', required: ['name', 'status', 'source'], additionalProperties: false, properties: {
        name: { type: 'string', minLength: 1, maxLength: 200 },
        status: { type: 'string', enum: ['pass', 'fail', 'skipped', 'pending', 'unverified'] },
        source: { type: 'string', minLength: 1, maxLength: 300 },
        runUrl: { type: 'string', maxLength: 2000 },
      } } },
    } } },
  }, async (request, reply) => {
    const job = await prisma.agentRun.findUnique({ where: { id: request.params.jobId }, select: { id: true } });
    if (!job) return reply.code(404).send({ error: 'Job not found.' });
    await prisma.$transaction(async (tx) => {
      for (const check of request.body.checks) {
        await appendRunEvidence(tx, { runId: job.id, eventType: 'verification.check', actorId: request.authUser!.id, payload: check });
      }
    });
    return { success: true, recorded: request.body.checks.length, trust: 'human-reported; not independently fetched from CI' };
  });

  fastify.post<{ Params: { jobId: string }; Body: ReceiptBody }>('/api/engineering/jobs/:jobId/evaluations', async (request, reply) => {
    const job = await prisma.agentRun.findUnique({ where: { id: request.params.jobId } });
    if (!job) return reply.code(404).send({ error: 'Job not found.' });
    if (job.userId === request.authUser!.id) return reply.code(403).send({ error: 'The job author cannot issue the independent evaluation receipt.' });
    await prisma.$transaction((tx) => appendRunEvidence(tx, {
      runId: job.id, eventType: 'evaluation.receipt', actorId: request.authUser!.id,
      payload: { outcome: request.body.outcome, summary: request.body.summary, evidenceRefs: request.body.evidenceRefs ?? [] },
    }));
    return { success: true, receipt: 'evaluation.receipt' };
  });

  fastify.post<{ Params: { jobId: string }; Body: ReceiptBody }>('/api/engineering/jobs/:jobId/assurance', async (request, reply) => {
    const job = await prisma.agentRun.findUnique({ where: { id: request.params.jobId } });
    if (!job) return reply.code(404).send({ error: 'Job not found.' });
    if (job.userId === request.authUser!.id) return reply.code(403).send({ error: 'The job author cannot issue the independent assurance receipt.' });
    await prisma.$transaction((tx) => appendRunEvidence(tx, {
      runId: job.id, eventType: 'assurance.receipt', actorId: request.authUser!.id,
      payload: { outcome: request.body.outcome, summary: request.body.summary, evidenceRefs: request.body.evidenceRefs ?? [] },
    }));
    return { success: true, receipt: 'assurance.receipt' };
  });

  fastify.get<{ Params: { jobId: string } }>('/api/engineering/jobs/:jobId/evidence-bundle', async (request, reply) => {
    const result = await buildEvidenceBundle(request.params.jobId);
    if (!result) return reply.code(404).send({ error: 'Job not found.' });
    const body = JSON.stringify(result.bundle, null, 2);
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="ryanai-evidence-' + request.params.jobId + '.json"');
    reply.header('x-evidence-sha256', sha256(body));
    reply.header('x-evidence-chain-valid', String(result.integrity.valid));
    return reply.send(body);
  });
};
 },
      proposedDiff: { type: 'string', minLength: 1, maxLength: 1000000 },
    } } },
  }, async (request, reply) => {
    const instruction = request.body.instruction.trim();
    const proposedDiffHash = sha256(request.body.proposedDiff);
    const result = await prisma.$transaction(async (tx) => {
      const job = await tx.agentRun.findUnique({ where: { id: request.params.jobId } });
      if (!job) return 'missing';
      if (job.status !== 'queued' || job.approvalStatus !== 'pending') return 'not_pending';
      const steeringNotes = [job.steeringNotes, instruction].filter(Boolean).join('\n\n');
      const planHash = sha256(JSON.stringify({ plan: request.body.plan, steeringNotes }));
      await tx.agentRun.update({ where: { id: job.id }, data: {
        steeringNotes, planSnapshot: request.body.plan, planHash,
        baseCommitSha: request.body.baseCommitSha.toLowerCase(), proposedDiffHash,
        approvalStatus: 'pending',
        approvedBy: null, approvedAt: null, approvedPlanHash: null, approvedCommitSha: null, approvedDiffHash: null,
      } });
      await appendRunEvidence(tx, { runId: job.id, eventType: 'plan.steered', actorId: request.authUser!.id, payload: {
        instruction, plan: request.body.plan, planHash, baseCommitSha: request.body.baseCommitSha.toLowerCase(),
        proposedDiff: request.body.proposedDiff, proposedDiffHash,
      } });
      return { status: 'steered', planHash, proposedDiffHash };
    });
    if (result === 'missing' || result === 'not_pending') return reply.code(result === 'missing' ? 404 : 409).send({ error: 'Job is not awaiting approval.' });
    return { success: true, approvalStatus: 'pending', ...result, message: 'Steering and revised plan/diff recorded. A separate administrator must approve the new exact snapshot.' };
  });

  fastify.post<{ Params: { jobId: string }; Body: { reason: string } }>('/api/engineering/jobs/:jobId/reject', async (request, reply) => {
    const result = await prisma.$transaction(async (tx) => {
      const job = await tx.agentRun.findUnique({ where: { id: request.params.jobId } });
      if (!job) return 'missing';
      if (job.status !== 'queued' || job.approvalStatus !== 'pending') return 'not_pending';
      await tx.agentRun.update({ where: { id: job.id }, data: { status: 'rejected', approvalStatus: 'rejected', completedAt: new Date() } });
      await appendRunEvidence(tx, { runId: job.id, eventType: 'plan.rejected', actorId: request.authUser!.id, payload: { reason: request.body.reason } });
      return 'rejected';
    });
    if (result !== 'rejected') return reply.code(result === 'missing' ? 404 : 409).send({ error: 'Job is not awaiting approval.' });
    return { success: true, status: 'rejected' };
  });

  fastify.post<{ Params: { jobId: string }; Body: { reason?: string } }>('/api/engineering/jobs/:jobId/cancel', async (request, reply) => {
    const result = await prisma.$transaction(async (tx) => {
      const job = await tx.agentRun.findUnique({ where: { id: request.params.jobId } });
      if (!job) return 'missing';
      if (['completed', 'failed', 'cancelled', 'rejected'].includes(job.status)) return 'terminal';
      const queued = job.status === 'queued';
      await tx.agentRun.update({ where: { id: job.id }, data: queued
        ? { status: 'cancelled', approvalStatus: 'cancelled', completedAt: new Date() }
        : { cancelRequestedAt: new Date() } });
      await appendRunEvidence(tx, { runId: job.id, eventType: queued ? 'job.cancelled' : 'job.cancellation_requested', actorId: request.authUser!.id, payload: { reason: request.body.reason ?? null } });
      return queued ? 'cancelled' : 'requested';
    });
    if (result === 'missing') return reply.code(404).send({ error: 'Job not found.' });
    if (result === 'terminal') return reply.code(409).send({ error: 'Job is already terminal.' });
    return { success: true, status: result };
  });

  fastify.post<{ Params: { jobId: string }; Body: ReceiptBody }>('/api/engineering/jobs/:jobId/evaluations', async (request, reply) => {
    const job = await prisma.agentRun.findUnique({ where: { id: request.params.jobId } });
    if (!job) return reply.code(404).send({ error: 'Job not found.' });
    if (job.userId === request.authUser!.id) return reply.code(403).send({ error: 'The job author cannot issue the independent evaluation receipt.' });
    await prisma.$transaction((tx) => appendRunEvidence(tx, {
      runId: job.id, eventType: 'evaluation.receipt', actorId: request.authUser!.id,
      payload: { outcome: request.body.outcome, summary: request.body.summary, evidenceRefs: request.body.evidenceRefs ?? [] },
    }));
    return { success: true, receipt: 'evaluation.receipt' };
  });

  fastify.post<{ Params: { jobId: string }; Body: ReceiptBody }>('/api/engineering/jobs/:jobId/assurance', async (request, reply) => {
    const job = await prisma.agentRun.findUnique({ where: { id: request.params.jobId } });
    if (!job) return reply.code(404).send({ error: 'Job not found.' });
    if (job.userId === request.authUser!.id) return reply.code(403).send({ error: 'The job author cannot issue the independent assurance receipt.' });
    await prisma.$transaction((tx) => appendRunEvidence(tx, {
      runId: job.id, eventType: 'assurance.receipt', actorId: request.authUser!.id,
      payload: { outcome: request.body.outcome, summary: request.body.summary, evidenceRefs: request.body.evidenceRefs ?? [] },
    }));
    return { success: true, receipt: 'assurance.receipt' };
  });

  fastify.get<{ Params: { jobId: string } }>('/api/engineering/jobs/:jobId/evidence-bundle', async (request, reply) => {
    const result = await buildEvidenceBundle(request.params.jobId);
    if (!result) return reply.code(404).send({ error: 'Job not found.' });
    const body = JSON.stringify(result.bundle, null, 2);
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="ryanai-evidence-' + request.params.jobId + '.json"');
    reply.header('x-evidence-sha256', sha256(body));
    reply.header('x-evidence-chain-valid', String(result.integrity.valid));
    return reply.send(body);
  });
};
