export interface RyanLanguageOption {
  code: string;
  label: string;
  group: 'South African languages' | 'International English';
  nativeLabel: string;
}

export const RYANAI_LANGUAGES: readonly RyanLanguageOption[] = [
  { code: 'en-ZA', label: 'English (South Africa)', nativeLabel: 'English', group: 'South African languages' },
  { code: 'af-ZA', label: 'Afrikaans', nativeLabel: 'Afrikaans', group: 'South African languages' },
  { code: 'nr-ZA', label: 'isiNdebele', nativeLabel: 'isiNdebele', group: 'South African languages' },
  { code: 'nso-ZA', label: 'Sepedi', nativeLabel: 'Sepedi', group: 'South African languages' },
  { code: 'st-ZA', label: 'Sesotho', nativeLabel: 'Sesotho', group: 'South African languages' },
  { code: 'ss-ZA', label: 'siSwati', nativeLabel: 'siSwati', group: 'South African languages' },
  { code: 'tn-ZA', label: 'Setswana', nativeLabel: 'Setswana', group: 'South African languages' },
  { code: 'ts-ZA', label: 'itsonga', nativeLabel: 'itsonga', group: 'South African languages' },
  { code: 've-ZA', label: 'Tshivenda (Venda)', nativeLabel: 'Tshivenḓa', group: 'South African languages' },
  { code: 'xh-ZA', label: 'isiXhosa', nativeLabel: 'isiXhosa', group: 'South African languages' },
  { code: 'zu-ZA', label: 'isiZulu', nativeLabel: 'isiZulu', group: 'South African languages' },
  { code: 'en-GB', label: 'English (United Kingdom)', nativeLabel: 'English', group: 'International English' },
  { code: 'en-US', label: 'English (United States)', nativeLabel: 'English', group: 'International English' },
  { code: 'en-AU', label: 'English (Australia)', nativeLabel: 'English', group: 'International English' },
  { code: 'en-CA', label: 'English (Canada)', nativeLabel: 'English', group: 'International English' },
  { code: 'en-IN', label: 'English (India)', nativeLabel: 'English', group: 'International English' },
  { code: 'en-IE', label: 'English (Ireland)', nativeLabel: 'English', group: 'International English' },
  { code: 'en-NZ', label: 'English (New Zealand)', nativeLabel: 'English', group: 'International English' },
] as const;

export const DEFAULT_RYANAI_LANGUAGE = 'en-ZA';
export const OWNER_VENDA_LANGUAGE = 've-ZA';

export function getLanguageLabel(code: string): string {
  return RYANAI_LANGUAGES.find((language) => language.code === code)?.label ?? 'English (South Africa)';
}

export function isSupportedRyanLanguage(code: string): boolean {
  return RYANAI_LANGUAGES.some((language) => language.code === code);
}
