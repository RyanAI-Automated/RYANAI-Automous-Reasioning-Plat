/**
 * Versioned, transport-neutral contract for the RyanAI connectivity bridge.
 *
 * Authentication tickets are short-lived, single-use values minted by the
 * trusted backend. Never put bearer tokens or tickets in URLs or log payloads.
 */
export const BRIDGE_PROTOCOL_VERSION = 1 as const;
export const MAX_BRIDGE_TOPICS = 64;
export const MAX_BRIDGE_TOPIC_LENGTH = 128;
export const MAX_BRIDGE_ID_LENGTH = 128;

export type BridgeCapabilityState = 'ready' | 'degraded' | 'unavailable';

export interface BridgeClientMessageMap {
  hello: { ticket: string; resumeAfter?: string };
  heartbeat: { nonce: string };
  subscribe: { topics: string[]; after?: string };
  ack: { eventId: string; cursor: string };
}

export type BridgeClientMessage = {
  [K in keyof BridgeClientMessageMap]: {
    type: K;
    data: BridgeClientMessageMap[K];
  };
}[keyof BridgeClientMessageMap];

export interface BridgeClientEnvelope {
  version: typeof BRIDGE_PROTOCOL_VERSION;
  id: string;
  sentAt: number;
  message: BridgeClientMessage;
}

export type BridgeServerMessage =
  | {
      type: 'ready';
      data: {
        connectionId: string;
        capabilities: Record<string, BridgeCapabilityState>;
        resumedFrom?: string;
      };
    }
  | { type: 'heartbeat_ack'; data: { nonce: string; serverTime: number } }
  | {
      type: 'event';
      data: {
        eventId: string;
        cursor: string;
        topic: string;
        payload: unknown;
        occurredAt: number;
      };
    }
  | {
      type: 'degraded';
      data: { dependency: string; state: BridgeCapabilityState; retryable: boolean };
    }
  | {
      type: 'error';
      data: { code: string; message: string; retryable: boolean };
    };

export interface BridgeServerEnvelope {
  version: typeof BRIDGE_PROTOCOL_VERSION;
  id: string;
  sentAt: number;
  message: BridgeServerMessage;
}

export class BridgeProtocolError extends Error {
  constructor(
    public readonly code: 'INVALID_ENVELOPE' | 'UNSUPPORTED_VERSION' | 'INVALID_MESSAGE',
  ) {
    super('Invalid bridge protocol message');
    this.name = 'BridgeProtocolError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, maxLength = MAX_BRIDGE_ID_LENGTH): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

/** Validates an untrusted decoded frame without echoing its contents in errors. */
export function parseBridgeClientEnvelope(value: unknown): BridgeClientEnvelope {
  if (!isRecord(value) || !isRecord(value.message)) {
    throw new BridgeProtocolError('INVALID_ENVELOPE');
  }

  if (value.version !== BRIDGE_PROTOCOL_VERSION) {
    throw new BridgeProtocolError('UNSUPPORTED_VERSION');
  }

  if (
    !isNonEmptyString(value.id) ||
    typeof value.sentAt !== 'number' ||
    !Number.isSafeInteger(value.sentAt) ||
    value.sentAt <= 0
  ) {
    throw new BridgeProtocolError('INVALID_ENVELOPE');
  }

  const message = value.message;
  if (!isRecord(message.data) || typeof message.type !== 'string') {
    throw new BridgeProtocolError('INVALID_MESSAGE');
  }

  const data = message.data;
  switch (message.type) {
    case 'hello':
      if (
        !isNonEmptyString(data.ticket, 4096) ||
        (data.resumeAfter !== undefined && !isNonEmptyString(data.resumeAfter, 512))
      ) throw new BridgeProtocolError('INVALID_MESSAGE');
      break;
    case 'heartbeat':
      if (!isNonEmptyString(data.nonce)) throw new BridgeProtocolError('INVALID_MESSAGE');
      break;
    case 'subscribe':
      if (
        !Array.isArray(data.topics) ||
        data.topics.length === 0 ||
        data.topics.length > MAX_BRIDGE_TOPICS ||
        !data.topics.every((topic) => isNonEmptyString(topic, MAX_BRIDGE_TOPIC_LENGTH)) ||
        (data.after !== undefined && !isNonEmptyString(data.after, 512))
      ) throw new BridgeProtocolError('INVALID_MESSAGE');
      break;
    case 'ack':
      if (!isNonEmptyString(data.eventId) || !isNonEmptyString(data.cursor, 512)) {
        throw new BridgeProtocolError('INVALID_MESSAGE');
      }
      break;
    default:
      throw new BridgeProtocolError('INVALID_MESSAGE');
  }

  return value as unknown as BridgeClientEnvelope;
}
