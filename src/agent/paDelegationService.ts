import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { captureQueueTraceContextForStorage } from '../telemetry/queueContext.js';
import { appendRunEvidence } from './engineeringEvidence.js';
import {
  signAgentIdentityProof,
  verifyPAIdentityProof,
  PA_DELEGATION_CAPABILITIES,
  JARVIS_IDENTITY,
  type PADelegationCapability,
  type NonceConsumer,
} from './paJarvisHandshake.js';

const secret = () => process.env.PA_JARVIS_IDENTITY_SECRET?.trim() || '';

export function requirePAIdentitySecret(): string {
  const value = secret();
  if (Buffer.byteLength(value, 'utf8') < 32) throw new Error('PA_JARVIS_IDENTITY_SECRET is not configured with sufficient entropy.');
  return value;
}

const nonceConsumer: NonceConsumer = {
  async consume(nonce, expiresAt) {
    const updated = await prisma.paIdentityNonce.updateMany({
      where: { nonce, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (updated.count === 1) return true;
    try {
      await prisma.paIdentityNonce.create({ data: { nonce, expiresAt, consumedAt: new Date() } });
      return true;
    } catch {
      return false;
    }
  },
};

export async function verifyPAHandshake(token: string) {
  return verifyPAIdentityProof(token, requirePAIdentitySecret(), nonceConsumer);
}

export async function createPADelegation(input: {
  ownerUserId: string;
  delegationId?: string;
  objective: string;
  capabilities: PADelegationCapability[];
  traceId?: string;
}) {
  const allowed = new Set(PA_DELEGATION_CAPABILITIES);
  if (!input.objective.trim()) throw new Error('Delegation objective is required.');
  if (input.capabilities.length === 0 || input.capabilities.some((item) => !allowed.has(item))) {
    throw new Error('Delegation capability is outside the PA allowlist.');
  }

  return prisma.$transaction(async (tx) => {
    const delegation = await tx.paDelegation.create({
      data: {
        id: input.delegationId || randomUUID(),
        ownerUserId: input.ownerUserId,
        objective: input.objective.trim(),
        requestedCapabilities: input.capabilities,
        status: 'queued',
        traceId: input.traceId || randomUUID(),
      },
    });
    const run = await tx.agentRun.create({
      data: {
        userId: input.ownerUserId,
        objective: input.objective.trim(),
        executionScope: { paDelegationId: delegation.id, capabilities: input.capabilities },
        traceContext: captureQueueTraceContextForStorage(),
        status: 'queued',
        approvalStatus: 'pending',
      },
    });
    await tx.paDelegation.update({ where: { id: delegation.id }, data: { agentRunId: run.id } });
    await tx.agentHandoff.createMany({ data: [
      { runId: run.id, fromAgent: 'pa', toAgent: 'jarvis', input: input.objective.trim(), status: 'pending' },
      { runId: run.id, fromAgent: 'jarvis', toAgent: 'primary', input: input.objective.trim(), status: 'pending' },
      { runId: run.id, fromAgent: 'jarvis', toAgent: 'secondary', input: input.objective.trim(), status: 'pending' },
      { runId: run.id, fromAgent: 'primary', toAgent: 'logic', input: 'Awaiting primary analysis', status: 'pending' },
      { runId: run.id, fromAgent: 'secondary', toAgent: 'logic', input: 'Awaiting secondary analysis', status: 'pending' },
    ] });
    await tx.jarvisAuditEvent.create({
      data: { actorId: 'ryanai-pa', eventType: 'pa.delegation.created', resourceId: delegation.id, details: { ownerUserId: input.ownerUserId, agentRunId: run.id, capabilities: input.capabilities } },
    });
    await appendRunEvidence(tx, {
      runId: run.id,
      eventType: 'pa.delegation.created',
      actorId: 'ryanai-pa',
      payload: { delegationId: delegation.id, capabilities: input.capabilities, traceId: delegation.traceId },
    });
    return { delegation, run };
  });
}

export async function createJarvisIdentityProof(ownerUserId: string, delegationId: string) {
  const now = Math.floor(Date.now() / 1000);
  return signAgentIdentityProof({
    version: 1,
    issuer: JARVIS_IDENTITY,
    subject: JARVIS_IDENTITY,
    audience: 'ryanai-pa',
    ownerUserId,
    delegationId,
    nonce: randomUUID(),
    issuedAt: now,
    expiresAt: now + 60,
    capabilities: [...PA_DELEGATION_CAPABILITIES],
  }, requirePAIdentitySecret());
}

export async function persistPAExecutionReceipt(input: { delegationId: string; agentRunId: string; traceId: string; attempt: number; status: string; result?: unknown; error?: string }) {
  return prisma.paExecutionReceipt.upsert({
    where: { delegationId: input.delegationId },
    create: {
      delegationId: input.delegationId,
      agentRunId: input.agentRunId,
      traceId: input.traceId,
      attempt: input.attempt,
      status: input.status,
      result: input.result as object | undefined,
      error: input.error,
    },
    update: {
      agentRunId: input.agentRunId,
      traceId: input.traceId,
      attempt: input.attempt,
      status: input.status,
      result: input.result as object | undefined,
      error: input.error,
    },
  });
}

export async function getPADelegation(ownerUserId: string, delegationId: string) {
  return prisma.paDelegation.findFirst({
    where: { id: delegationId, ownerUserId },
    include: {
      receipt: true,
      agentRun: {
        select: { id: true, status: true, attempts: true, result: true, error: true, createdAt: true, completedAt: true },
      },
    },
  });
}
