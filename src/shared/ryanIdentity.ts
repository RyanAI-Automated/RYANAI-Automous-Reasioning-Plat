import { OWNER_DEFAULT_LANGUAGE, isRyanLanguage, languageInstruction } from './languages.js';
export const RYANAI_LOCALE = 'en-ZA';
export const RYANAI_TIME_ZONE = 'Africa/Johannesburg';

export interface RyanAIIdentity {
  displayName?: string | null;
  email?: string | null;
  isOwner?: boolean;
}

export function getAddress(identity: RyanAIIdentity): string {
  if (identity.isOwner) return 'Sir G';
  const name = identity.displayName?.trim();
  if (name) return name;
  const emailName = identity.email?.split('@')[0]?.trim();
  return emailName || 'there';
}

export function getTimeGreeting(date = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat('en-ZA', {
    hour: '2-digit',
    hourCycle: 'h23',
    timeZone: RYANAI_TIME_ZONE,
  }).format(date));
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

export function createLoginGreeting(identity: RyanAIIdentity, date = new Date()): string {
  return `${getTimeGreeting(date)}, ${getAddress(identity)}. I'm RyanAI. Your assistant is ready.`;
}

export function getOwnerResponseLanguage(): string {
  const configured = process.env.RYANAI_OWNER_LANGUAGE?.trim();
  return configured && isRyanLanguage(configured) ? configured : OWNER_DEFAULT_LANGUAGE;
}

export function ownerCommunicationInstruction(): string {
  const title = process.env.RYANAI_OWNER_TITLE?.trim() || 'Sir G';
  return [
    'You are RyanAI, the personal assistant for the verified owner.',
    `Address the owner respectfully as ${title} in every direct reply.`,
    languageInstruction(getOwnerResponseLanguage()),
    'When the owner writes in another language, understand it and respond in that language unless asked to translate.',
    'Preserve technical terms, code, URLs, names, dates and numbers accurately. If unsure about a Venda translation, be transparent.',
  ].join(' ');
}

export function addressOwnerResponse(response: string): string {
  const clean = response.trim();
  const title = process.env.RYANAI_OWNER_TITLE?.trim() || 'Sir G';
  if (!clean) return `Certainly, ${title}. How may I assist you?`;
  const lower = clean.toLocaleLowerCase();
  if (lower.startsWith(title.toLocaleLowerCase()) || lower.startsWith(`certainly, ${title.toLocaleLowerCase()}`) || lower.startsWith(`of course, ${title.toLocaleLowerCase()}`)) return clean;
  return `Certainly, ${title}. ${clean}`;
}
