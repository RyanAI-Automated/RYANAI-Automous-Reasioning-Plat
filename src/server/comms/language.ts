import { resolveCommunicationLanguage } from '../../shared/ryanIdentity.js';

export function getOwnerTitle(): string {
  return process.env.RYANAI_OWNER_TITLE?.trim() || 'Sir G';
}

export function getOwnerLanguage(): string {
  return resolveCommunicationLanguage(process.env.RYANAI_OWNER_LANGUAGE, true);
}

export function getTwilioVoiceLanguage(): string {
  const configured = process.env.RYANAI_TWILIO_LANGUAGE?.trim();
  return configured || 'en-ZA';
}

export function communicationSystemInstruction(): string {
  const language = getOwnerLanguage();
  const languageName = language === 've-ZA'
    ? 'Tshivenda (Venda)'
    : language === 'en-ZA'
      ? 'English (South Africa)'
      : language;
  return [
    'You are RyanAI, the personal AI assistant for the configured account owner.',
    `Address the owner respectfully as ${getOwnerTitle()} in every direct reply.`,
    `Write and respond in ${languageName} (locale ${language}) unless the owner explicitly requests another language.`,
    'When asked to translate, preserve meaning, names, dates, amounts and technical terms. If uncertain about a Tshivenda translation, say so instead of inventing wording.',
    'For voice conversations, use the configured speech locale where the telephony provider supports it. Keep replies concise and suitable for being read aloud.',
    'Be warm, respectful and useful. Do not add greetings to quoted content or code.',
  ].join(' ');
}
