import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyOwner } from './notify.js';

const fetcher = vi.fn();
const dispatch = vi.fn();
const deps = {
  fetcher: fetcher as unknown as typeof fetch,
  dispatch: dispatch as unknown as typeof import('../approvals/dispatch.js').dispatchAction,
};
const all = {
  slackWebhookUrl: 'https://hooks.example/abc',
  email: 'owner@example.com',
  whatsappTo: '+1234567890',
};

beforeEach(() => {
  fetcher.mockReset();
  dispatch.mockReset();
  fetcher.mockResolvedValue({ ok: true, status: 200 });
  dispatch.mockResolvedValue('sent');
});

describe('notifyOwner', () => {
  it('sends to every channel that has a destination', async () => {
    const outcomes = await notifyOwner('DOWN: API\nHTTP 503', all, deps);
    expect(outcomes).toEqual([
      { channel: 'slack', ok: true },
      { channel: 'email', ok: true },
      { channel: 'whatsapp', ok: true },
    ]);
    expect(fetcher.mock.calls[0][0]).toBe('https://hooks.example/abc');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ text: 'DOWN: API\nHTTP 503' });
  });

  it('puts the headline in the email subject and escapes the body', async () => {
    await notifyOwner('DOWN: API <b>\nHTTP 503', { email: 'owner@example.com' }, deps);
    const [tool, args] = dispatch.mock.calls[0];
    expect(tool).toBe('send_email');
    expect(args.subject).toBe('[RyanAI alert] DOWN: API <b>');
    expect(args.subject).not.toContain('\n');
    expect(args.html).toContain('&lt;b&gt;');
    expect(args.html).not.toContain('<b>');
  });

  it('cuts a long message for WhatsApp', async () => {
    await notifyOwner('x'.repeat(3000), { whatsappTo: '+1234567890' }, deps);
    expect(dispatch.mock.calls[0][1].message.length).toBe(1500);
  });

  it('does nothing when no channel has a destination', async () => {
    expect(await notifyOwner('DOWN: API', {}, deps)).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(0);
    expect(dispatch).toHaveBeenCalledTimes(0);
  });

  it('keeps the other channels going when one fails, and reports the reason', async () => {
    dispatch.mockImplementation(async (tool: string) => {
      if (tool === 'send_email') throw new Error('SMTP is not configured on this server.');
      return 'sent';
    });
    const outcomes = await notifyOwner('DOWN: API', all, deps);
    expect(outcomes).toEqual([
      { channel: 'slack', ok: true },
      { channel: 'email', ok: false, error: 'SMTP is not configured on this server.' },
      { channel: 'whatsapp', ok: true },
    ]);
  });

  it('reports a Slack error status as a failed channel', async () => {
    fetcher.mockResolvedValue({ ok: false, status: 404 });
    expect(await notifyOwner('DOWN: API', { slackWebhookUrl: 'https://hooks.example/abc' }, deps)).toEqual([
      { channel: 'slack', ok: false, error: 'Slack answered HTTP 404.' },
    ]);
  });

  it('turns a bad recipient into a failed channel, not a thrown error', async () => {
    const outcomes = await notifyOwner('DOWN: API', { email: 'not-an-address', whatsappTo: '12345' }, deps);
    expect(outcomes.map((outcome) => outcome.ok)).toEqual([false, false]);
    expect(dispatch).toHaveBeenCalledTimes(0);
  });
});
