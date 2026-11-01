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

/** Persist worker output atomically under the original worker/attempt lease fence. */
export async function persistAgentRunCompletion(
  tx: Prisma.TransactionClient,
  run: PersistableAgentRun,
  handoffs: PersistableHandoff[],
  plan: { outputs: BrainOutput[]; synthesis: string },
): Promise<void> {
  const outputByBrain = new Map(plan.outputs.map((item) => [item.brain, item]));
  for (const row of handoffs) {
    const output = row.toAgent === 'primary'
      ? outputByBrain.get('primary')
      : row.toAgent === 'secondary'
        ? outputByBrain.get('secondary')
        : outputByBrain.get(row.fromAgent as 'primary' | 'secondary');
    if (!output) throw new Error('Missing verified output for handoff ' + row.id);
    await tx.agentHandoff.update({
      where: { id: row.id },
      data: {
        status: 'completed',
        output: row.toAgent === 'logic' ? plan.synthesis : output.output,
        input: row.toAgent === 'logic' ? output.output : row.input,
        completedAt: new Date(),
      },
    });
  }
  await tx.memoryVault.create({
    data: {
      userId: run.user_id,
      title: 'Autonomous task ' + run.id,
      content: 'Objective:\n' + run.objective + '\n\nResult:\n' + plan.synthesis,
      category: 'agent-task',
      tags: ['agent-run', 'autonomous'],
    },
  });
  const completion = await tx.agentRun.updateMany({
    where: { id: run.id, status: 'running', workerId: run.worker_id, attempts: run.attempts },
    data: {
      status: 'completed',
      result: { synthesis: plan.synthesis, brains: plan.outputs.map(({ brain, latencyMs }) => ({ brain, latencyMs })) },
      completedAt: new Date(),
      lockedAt: null,
      workerId: null,
    },
  });
  if (completion.count !== 1) {
    throw new Error('Agent run lease was lost before completion; stale worker result was discarded.');
  }
}
