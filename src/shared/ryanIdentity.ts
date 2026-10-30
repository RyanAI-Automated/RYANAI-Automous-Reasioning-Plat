export const RYANAI_LOCALE = 'en-ZA';
export const RYANAI_TIME_ZONE = 'Africa/Johannesburg';

export interface RyanAIIdentity {
  displayName?: string | null;
  email?: string | null;
  isOwner?: boolean;
}

export function getAddress(identity: RyanAIIdentity): string {
  if (identity.isOwner) return 'Sir';
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

export function addressOwnerResponse(response: string): string {
  const clean = response.trim();
  if (!clean) return 'Certainly, Sir. How may I assist you?';
  if (/^(sir\b|certainly, sir\b|of course, sir\b)/i.test(clean)) return clean;
  return `Certainly, Sir. ${clean}`;
}
