import { authenticatedFetch } from './authenticatedFetch';
import { supabase } from './supabase';

export type CommsChannel = 'whatsapp' | 'sms' | 'voice' | 'email';

export interface CommsAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  status: string;
}

export interface CommsAttachmentUploadIntent {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  uploadPath: string;
  uploadToken: string;
}

/** Compatibility alias for callers that used the earlier upload-intent name. */
export type CommsUploadIntent = CommsAttachmentUploadIntent;

export interface CommsMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  status: string;
  providerMessageId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  attachments?: CommsAttachment[];
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
  ai?: { openai?: { status: 'configured_unverified' | 'missing_credentials' } };
  note: string;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as { error?: unknown };
  if (!response.ok) {
    const message = typeof body.error === 'string'
      ? body.error
      : `Communications request failed (HTTP ${response.status}).`;
    throw new Error(message);
  }
  return body as T;
}

export async function getCommsStatus(): Promise<CommsStatus> {
  const response = await authenticatedFetch('/api/comms/status');
  return readJson<CommsStatus>(response);
}

export async function getCommsConversations(limit = 50): Promise<CommsConversation[]> {
  const safeLimit = Number.isFinite(limit)
    ? Math.min(100, Math.max(1, Math.floor(limit)))
    : 50;
  const response = await authenticatedFetch(`/api/comms/conversations?limit=${safeLimit}`);
  const body = await readJson<{ conversations?: CommsConversation[] }>(response);
  return Array.isArray(body.conversations) ? body.conversations : [];
}

export async function prepareCommsAttachments(input: {
  channel: Exclude<CommsChannel, 'voice'>;
  recipient?: string;
  message: string;
  subject?: string;
  idempotencyKey: string;
  files: Array<{ name: string; mimeType: string; size: number }>;
}): Promise<{
  success: boolean;
  messageId: string;
  replayed: boolean;
  attachments: CommsAttachmentUploadIntent[];
}> {
  const response = await authenticatedFetch('/api/comms/attachments/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readJson(response);
}

export async function uploadCommsAttachment(
  intent: CommsAttachmentUploadIntent,
  file: File,
): Promise<void> {
  if (!supabase) {
    throw new Error('Secure attachment storage is unavailable because Supabase is not configured.');
  }
  const { error } = await supabase.storage
    .from('ryanai-comms-attachments')
    .uploadToSignedUrl(intent.uploadPath, intent.uploadToken, file, {
      contentType: file.type,
      upsert: false,
    });
  if (error) throw new Error(error.message || 'Attachment upload failed.');
}

export async function getCommsAttachmentStatuses(
  ids: readonly string[],
): Promise<CommsAttachment[]> {
  if (!ids.length) return [];
  if (ids.length > 8) throw new Error('Choose between 1 and 8 attachments.');
  const query = new URLSearchParams({ ids: ids.join(',') });
  const response = await authenticatedFetch('/api/comms/attachments/status?' + query.toString());
  const body = await readJson<{ attachments?: CommsAttachment[] }>(response);
  return Array.isArray(body.attachments) ? body.attachments : [];
}

export async function getCommsAttachmentDownloadUrl(id: string): Promise<string> {
  const response = await authenticatedFetch(
    '/api/comms/attachments/' + encodeURIComponent(id) + '/download',
  );
  const body = await readJson<{ url?: string }>(response);
  if (typeof body.url !== 'string') {
    throw new Error('The clean attachment download URL was not returned.');
  }

  let downloadUrl: URL;
  try {
    downloadUrl = new URL(body.url);
  } catch {
    throw new Error('The clean attachment download URL is invalid.');
  }
  if (downloadUrl.protocol !== 'https:') {
    throw new Error('The clean attachment download URL must use HTTPS.');
  }
  return downloadUrl.toString();
}

export async function sendCommsMessage(input: {
  channel: CommsChannel;
  recipient?: string;
  message: string;
  subject?: string;
  idempotencyKey: string;
  attachmentIds?: string[];
}): Promise<{
  success: boolean;
  channel: CommsChannel;
  providerId: string | null;
  status: string;
  replayed?: boolean;
}> {
  const response = await authenticatedFetch('/api/comms/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readJson(response);
}
