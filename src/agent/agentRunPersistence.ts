import { createHash } from 'node:crypto';
import type { ExecutionPlan } from './executionPlanner.js';
import { appendRunEvidence } from './engineeringEvidence.js';
import type { Prisma } from '@prisma/client';
import type { BrainOutput } from './operationsCore.js';

interface PersistableAgentRun {
  id: string;
  user_id: string;
  objective: string;
  attempts: number;
  worker_id: string;
}
interface PersistableHandoff {
  id: string;
  fromAgent: string;
  toAgent: string;
  input: string;
}

/** Persist actual provider outputs atomically; unavailable brains remain failed rather than being fabricated. */
export async function persistAgentRunCompletion(
  tx: Prisma.TransactionClient,
  run: PersistableAgentRun,
  handoffs: PersistableHandoff[],
  plan: { outputs: BrainOutput[]; synthesis: string; degraded: boolean },
  executionPlan: ExecutionPlan,
): Promise<void> {
  const outputByBrain = new Map(plan.outputs.map((item) => [item.brain, item]));
  for (const row of handoffs) {
    const output = row.toAgent === 'primary'
      ? outputByBrain.get('primary')
      : row.toAgent === 'secondary'
        ? outputByBrain.get('secondary')
        : outputByBrain.get(row.fromAgent as 'primary' | 'secondary');
    const logicOutput = outputByBrain.get('logic');
    if (!output || (row.toAgent === 'logic' && !logicOutput)) {
      await tx.agentHandoff.update({
        where: { id: row.id },
        data: { status: 'failed', error: 'Required brain unavailable; no output or consensus was fabricated.', completedAt: new Date() },
      });
      continue;
    }
    await tx.agentHandoff.update({
      where: { id: row.id },
      data: {
        status: 'completed',
        output: row.toAgent === 'logic' ? plan.synthesis : output.output,
        input: row.toAgent === 'logic' ? output.output : row.input,
        error: null,
        completedAt: new Date(),
      },
    });
  }
  await tx.memoryVault.create({
    data: {
      userId: run.user_id,
      title: 'Autonomous task ' + run.id,
      content: 'Objective:\n' + run.objective + '\n\nExecution plan:\n' + JSON.stringify(executionPlan) + '\n\nResult:\n' + plan.synthesis,
      category: 'agent-task',
      tags: ['agent-run', 'autonomous', ...(plan.degraded ? ['degraded'] : [])],
    },
  });
  const completion = await tx.agentRun.updateMany({
    where: { id: run.id, status: 'running', workerId: run.worker_id, attempts: run.attempts, cancelRequestedAt: null },
    data: {
      status: 'completed',
      result: { synthesis: plan.synthesis, degraded: plan.degraded, executionPlan, brains: plan.outputs.map(({ brain, latencyMs }) => ({ brain, latencyMs })) },
      completedAt: new Date(),
      lockedAt: null,
      workerId: null,
    },
  });
  if (completion.count !== 1) throw new Error('Agent run lease was lost before completion; stale worker result was discarded.');
  await appendRunEvidence(tx, {
    runId: run.id,
    eventType: 'execution.completed',
    payload: {
      attempt: run.attempts,
      degraded: plan.degraded,
      executionPlan,
      brains: plan.outputs.map(({ brain, latencyMs }) => ({ brain, latencyMs })),
      synthesisSha256: createHash('sha256').update(plan.synthesis, 'utf8').digest('hex'),
      verificationStatus: 'unverified',
    },
  });
}
