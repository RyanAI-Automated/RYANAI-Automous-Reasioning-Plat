import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addressOwnerMessage,
  communicationSystemInstruction,
  getOwnerGreeting,
  getOwnerTitle,
} from './personalization.js';

afterEach(() => vi.unstubAllEnvs());

describe('RyanAI owner communication personalization', () => {
  it('defaults to the respectful Sir title', () => {
    vi.stubEnv('RYANAI_OWNER_TITLE', '');
    expect(getOwnerTitle()).toBe('Sir');
    expect(addressOwnerMessage('Your report is ready.')).toBe('Sir, Your report is ready.');
  });

  it('respects an explicitly configured owner title without duplicating it', () => {
    vi.stubEnv('RYANAI_OWNER_TITLE', 'Captain');
    expect(getOwnerTitle()).toBe('Captain');
    expect(addressOwnerMessage('Captain, the task is complete.')).toBe('Captain, the task is complete.');
  });

  it('sets South African English as the spoken and written communication standard', () => {
    vi.stubEnv('RYANAI_OWNER_TITLE', 'Sir');
    expect(communicationSystemInstruction()).toContain('English - South Africa');
    expect(communicationSystemInstruction()).toContain('Sir');
    expect(getOwnerGreeting()).toContain('Sir. This is RyanAI.');
  });
});
