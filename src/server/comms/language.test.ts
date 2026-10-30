import { afterEach, describe, expect, it, vi } from 'vitest';
import { communicationSystemInstruction, getOwnerLanguage, getOwnerTitle, getTwilioVoiceLanguage } from './language.js';

afterEach(() => vi.unstubAllEnvs());

describe('owner communication language settings', () => {
  it('defaults to Sir G and South African English text', () => {
    vi.stubEnv('RYANAI_OWNER_TITLE', '');
    vi.stubEnv('RYANAI_OWNER_LANGUAGE', '');
    expect(getOwnerTitle()).toBe('Sir G');
    expect(getOwnerLanguage()).toBe('en-ZA');
    expect(communicationSystemInstruction()).toContain('English (South Africa)');
  });
  it('supports Tshivenda for owner-facing text responses', () => {
    vi.stubEnv('RYANAI_OWNER_LANGUAGE', 've-ZA');
    expect(getOwnerLanguage()).toBe('ve-ZA');
    expect(communicationSystemInstruction()).toContain('Tshivenda (Venda)');
  });
  it('falls back safely for unknown language tags', () => {
    vi.stubEnv('RYANAI_OWNER_LANGUAGE', 'xx-XX');
    expect(getOwnerLanguage()).toBe('en-ZA');
  });
  it('keeps telephony language independently configurable', () => {
    vi.stubEnv('RYANAI_TWILIO_LANGUAGE', 'en-ZA');
    expect(getTwilioVoiceLanguage()).toBe('en-ZA');
  });
});
