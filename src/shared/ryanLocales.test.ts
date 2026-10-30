import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RYANAI_LANGUAGE,
  findSpeechVoice,
  getGreetingLanguageText,
  getRyanLanguage,
  RYANAI_LANGUAGES,
} from './ryanLocales';

describe('RyanAI language catalogue', () => {
  it('includes all eleven official South African language options', () => {
    expect(RYANAI_LANGUAGES.filter((language) => language.group === 'South African')).toHaveLength(11);
    expect(getRyanLanguage('ve-ZA').label).toBe('Tshivenda (Venda)');
  });

  it('defaults safely to South African English for unknown locales', () => {
    expect(DEFAULT_RYANAI_LANGUAGE).toBe('en-ZA');
    expect(getRyanLanguage('xx-XX').code).toBe('en-ZA');
  });

  it('selects only an exact matching device speech voice', () => {
    const voices = [{ lang: 'en-ZA' }, { lang: 'en-US' }] as SpeechSynthesisVoice[];
    expect(findSpeechVoice(voices, 'en-ZA')?.lang).toBe('en-ZA');
    expect(findSpeechVoice(voices, 've-ZA')).toBeUndefined();
  });

  it('provides a Tshivenda greeting instead of speaking English under a Venda locale', () => {
    expect(getGreetingLanguageText('ve-ZA', 8)).toBe('Ndi matsheloni');
  });
});
