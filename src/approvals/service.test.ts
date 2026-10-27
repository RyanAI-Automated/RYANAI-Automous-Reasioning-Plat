import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decideAction, type DecisionDeps } from './service.js';

const claim = vi.fn();
const finish = vi.fn();
const dispatch = vi.fn();
const deps = { claim, finish, dispatch } as unknown as DecisionDeps;

const email = { to: 'ada@example.com', subject: 'Hello', html: '<p>Hi</p>' };
const row = { id: 'a1', tool: 'send_email', args: email };

beforeEach(() => {
  claim.mockReset();
  finish.mockReset();
  dispatch.mockReset();
  finish.mockResolvedValue(undefined);
});

describe('decideAction', () => {
  it('reports not_found and sends nothing when the claim fails', async () => {
    claim.mockResolvedValue(null);
    expect(await decideAction('a1', 'admin-1', true, deps)).toEqual({ outcome: 'not_found' });
    expect(dispatch).toHaveBeenCalledTimes(0);
    expect(finish).toHaveBeenCalledTimes(0);
  });

  it('rejects without sending', async () => {
    claim.mockResolvedValue(row);
    expect(await decideAction('a1', 'admin-1', false, deps)).toEqual({ outcome: 'rejected' });
    expect(claim).toHaveBeenCalledWith('a1', 'admin-1', 'rejected');
    expect(dispatch).toHaveBeenCalledTimes(0);
  });

  it('sends an approved action once and records the result', async () => {
    claim.mockResolvedValue(row);
    dispatch.mockResolvedValue('Email sent.');
    expect(await decideAction('a1', 'admin-1', true, deps)).toEqual({
      outcome: 'executed',
      result: 'Email sent.',
    });
    expect(claim).toHaveBeenCalledWith('a1', 'admin-1', 'approved');
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith('send_email', email);
    expect(finish).toHaveBeenCalledWith('a1', { result: 'Email sent.' });
  });

  it('records a failed send and reports the error', async () => {
    claim.mockResolvedValue(row);
    dispatch.mockRejectedValue(new Error('SMTP is not configured on this server.'));
    expect(await decideAction('a1', 'admin-1', true, deps)).toEqual({
      outcome: 'failed',
      error: 'SMTP is not configured on this server.',
    });
    expect(finish).toHaveBeenCalledWith('a1', { error: 'SMTP is not configured on this server.' });
  });

  it('refuses a saved row with an unknown tool or changed arguments', async () => {
    claim.mockResolvedValue({ id: 'a1', tool: 'write_workspace_file', args: {} });
    expect((await decideAction('a1', 'admin-1', true, deps)).outcome).toBe('failed');

    claim.mockResolvedValue({ id: 'a1', tool: 'send_email', args: { ...email, to: 'a@b.com, c@d.com' } });
    expect((await decideAction('a1', 'admin-1', true, deps)).outcome).toBe('failed');
    expect(dispatch).toHaveBeenCalledTimes(0);
  });

  it('still reports a sent message when the outcome cannot be recorded', async () => {
    claim.mockResolvedValue(row);
    dispatch.mockResolvedValue('Email sent.');
    finish.mockRejectedValue(new Error('database is down'));
    const silent = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await decideAction('a1', 'admin-1', true, deps)).toEqual({
      outcome: 'executed',
      result: 'Email sent.',
    });
    silent.mockRestore();
  });
});
