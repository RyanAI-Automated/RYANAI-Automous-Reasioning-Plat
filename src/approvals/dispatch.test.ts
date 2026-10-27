import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createMessage: vi.fn(),
  createCall: vi.fn(),
  sendMail: vi.fn(),
  createTransport: vi.fn(),
}));
vi.mock('twilio', () => ({
  default: vi.fn(() => ({
    messages: { create: mocks.createMessage },
    calls: { create: mocks.createCall },
  })),
}));
vi.mock('nodemailer', () => ({ default: { createTransport: mocks.createTransport } }));

import { dispatchAction } from './dispatch.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail });
});
afterEach(() => vi.unstubAllEnvs());

function configure() {
  vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC-test');
  vi.stubEnv('TWILIO_AUTH_TOKEN', 'token-test');
  vi.stubEnv('TWILIO_WHATSAPP_NUMBER', '+14155550100');
  vi.stubEnv('TWILIO_PHONE_NUMBER', '+14155550101');
  vi.stubEnv('SMTP_USER', 'bot@example.com');
  vi.stubEnv('SMTP_PASS', 'pass-test');
  vi.stubEnv('SMTP_FROM', '');
}

describe('dispatchAction', () => {
  it('sends an email from the SMTP user when SMTP_FROM is not set', async () => {
    configure();
    mocks.sendMail.mockResolvedValue({ messageId: '<m1>' });
    const text = await dispatchAction('send_email', {
      to: 'ada@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
    });
    expect(mocks.sendMail).toHaveBeenCalledWith({
      from: 'bot@example.com',
      to: 'ada@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
    });
    expect(text).toContain('<m1>');
  });

  it('adds the whatsapp: prefix to both numbers', async () => {
    configure();
    mocks.createMessage.mockResolvedValue({ sid: 'SM1' });
    await dispatchAction('send_whatsapp_message', { to: '+1234567890', message: 'Hi' });
    expect(mocks.createMessage).toHaveBeenCalledWith({
      from: 'whatsapp:+14155550100',
      to: 'whatsapp:+1234567890',
      body: 'Hi',
    });
  });

  it('escapes the spoken text so that it cannot add TwiML elements', async () => {
    configure();
    mocks.createCall.mockResolvedValue({ sid: 'CA1' });
    await dispatchAction('make_voice_call', {
      to: '+1234567890',
      twimlMessage: '</Say><Dial>+19995550123</Dial><Say>',
    });
    const { twiml } = mocks.createCall.mock.calls[0][0];
    expect(twiml).toBe(
      '<Response><Say>&lt;/Say&gt;&lt;Dial&gt;+19995550123&lt;/Dial&gt;&lt;Say&gt;</Say></Response>',
    );
  });

  it('fails with a clear message when a channel is not configured', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', '');
    vi.stubEnv('TWILIO_AUTH_TOKEN', '');
    vi.stubEnv('TWILIO_WHATSAPP_NUMBER', '+14155550100');
    vi.stubEnv('SMTP_USER', '');
    vi.stubEnv('SMTP_PASS', '');
    await expect(
      dispatchAction('send_whatsapp_message', { to: '+1234567890', message: 'Hi' }),
    ).rejects.toThrow(/Twilio is not configured/);
    await expect(
      dispatchAction('send_email', { to: 'ada@example.com', subject: 'Hi', html: 'x' }),
    ).rejects.toThrow(/SMTP is not configured/);
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });
});
