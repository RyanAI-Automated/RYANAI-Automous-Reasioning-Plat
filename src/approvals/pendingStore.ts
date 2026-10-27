import {
  MAX_PENDING_PER_USER,
  expiryFrom,
  previewResult,
  summarizeAction,
  type ActionArgs,
  type ActionTool,
} from './rules.js';

const LIST_LIMIT = 50;

/** Load the Prisma client on first use, so importing this file creates no database client. */
async function getPrisma() {
  const { prisma } = await import('../lib/prisma.js');
  return prisma;
}

/**
 * Queue an action for approval.
 * shortcut: the limit check and the insert are two statements, so two parallel
 * requests can pass the limit by one or two actions. Use a conditional insert if
 * the limit must be exact.
 */
export async function createPendingAction(
  userId: string,
  tool: ActionTool,
  args: ActionArgs,
  now = new Date(),
) {
  const prisma = await getPrisma();
  const open = await prisma.pendingAction.count({
    where: { userId, status: 'pending', expiresAt: { gt: now } },
  });
  if (open >= MAX_PENDING_PER_USER) {
    throw new Error(
      `${MAX_PENDING_PER_USER} actions already wait for approval. An administrator must decide them first.`,
    );
  }
  return prisma.pendingAction.create({
    data: {
      userId,
      tool,
      args,
      summary: summarizeAction(tool, args),
      expiresAt: expiryFrom(now),
    },
    select: { id: true, summary: true, expiresAt: true },
  });
}

/** The actions that still wait for a decision, oldest first. */
export async function listOpenActions(now = new Date()) {
  const prisma = await getPrisma();
  return prisma.pendingAction.findMany({
    where: { status: 'pending', expiresAt: { gt: now } },
    orderBy: { createdAt: 'asc' },
    take: LIST_LIMIT,
    select: {
      id: true,
      userId: true,
      tool: true,
      args: true,
      summary: true,
      createdAt: true,
      expiresAt: true,
    },
  });
}

/**
 * Decide an action with one conditional update. It returns the action, or null
 * when the action is not pending any more, has expired, or does not exist.
 */
export async function claimAction(
  id: string,
  adminId: string,
  decision: 'approved' | 'rejected',
  now = new Date(),
) {
  const prisma = await getPrisma();
  const { count } = await prisma.pendingAction.updateMany({
    where: { id, status: 'pending', expiresAt: { gt: now } },
    data: { status: decision, decidedAt: now, decidedBy: adminId },
  });
  if (count !== 1) return null;
  return prisma.pendingAction.findUnique({
    where: { id },
    select: { id: true, tool: true, args: true },
  });
}

/** Record how an approved action ended. It only changes a row that is still "approved". */
export async function finishAction(id: string, outcome: { result: string } | { error: string }) {
  const prisma = await getPrisma();
  await prisma.pendingAction.updateMany({
    where: { id, status: 'approved' },
    data:
      'error' in outcome
        ? { status: 'failed', result: previewResult(outcome.error) }
        : { status: 'executed', result: previewResult(outcome.result) },
  });
}
