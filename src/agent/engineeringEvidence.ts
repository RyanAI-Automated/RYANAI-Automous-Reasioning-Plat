import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export interface EvidenceEventInput {
  runId: string;
  eventType: string;
  actorId?: string | null;
  payload: Record<string, unknown>;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const record = value as Record<string, unknown>;
  return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + canonical(record[key])).join(',') + '}';
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Append a hash-chained event while serializing concurrent writers on the owning job row. */
export async function appendRunEvidence(tx: Prisma.TransactionClient, input: EvidenceEventInput) {
  await tx.$queryRaw`SELECT id FROM public.agent_runs WHERE id = ${input.runId} FOR UPDATE`;
  const previous = await tx.agentRunEvidence.findFirst({
    where: { runId: input.runId },
    orderBy: { sequence: 'desc' },
    select: { sequence: true, hash: true },
  });
  const sequence = (previous?.sequence ?? 0) + 1;
  const payload = JSON.parse(canonical(input.payload)) as Prisma.InputJsonValue;
  const hashMaterial = [
    input.runId,
    String(sequence),
    input.eventType,
    input.actorId ?? '',
    previous?.hash ?? '',
    canonical(payload),
  ].join('\n');
  return tx.agentRunEvidence.create({
    data: {
      id: randomUUID(),
      runId: input.runId,
      sequence,
      eventType: input.eventType,
      actorId: input.actorId ?? null,
      payload,
      previousHash: previous?.hash ?? null,
      hash: sha256(hashMaterial),
    },
  });
}

export async function recordRunEvidence(input: EvidenceEventInput) {
  return prisma.$transaction((tx) => appendRunEvidence(tx, input));
}

export interface EvidenceChainCheck {
  valid: boolean;
  eventCount: number;
  firstInvalidSequence: number | null;
  finalHash: string | null;
}

export function verifyEvidenceChain(events: Array<{
  runId: string; sequence: number; eventType: string; actorId: string | null;
  payload: unknown; previousHash: string | null; hash: string;
}>): EvidenceChainCheck {
  let previousHash: string | null = null;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const expectedSequence = index + 1;
    const material = [
      event.runId,
      String(event.sequence),
      event.eventType,
      event.actorId ?? '',
      previousHash ?? '',
      canonical(event.payload),
    ].join('\n');
    if (event.sequence !== expectedSequence || event.previousHash !== previousHash || event.hash !== sha256(material)) {
      return { valid: false, eventCount: events.length, firstInvalidSequence: event.sequence, finalHash: previousHash };
    }
    previousHash = event.hash;
  }
  return { valid: true, eventCount: events.length, firstInvalidSequence: null, finalHash: previousHash };
}

export async function buildEvidenceBundle(runId: string) {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    include: {
      handoffs: { orderBy: { startedAt: 'asc' } },
      evidence: { orderBy: { sequence: 'asc' } },
    },
  });
  if (!run) return null;
  const chain = verifyEvidenceChain(run.evidence);
  const latestChecks = new Map<string, Record<string, unknown>>();
  const evaluationReceipts: unknown[] = [];
  const assuranceReceipts: unknown[] = [];
  for (const event of run.evidence) {
    const payload = event.payload && typeof event.payload === 'object' ? event.payload as Record<string, unknown> : {};
    if (event.eventType === 'verification.check' && typeof payload.name === 'string') latestChecks.set(payload.name, payload);
    if (event.eventType === 'evaluation.receipt') evaluationReceipts.push(event);
    if (event.eventType === 'assurance.receipt') assuranceReceipts.push(event);
  }
  const verificationChecks = latestChecks.size
    ? [...latestChecks.values()]
    : [{ name: 'CI / automated verification', status: 'unverified', source: 'No verification receipt recorded' }];
  const latestEvaluation = evaluationReceipts.at(-1) as { payload?: { outcome?: string } } | undefined;
  const latestAssurance = assuranceReceipts.at(-1) as { payload?: { outcome?: string } } | undefined;
  const allChecksPassed = verificationChecks.length > 0 && verificationChecks.every((check) => check.status === 'pass');
  const accepted = run.status === 'completed' && chain.valid && allChecksPassed
    && latestEvaluation?.payload?.outcome === 'pass'
    && latestAssurance?.payload?.outcome === 'pass';
  const bundle = {
    format: 'ryanai-engineering-evidence/v1',
    generatedAt: new Date().toISOString(),
    run: {
      id: run.id,
      userId: run.userId,
      objective: run.objective,
      status: run.status,
      approvalStatus: run.approvalStatus,
      planHash: run.planHash,
      baseCommitSha: run.baseCommitSha,
      proposedDiffHash: run.proposedDiffHash,
      approvedPlanHash: run.approvedPlanHash,
      approvedCommitSha: run.approvedCommitSha,
      approvedDiffHash: run.approvedDiffHash,
      approvedBy: run.approvedBy,
      approvedAt: run.approvedAt,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      result: run.result,
      error: run.error,
    },
    handoffs: run.handoffs,
    evidence: run.evidence,
    verificationChecks,
    evaluationReceipts,
    assuranceReceipts,
    acceptance: { accepted, status: accepted ? 'accepted' : 'not_accepted', reason: accepted ? 'Execution, verification, independent evaluation and assurance receipts are all present and valid.' : 'At least one required execution, verification, integrity, independent evaluation or assurance gate is missing or non-passing.' },
    integrity: chain,
  };
  const serialized = JSON.stringify(bundle, null, 2);
  return { bundle, sha256: sha256(serialized), integrity: chain };
}
