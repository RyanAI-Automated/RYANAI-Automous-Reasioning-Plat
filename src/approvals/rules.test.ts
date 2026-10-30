import { describe, expect, it } from 'vitest';
import {
  ACTION_TTL_MS,
  escapeXml,
  expiryFrom,
  isActionTool,
  parseActionArgs,
  previewResult,
  summarizeAction,
} from './rules.js';

describe('isActionTool', () => {
  it('accepts the three outbound tools and nothing else', () => {
    expect(isActionTool('send_email')).toBe(true);
    expect(isActionTool('send_whatsapp_message')).toBe(true);
    expect(isActionTool('send_sms_message')).toBe(true);
    expect(isActionTool('make_voice_call')).toBe(true);
    expect(isActionTool('write_workspace_file')).toBe(false);
    expect(isActionTool(undefined)).toBe(false);
  });
});

describe('parseActionArgs for email', () => {
  const good = { to: 'ada@example.com', subject: 'Hello', html: '<p>Hi</p>' };

  it('returns a clean copy and drops unknown fields', () => {
    expect(parseActionArgs('send_email', { ...good, bcc: 'x@example.com' })).toEqual(good);
  });

  it('refuses a recipient that is not one email address', () => {
    for (const to of [
      'not-an-address',
      'a@b.com, c@d.com',
      'a@b.com;c@d.com',
      'Ada <a@b.com>',
      // A comma or semicolon before the one "@" can make a mail library see two recipients.
      'x,y@example.com',
      'x;y@example.com',
    ]) {
      expect(() => parseActionArgs('send_email', { ...good, to })).toThrow(/email address/);
    }
  });

  it('refuses a subject with a line break', () => {
    expect(() => parseActionArgs('send_email', { ...good, subject: 'a\r\nBcc: x@y.com' })).toThrow(
      /one line/,
    );
  });

  it('refuses missing, empty or too long text', () => {
    expect(() => parseActionArgs('send_email', { to: good.to, subject: 'x' })).toThrow(/html/);
    expect(() => parseActionArgs('send_email', { ...good, html: '   ' })).toThrow(/html/);
    expect(() => parseActionArgs('send_email', { ...good, subject: 'x'.repeat(201) })).toThrow(
      /too long/,
    );
  });

  it('refuses arguments that are not an object', () => {
    expect(() => parseActionArgs('send_email', null)).toThrow(/object/);
    expect(() => parseActionArgs('send_email', 'to=a@b.com')).toThrow(/object/);
    expect(() => parseActionArgs('send_email', [good])).toThrow(/object/);
  });
});

describe('parseActionArgs for phone numbers', () => {
  it('removes spaces, dots, dashes and brackets from the number', () => {
    expect(
      parseActionArgs('send_whatsapp_message', { to: '+1 (234) 567-890', message: 'Hi' }),
    ).toEqual({ to: '+1234567890', message: 'Hi' });
  });

  it('parses and summarizes SMS actions', () => {
    expect(parseActionArgs('send_sms_message', { to: '+27 71 809 5084', message: 'Alert' })).toEqual({
      to: '+27718095084', message: 'Alert',
    });
    expect(summarizeAction('send_sms_message', { to: '+27718095084', message: 'Alert' })).toBe(
      'SMS to +27718095084: "Alert"',
    );
  });

  it('refuses a number without the international prefix or with a bad length', () => {
    for (const to of ['0123456789', '1234567890', '+0123456789', '+12345', '+1234567890123456']) {
      expect(() => parseActionArgs('make_voice_call', { to, twimlMessage: 'Hi' })).toThrow(
        /international format/,
      );
    }
  });

  it('limits the spoken text of a call and the length of a message', () => {
    expect(() =>
      parseActionArgs('make_voice_call', { to: '+1234567890', twimlMessage: 'x'.repeat(501) }),
    ).toThrow(/too long/);
    expect(() =>
      parseActionArgs('send_whatsapp_message', { to: '+1234567890', message: 'x'.repeat(1601) }),
    ).toThrow(/too long/);
  });
});

describe('summarizeAction', () => {
  it('describes each action on one line', () => {
    expect(summarizeAction('send_email', { to: 'a@b.com', subject: 'Hi', html: '<p>x</p>' })).toBe(
      'Email to a@b.com: "Hi"',
    );
    expect(summarizeAction('send_whatsapp_message', { to: '+1234567890', message: 'Hi' })).toBe(
      'WhatsApp message to +1234567890: "Hi"',
    );
    expect(summarizeAction('make_voice_call', { to: '+1234567890', twimlMessage: 'Hi' })).toBe(
      'Voice call to +1234567890: "Hi"',
    );
  });

  it('flattens line breaks and cuts long text', () => {
    const text = summarizeAction('send_whatsapp_message', {
      to: '+1234567890',
      message: `first line\nsecond line ${'x'.repeat(200)}`,
    });
    expect(text).not.toContain('\n');
    expect(text.length).toBeLessThan(140);
    expect(text.endsWith('…"')).toBe(true);
  });
});

describe('escapeXml', () => {
  it('escapes the characters that can close a TwiML element', () => {
    expect(escapeXml(`</Say><Dial>+1</Dial> & "x" 'y'`)).toBe(
      '&lt;/Say&gt;&lt;Dial&gt;+1&lt;/Dial&gt; &amp; &quot;x&quot; &apos;y&apos;',
    );
  });
});

describe('expiryFrom and previewResult', () => {
  it('sets the expiry 24 hours after the request', () => {
    const now = new Date('2026-10-27T10:00:00Z');
    expect(expiryFrom(now).toISOString()).toBe('2026-10-28T10:00:00.000Z');
    expect(ACTION_TTL_MS).toBe(86_400_000);
  });

  it('cuts long provider output', () => {
    expect(previewResult('ok')).toBe('ok');
    expect(previewResult('x'.repeat(900)).length).toBe(500);
  });
});
