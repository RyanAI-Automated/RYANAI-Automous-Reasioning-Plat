import { authenticatedFetch } from './authenticatedFetch';

export type CommsChannel = 'whatsapp' | 'sms' | 'voice' | 'email';
export interface CommsMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  status: string;
  providerMessageId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}
export interface CommsConversation {
  id: string;
  channel: CommsChannel;
  externalAddress: string;
  updatedAt: string;
  messages: CommsMessage[];
}
export interface CommsStatus {
  status: 'configuration_snapshot';
  channels: Record<string, boolean>;
  note: string;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error === 'string' ? body.error : `Communications request failed (HTTP ${response.status}).`;
    throw new Error(message);
  }
  return body as T;
}

export async function getCommsStatus(): Promise<CommsStatus> {
  const response = await authenticatedFetch('/api/comms/status');
  return readJson<CommsStatus>(response);
}

export async function getCommsConversations(limit = 50): Promise<CommsConversation[]> {
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  const response = await authenticatedFetch(`/api/comms/conversations?limit=${safeLimit}`);
  const body = await readJson<{ conversations: CommsConversation[] }>(response);
  return Array.isArray(body.conversations) ? body.conversations : [];
}

export async function sendCommsMessage(input: {
  channel: CommsChannel;
  recipient?: string;
  message: string;
  subject?: string;
}): Promise<{ success: boolean; channel: CommsChannel; providerId: string; status: string }> {
  const response = await authenticatedFetch('/api/comms/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readJson(response);
}
