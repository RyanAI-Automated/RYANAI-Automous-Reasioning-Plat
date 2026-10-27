import { beforeEach, describe, expect, it, vi } from 'vitest';

const pendingAction = vi.hoisted(() => ({
  count: vi.fn(),
  create: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}));
vi.mock('../lib/prisma.js', () => ({ prisma: { pendingAction } }));

import { MAX_PENDING_PER_USER } from './rules.js';
import { claimAction, createPendingAction, finishAction, listOpenActions } from './pendingStore.js';

const now = new Date('2026-10-27T10:00:00Z');
const email = { to: 'ada@example.com', subject: 'Hello', html: '<p>Hi</p>' };

beforeEach(() => vi.clearAllMocks());

describe('createPendingAction', () => {
  it('stops at the limit of open actions and creates nothing', async () => {
    pendingAction.count.mockResolvedValue(MAX_PENDING_PER_USER);
    await expect(createPendingAction('user-1', 'send_email', email, now)).rejects.toThrow(
      /wait for approval/,
    );
    expect(pendingAction.create).not.toHaveBeenCalled();
  });

  it('counts only open actions of the user and saves a summary and an expiry', async () => {
    pendingAction.count.mockResolvedValue(0);
    pendingAction.create.mockResolvedValue({ id: 'a1' });
    await createPendingAction('user-1', 'send_email', email, now);
    expect(pendingAction.count).toHaveBeenCalledWith({
      where: { userId: 'user-1', status: 'pending', expiresAt: { gt: now } },
    });
    expect(pendingAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          userId: 'user-1',
          tool: 'send_email',
          args: email,
          summary: 'Email to ada@example.com: "Hello"',
          expiresAt: new Date('2026-10-28T10:00:00Z'),
        },
      }),
    );
  });
});

describe('listOpenActions', () => {
  it('lists only pending actions that have not expired, oldest first', async () => {
    pendingAction.findMany.mockResolvedValue([]);
    await listOpenActions(now);
    expect(pendingAction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'pending', expiresAt: { gt: now } },
        orderBy: { createdAt: 'asc' },
      }),
    );
  });
});

describe('claimAction', () => {
  it('decides only a pending action that has not expired', async () => {
    pendingAction.updateMany.mockResolvedValue({ count: 1 });
    pendingAction.findUnique.mockResolvedValue({ id: 'a1', tool: 'send_email', args: email });
    const action = await claimAction('a1', 'admin-1', 'approved', now);
    expect(pendingAction.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', status: 'pending', expiresAt: { gt: now } },
      data: { status: 'approved', decidedAt: now, decidedBy: 'admin-1' },
    });
    expect(action).toEqual({ id: 'a1', tool: 'send_email', args: email });
  });

  it('returns null and reads nothing when the update changes no row', async () => {
    pendingAction.updateMany.mockResolvedValue({ count: 0 });
    expect(await claimAction('a1', 'admin-1', 'approved', now)).toBeNull();
    expect(pendingAction.findUnique).not.toHaveBeenCalled();
  });
});

describe('finishAction', () => {
  it('changes only a row that is still approved', async () => {
    pendingAction.updateMany.mockResolvedValue({ count: 1 });
    await finishAction('a1', { result: 'Email sent.' });
    expect(pendingAction.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', status: 'approved' },
      data: { status: 'executed', result: 'Email sent.' },
    });
    await finishAction('a1', { error: 'SMTP is not configured on this server.' });
    expect(pendingAction.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'a1', status: 'approved' },
      data: { status: 'failed', result: 'SMTP is not configured on this server.' },
    });
  });
});
