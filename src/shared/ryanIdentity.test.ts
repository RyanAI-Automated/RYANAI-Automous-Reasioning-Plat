import { describe, expect, it } from 'vitest';
import {
  addressOwnerResponse,
  createLoginGreeting,
  getAddress,
  getTimeGreeting,
  RYANAI_LOCALE,
  RYANAI_TIME_ZONE,
} from './ryanIdentity.js';

describe('RyanAI identity and South African English defaults', () => {
  it('uses Sir for the configured owner identity', () => {
    expect(getAddress({ isOwner: true, displayName: 'Ntsiyeni' })).toBe('Sir');
  });

  it('uses a verified display name for other users', () => {
    expect(getAddress({ displayName: 'Alex Mokoena' })).toBe('Alex Mokoena');
  });

  it('falls back to the email local part when no display name exists', () => {
    expect(getAddress({ email: 'alex@example.test' })).toBe('alex');
  });

  it('uses South African locale and timezone defaults', () => {
    expect(RYANAI_LOCALE).toBe('en-ZA');
    expect(RYANAI_TIME_ZONE).toBe('Africa/Johannesburg');
  });

  it('creates a login greeting addressed to the user', () => {
    expect(createLoginGreeting(
      { isOwner: true },
      new Date('2026-10-30T06:00:00.000Z'),
    )).toBe("Good morning, Sir. I'm RyanAI. Your assistant is ready.");
  });

  it('addresses owner communications once without duplicating Sir', () => {
    expect(addressOwnerResponse('Your systems are ready.')).toBe('Certainly, Sir. Your systems are ready.');
    expect(addressOwnerResponse('Certainly, Sir. Your systems are ready.')).toBe('Certainly, Sir. Your systems are ready.');
  });
});
