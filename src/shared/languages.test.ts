import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LANGUAGE,
  OWNER_DEFAULT_LANGUAGE,
  RYANAI_LANGUAGES,
  getLanguageName,
  isRyanLanguage,
  languageInstruction,
} from './languages.js';

describe('RyanAI language catalogue', () => {
  it('includes all eleven official South African languages', () => {
    const codes = RYANAI_LANGUAGES.filter((item) => item.region === 'South Africa').map((item) => item.code);
    expect(codes).toEqual([
      'af-ZA', 'en-ZA', 'nso-ZA', 'nr-ZA', 'xh-ZA', 'zu-ZA',
      'st-ZA', 'tn-ZA', 'ss-ZA', 've-ZA', 'ts-ZA',
    ]);
  });

  it('defaults the owner to Tshivenda and other users to South African English', () => {
    expect(OWNER_DEFAULT_LANGUAGE).toBe('ve-ZA');
    expect(DEFAULT_LANGUAGE).toBe('en-ZA');
  });

  it('offers international language choices and validates language codes', () => {
    expect(isRyanLanguage('fr-FR')).toBe(true);
    expect(isRyanLanguage('xx-XX')).toBe(false);
    expect(getLanguageName('ve-ZA')).toBe('Tshivenda (Venda)');
  });

  it('creates a translation-aware response instruction for the selected language', () => {
    expect(languageInstruction('ve-ZA')).toContain('Respond in Tshivenda (Venda) (ve-ZA)');
    expect(languageInstruction('ve-ZA')).toContain('translate between the selected language and English');
  });
});
