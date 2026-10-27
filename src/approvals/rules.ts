/** How long an action waits for a decision before it can no longer be approved. */
export const ACTION_TTL_MS = 24 * 60 * 60_000;

/** Open actions for one user. This stops an agent loop from flooding the queue. */
export const MAX_PENDING_PER_USER = 20;

const RESULT_MAX_CHARS = 500;

export const ACTION_TOOLS = ['send_email', 'send_whatsapp_message', 'make_voice_call'] as const;
export type ActionTool = (typeof ACTION_TOOLS)[number];

// Type aliases, not interfaces, so that Prisma accepts them as JSON.
export type EmailArgs = { to: string; subject: string; html: string };
export type WhatsAppArgs = { to: string; message: string };
export type CallArgs = { to: string; twimlMessage: string };
export type ActionArgs = EmailArgs | WhatsAppArgs | CallArgs;

const EMAIL_PATTERN = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
const PHONE_PATTERN = /^\+[1-9]\d{6,14}$/;

export function isActionTool(value: unknown): value is ActionTool {
  return typeof value === 'string' && (ACTION_TOOLS as readonly string[]).includes(value);
}

function field(source: Record<string, unknown>, name: string, max: number): string {
  const value = source[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be text that is not empty.`);
  }
  if (value.length > max) {
    throw new Error(`${name} is too long. The limit is ${max} characters.`);
  }
  return value;
}

function phoneField(source: Record<string, unknown>): string {
  const number = field(source, 'to', 40).replace(/[\s().-]/g, '');
  if (!PHONE_PATTERN.test(number)) {
    throw new Error('to must be a phone number in international format, for example +1234567890.');
  }
  return number;
}

/**
 * Check the arguments of an action and return a clean copy.
 * The queue and the sender both call it, so a changed database row cannot send
 * anything that the tools would refuse.
 */
export function parseActionArgs(tool: ActionTool, args: unknown): ActionArgs {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new Error('The action arguments must be an object.');
  }
  const source = args as Record<string, unknown>;
  switch (tool) {
    case 'send_email': {
      const to = field(source, 'to', 254).trim();
      if (!EMAIL_PATTERN.test(to)) throw new Error('to must be one email address.');
      const subject = field(source, 'subject', 200);
      if (/[\r\n]/.test(subject)) throw new Error('subject must be one line.');
      return { to, subject, html: field(source, 'html', 20_000) };
    }
    case 'send_whatsapp_message':
      return { to: phoneField(source), message: field(source, 'message', 1600) };
    case 'make_voice_call':
      return { to: phoneField(source), twimlMessage: field(source, 'twimlMessage', 500) };
  }
}

function preview(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** One line that tells an approver what the action does. */
export function summarizeAction(tool: ActionTool, args: ActionArgs): string {
  switch (tool) {
    case 'send_email': {
      const { to, subject } = args as EmailArgs;
      return `Email to ${to}: "${preview(subject)}"`;
    }
    case 'send_whatsapp_message': {
      const { to, message } = args as WhatsAppArgs;
      return `WhatsApp message to ${to}: "${preview(message)}"`;
    }
    case 'make_voice_call': {
      const { to, twimlMessage } = args as CallArgs;
      return `Voice call to ${to}: "${preview(twimlMessage)}"`;
    }
  }
}

/** Escape text that goes inside an XML element, such as the speech in a TwiML call. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + ACTION_TTL_MS);
}

/** Cut a result or an error so that the table does not store long provider output. */
export function previewResult(text: string): string {
  return text.length > RESULT_MAX_CHARS ? `${text.slice(0, RESULT_MAX_CHARS - 1)}…` : text;
}
