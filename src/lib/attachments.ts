import type { SupabaseClient } from '@supabase/supabase-js';

export const ATTACHMENT_BUCKET = 'ryanai-attachments';
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 8;

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  mp4: 'video/mp4', webm: 'video/webm',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
  json: 'application/json', xml: 'application/xml', js: 'text/javascript', ts: 'text/typescript',
  tsx: 'text/typescript', jsx: 'text/javascript', py: 'text/x-python', go: 'text/x-go',
  rs: 'text/x-rust', java: 'text/x-java', css: 'text/css',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
};

const ALLOWED_MIME_TYPES = new Set(Object.values(MIME_BY_EXTENSION));

export interface MessageAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  path: string;
  url?: string;
}

export function safeAttachmentName(name: string): string {
  const leaf = name.split(/[\\/]/).pop() ?? 'attachment';
  const cleaned = leaf.normalize('NFKC').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 120);
  return cleaned || 'attachment';
}

export function validateAttachment(file: Pick<File, 'name' | 'type' | 'size'>): { mimeType: string; name: string } {
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Each attachment must be between 1 byte and ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`);
  }
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const inferred = MIME_BY_EXTENSION[extension];
  const mimeType = file.type || inferred || '';
  if (!ALLOWED_MIME_TYPES.has(mimeType) || (inferred && mimeType !== inferred)) {
    throw new Error(`File type is not supported: ${file.name}`);
  }
  if (!inferred) throw new Error(`File extension is not supported: ${file.name}`);
  return { mimeType, name: safeAttachmentName(file.name) };
}

export function validateAttachmentBatch(files: readonly Pick<File, 'name' | 'type' | 'size'>[]): void {
  if (files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new Error(`Attach no more than ${MAX_ATTACHMENTS_PER_MESSAGE} files to one message.`);
  }
  files.forEach(validateAttachment);
}

export async function uploadConversationAttachments(
  client: SupabaseClient,
  userId: string,
  conversationId: string,
  messageId: string,
  files: readonly File[],
): Promise<MessageAttachment[]> {
  validateAttachmentBatch(files);
  const settled = await Promise.allSettled(files.map(async (file) => {
    const { mimeType, name } = validateAttachment(file);
    const id = crypto.randomUUID();
    const path = `${userId}/${conversationId}/${messageId}/${id}-${name}`;
    const { error } = await client.storage.from(ATTACHMENT_BUCKET).upload(path, file, {
      contentType: mimeType,
      cacheControl: '3600',
      upsert: false,
    });
    if (error) throw new Error(error.message || `Upload failed for ${name}`);
    return { id, name, mimeType, size: file.size, path };
  }));

  const failed = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failed) {
    const uploadedPaths = settled
      .filter((result): result is PromiseFulfilledResult<MessageAttachment> => result.status === 'fulfilled')
      .map((result) => result.value.path);
    if (uploadedPaths.length) {
      try {
        await client.storage.from(ATTACHMENT_BUCKET).remove(uploadedPaths);
      } catch {
        // Keep the original upload error; an orphan cleanup can retry separately.
      }
    }
    throw failed.reason instanceof Error ? failed.reason : new Error('Attachment upload failed.');
  }

  return settled.map((result) => (result as PromiseFulfilledResult<MessageAttachment>).value);
}

export async function signConversationAttachment(
  client: SupabaseClient,
  userId: string,
  conversationId: string,
  attachment: MessageAttachment,
): Promise<MessageAttachment> {
  const prefix = `${userId}/${conversationId}/`;
  if (!attachment.path.startsWith(prefix) || attachment.path.includes('..')) {
    throw new Error('Attachment path does not belong to this conversation.');
  }
  const { data, error } = await client.storage.from(ATTACHMENT_BUCKET).createSignedUrl(attachment.path, 60);
  if (error || !data?.signedUrl) throw new Error(error?.message || 'Unable to create a secure download link.');
  return { ...attachment, url: data.signedUrl };
}

export async function removeConversationAttachments(
  client: SupabaseClient,
  attachments: readonly MessageAttachment[],
): Promise<void> {
  const paths = [...new Set(attachments.map((attachment) => attachment.path))];
  if (!paths.length) return;
  const { error } = await client.storage.from(ATTACHMENT_BUCKET).remove(paths);
  if (error) throw new Error(error.message || 'Unable to remove conversation attachments.');
}
