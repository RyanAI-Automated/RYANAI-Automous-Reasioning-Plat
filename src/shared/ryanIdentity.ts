import { DEFAULT_RYANAI_LANGUAGE, OWNER_VENDA_LANGUAGE, isSupportedRyanLanguage } from './languages.js';

export const RYANAI_LOCALE = DEFAULT_RYANAI_LANGUAGE;
export const RYANAI_TIME_ZONE = 'Africa/Johannesburg';

export interface RyanAIIdentity {
  displayName?: string | null;
  email?: string | null;
  isOwner?: boolean;
  preferredTitle?: string | null;
}

export function getAddress(identity: RyanAIIdentity): string {
  if (identity.isOwner) return identity.preferredTitle?.trim() || 'Sir G';
  const name = identity.displayName?.trim();
  if (name) return name;
  const emailName = identity.email?.split('@')[0]?.trim();
  return emailName || 'there';
}

export function getTimeGreeting(date = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat('en-ZA', {
    hour: '2-digit', hourCycle: 'h23', timeZone: RYANAI_TIME_ZONE,
  }).format(date));
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

export function createLoginGreeting(identity: RyanAIIdentity, date = new Date()): string {
  return `${getTimeGreeting(date)}, ${getAddress(identity)}. I'm RyanAI. Your assistant is ready.`;
}

export function addressOwnerResponse(response: string, title = 'Sir G'): string {
  const clean = response.trim();
  if (!clean) return `Certainly, ${title}. How may I assist you?`;
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`^(certainly, |of course, )?${escapedTitle}\\b`, 'i').test(clean)) return clean;
  return `Certainly, ${title}. ${clean}`;
}

export function resolveCommunicationLanguage(value?: string | null, isOwner = false): string {
  const configured = value?.trim() || (isOwner ? OWNER_VENDA_LANGUAGE : DEFAULT_RYANAI_LANGUAGE);
  return isSupportedRyanLanguage(configured) ? configured : DEFAULT_RYANAI_LANGUAGE;
}
