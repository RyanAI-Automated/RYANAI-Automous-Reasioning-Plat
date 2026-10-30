export interface RyanLanguageOption {
  code: string;
  label: string;
  group: 'South African' | 'International';
  speechLocale: string;
}

export const RYANAI_LANGUAGES: readonly RyanLanguageOption[] = [
  { code: 'en-ZA', label: 'English (South Africa)', group: 'South African', speechLocale: 'en-ZA' },
  { code: 'af-ZA', label: 'Afrikaans', group: 'South African', speechLocale: 'af-ZA' },
  { code: 'zu-ZA', label: 'isiZulu', group: 'South African', speechLocale: 'zu-ZA' },
  { code: 'xh-ZA', label: 'isiXhosa', group: 'South African', speechLocale: 'xh-ZA' },
  { code: 'nso-ZA', label: 'Sepedi', group: 'South African', speechLocale: 'nso-ZA' },
  { code: 'st-ZA', label: 'Sesotho', group: 'South African', speechLocale: 'st-ZA' },
  { code: 'tn-ZA', label: 'Setswana', group: 'South African', speechLocale: 'tn-ZA' },
  { code: 'ts-ZA', label: 'itsonga', group: 'South African', speechLocale: 'ts-ZA' },
  { code: 'ss-ZA', label: 'siSwati', group: 'South African', speechLocale: 'ss-ZA' },
  { code: 'nr-ZA', label: 'isiNdebele', group: 'South African', speechLocale: 'nr-ZA' },
  { code: 've-ZA', label: 'Tshivenda (Venda)', group: 'South African', speechLocale: 've-ZA' },
  { code: 'en-GB', label: 'English (United Kingdom)', group: 'International', speechLocale: 'en-GB' },
  { code: 'en-US', label: 'English (United States)', group: 'International', speechLocale: 'en-US' },
  { code: 'en-AU', label: 'English (Australia)', group: 'International', speechLocale: 'en-AU' },
  { code: 'en-CA', label: 'English (Canada)', group: 'International', speechLocale: 'en-CA' },
  { code: 'en-IE', label: 'English (Ireland)', group: 'International', speechLocale: 'en-IE' },
  { code: 'en-IN', label: 'English (India)', group: 'International', speechLocale: 'en-IN' },
  { code: 'en-NZ', label: 'English (New Zealand)', group: 'International', speechLocale: 'en-NZ' },
  { code: 'fr-FR', label: 'Français', group: 'International', speechLocale: 'fr-FR' },
  { code: 'es-ES', label: 'Español', group: 'International', speechLocale: 'es-ES' },
  { code: 'pt-BR', label: 'Português (Brasil)', group: 'International', speechLocale: 'pt-BR' },
  { code: 'de-DE', label: 'Deutsch', group: 'International', speechLocale: 'de-DE' },
  { code: 'it-IT', label: 'Italiano', group: 'International', speechLocale: 'it-IT' },
  { code: 'zh-CN', label: '中文 (简体)', group: 'International', speechLocale: 'zh-CN' },
  { code: 'ja-JP', label: '日本語', group: 'International', speechLocale: 'ja-JP' },
  { code: 'hi-IN', label: 'हिन्दी', group: 'International', speechLocale: 'hi-IN' },
  { code: 'ar-SA', label: 'العربية', group: 'International', speechLocale: 'ar-SA' },
] as const;

export const DEFAULT_RYANAI_LANGUAGE = 'en-ZA';

export function getRyanLanguage(code: string): RyanLanguageOption {
  return RYANAI_LANGUAGES.find((language) => language.code === code)
    ?? RYANAI_LANGUAGES[0];
}

export function findSpeechVoice(voices: SpeechSynthesisVoice[], locale: string): SpeechSynthesisVoice | undefined {
  const normalized = locale.toLowerCase();
  return voices.find((voice) => voice.lang.toLowerCase() === normalized)
    ?? voices.find((voice) => voice.lang.toLowerCase().replace('_', '-') === normalized);
}

export function getGreetingLanguageText(locale: string, hour: number): string {
  const period = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const greetings: Record<string, Record<string, string>> = {
    'en-ZA': { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening' },
    'af-ZA': { morning: 'Goeie môre', afternoon: 'Goeie middag', evening: 'Goeienaand' },
    'zu-ZA': { morning: 'Sawubona', afternoon: 'Sawubona', evening: 'Sawubona' },
    'xh-ZA': { morning: 'Molo', afternoon: 'Molo', evening: 'Molo' },
    'nso-ZA': { morning: 'Dumela', afternoon: 'Thobela', evening: 'Thobela' },
    'st-ZA': { morning: 'Lumela', afternoon: 'Lumela', evening: 'Lumela' },
    'tn-ZA': { morning: 'Dumela', afternoon: 'Dumela', evening: 'Dumela' },
    'ts-ZA': { morning: 'Avuxeni', afternoon: 'Inhlikanhi', evening: 'Riperile' },
    'ss-ZA': { morning: 'Sawubona', afternoon: 'Sawubona', evening: 'Sawubona' },
    'nr-ZA': { morning: 'Lotjhani', afternoon: 'Lotjhani', evening: 'Lotjhani' },
    've-ZA': { morning: 'Ndi matsheloni', afternoon: 'Ndi masiari', evening: 'Ndi madekwana' },
    'en-GB': { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening' },
    'en-US': { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening' },
    'en-AU': { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening' },
    'fr-FR': { morning: 'Bonjour', afternoon: 'Bonjour', evening: 'Bonsoir' },
    'es-ES': { morning: 'Buenos días', afternoon: 'Buenas tardes', evening: 'Buenas noches' },
    'pt-BR': { morning: 'Bom dia', afternoon: 'Boa tarde', evening: 'Boa noite' },
    'de-DE': { morning: 'Guten Morgen', afternoon: 'Guten Tag', evening: 'Guten Abend' },
    'it-IT': { morning: 'Buongiorno', afternoon: 'Buon pomeriggio', evening: 'Buonasera' },
    'zh-CN': { morning: '早上好', afternoon: '下午好', evening: '晚上好' },
    'ja-JP': { morning: 'おはようございます', afternoon: 'こんにちは', evening: 'こんばんは' },
    'hi-IN': { morning: 'सुप्रभात', afternoon: 'नमस्कार', evening: 'शुभ संध्या' },
    'ar-SA': { morning: 'صباح الخير', afternoon: 'مساء الخير', evening: 'مساء الخير' },
  };
  return greetings[locale]?.[period] ?? greetings[DEFAULT_RYANAI_LANGUAGE][period];
}
