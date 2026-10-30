import { describe, expect, it } from 'vitest';
import { addressOwnerResponse, createLoginGreeting, getAddress, resolveCommunicationLanguage } from './ryanIdentity.js';
import { DEFAULT_RYANAI_LANGUAGE, OWNER_VENDA_LANGUAGE, RYANAI_LANGUAGES } from './languages.js';

describe('RyanAI identity and multilingual language defaults', () => {
  it('uses the Sir G owner title and full configured display name', () => {
    expect(getAddress({ isOwner: true })).toBe('Sir G');
    expect(createLoginGreeting({ isOwner: true, preferredTitle: 'Sir G' }, new Date('2026-10-30T06:00:00Z')))
      .toBe("Good morning, Sir G. I'm RyanAI. Your assistant is ready.");
  });
  it('uses a display name for other users', () => {
    expect(getAddress({ displayName: 'Alex Mokoena' })).toBe('Alex Mokoena');
  });
  it('supports Tshivenda as the owner-specific language option', () => {
    expect(OWNER_VENDA_LANGUAGE).toBe('ve-ZA');
    expect(resolveCommunicationLanguage(undefined, true)).toBe('ve-ZA');
    expect(RYANAI_LANGUAGES.find((language) => language.code === 've-ZA')?.nativeLabel).toBe('Tshivenḓa');
  });
  it('defaults other users to South African English and accepts international English', () => {
    expect(DEFAULT_RYANAI_LANGUAGE).toBe('en-ZA');
    expect(resolveCommunicationLanguage('en-GB')).toBe('en-GB');
    expect(resolveCommunicationLanguage('invalid')).toBe('en-ZA');
  });
  it('personalizes owner replies without duplicating the title', () => {
    expect(addressOwnerResponse('Your report is ready.')).toBe('Certainly, Sir G. Your report is ready.');
    expect(addressOwnerResponse('Certainly, Sir G. Your report is ready.')).toBe('Certainly, Sir G. Your report is ready.');
  });
});
