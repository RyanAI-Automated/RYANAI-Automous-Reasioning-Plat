export interface RyanLanguage {
  code: string;
  name: string;
  region: 'South Africa' | 'International';
}

export const RYANAI_LANGUAGES: readonly RyanLanguage[] = [
  { code: 'af-ZA', name: 'Afrikaans', region: 'South Africa' },
  { code: 'en-ZA', name: 'English (South Africa)', region: 'South Africa' },
  { code: 'nso-ZA', name: 'Sepedi (Northern Sotho)', region: 'South Africa' },
  { code: 'nr-ZA', name: 'isiNdebele', region: 'South Africa' },
  { code: 'xh-ZA', name: 'isiXhosa', region: 'South Africa' },
  { code: 'zu-ZA', name: 'isiZulu', region: 'South Africa' },
  { code: 'st-ZA', name: 'Sesotho', region: 'South Africa' },
  { code: 'tn-ZA', name: 'Setswana', region: 'South Africa' },
  { code: 'ss-ZA', name: 'siSwati', region: 'South Africa' },
  { code: 've-ZA', name: 'Tshivenda (Venda)', region: 'South Africa' },
  { code: 'ts-ZA', name: 'itsonga', region: 'South Africa' },
  { code: 'en-GB', name: 'English (United Kingdom)', region: 'International' },
  { code: 'en-US', name: 'English (United States)', region: 'International' },
  { code: 'fr-FR', name: 'French', region: 'International' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', region: 'International' },
  { code: 'es-ES', name: 'Spanish', region: 'International' },
  { code: 'de-DE', name: 'German', region: 'International' },
  { code: 'zh-CN', name: 'Chinese (Mandarin)', region: 'International' },
  { code: 'ja-JP', name: 'Japanese', region: 'International' },
  { code: 'hi-IN', name: 'Hindi', region: 'International' },
  { code: 'ar-SA', name: 'Arabic', region: 'International' },
  { code: 'sw-KE', name: 'Swahili', region: 'International' },
] as const;

export const DEFAULT_LANGUAGE = 'en-ZA';
export const OWNER_DEFAULT_LANGUAGE = 've-ZA';

export function isRyanLanguage(value: string): boolean {
  return RYANAI_LANGUAGES.some((language) => language.code === value);
}

export function getLanguageName(code: string): string {
  return RYANAI_LANGUAGES.find((language) => language.code === code)?.name ?? 'English (South Africa)';
}

export function languageInstruction(code: string): string {
  const name = getLanguageName(code);
  return [
    `Respond in ${name} (${code}) unless the user explicitly requests another language.`,
    'Understand and translate between the selected language and English when asked.',
    'Preserve names, technical identifiers, code, URLs, dates, numbers and security terminology accurately.',
    'If uncertain about a translation, say so rather than inventing a phrase.',
  ].join(' ');
}
