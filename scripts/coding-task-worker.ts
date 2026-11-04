import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { prisma } from '../src/lib/prisma.js';
import { createContainerSandboxRunner } from '../src/engineering/containerSandboxRunner.mjs';
import { runGenAICodeTask } from '../src/engineering/genaicodeAdapter.mjs';
import {
  createCodingTaskQueue,
  createWorkbenchTaskAuthorizer,
  startCodingTaskWorker,
} from '../src/engineering/codingTaskQueue.mjs';

const workspaceRootSetting = process.env.RYANAI_CODING_WORKSPACE_ROOT;
if (!workspaceRootSetting) {
  throw new Error('RYANAI_CODING_WORKSPACE_ROOT must point to a pre-provisioned coding workspace root.');
}
const workspaceRoot = await realpath(workspaceRootSetting);
const sandboxRunner = createContainerSandboxRunner();
const authorizeTask = createWorkbenchTaskAuthorizer(prisma);
const queue = createCodingTaskQueue(prisma, { stopContainer: sandboxRunner.stopContainer });

const stop = startCodingTaskWorker({
  queue,
  concurrency: Number(process.env.RYANAI_CODING_WORKER_CONCURRENCY || 1),
  leaseMs: Number(process.env.RYANAI_CODING_TASK_LEASE_MS || 60_000),
  executeTask: async (task, { signal }) => {
    const workspacePath = path.resolve(workspaceRoot, task.workspaceKey);
    const relative = path.relative(workspaceRoot, workspacePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Coding workspace key escaped the configured workspace root.');
    }
    return runGenAICodeTask({
      taskId: task.workbenchRunId,
      containerName: task.containerName,
      approvalId: task.approvalId,
      planHash: task.planHash,
      baseCommitSha: task.baseCommitSha,
      proposedDiffHash: task.proposedDiffHash,
      agent: task.agent,
      prompt: task.prompt,
      workspaceRoot,
      workspacePath,
      signal,
    }, { authorizeTask, sandboxRunner });
  },
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stop();
  await prisma.$disconnect();
}
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
process.once('beforeExit', () => { void shutdown(); });
