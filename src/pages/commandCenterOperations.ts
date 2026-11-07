import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Conversation, ModelId, ToolStep, SystemStatus, Message, MessageAttachment } from '@/lib/types';
import { DEFAULT_MODEL, MODELS } from '@/lib/models';
import { createMessage, saveConversations } from '@/lib/storage';
import { streamReasoning } from '@/lib/reasoning';
import { supabase } from '@/lib/supabase';
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_MESSAGE_ATTACHMENT_BYTES,
  removeConversationAttachments,
  safeAttachmentName,
  signConversationAttachment,
  uploadConversationAttachments,
} from '@/lib/attachments';
import type { AttachmentUploadOptions } from '@/lib/attachments';
import { MAX_CONVERSATION_ARCHIVE_BYTES, readTarArchive } from '@/lib/conversationArchive';

interface OutgoingMessagePersistenceOptions {
  userId: string;
  conversationId: string;
  message: Message;
  prompt: string;
  files: File[];
  uploadOptions: AttachmentUploadOptions;
}

export async function persistOutgoingUserMessage({
  userId,
  conversationId,
  message,
  prompt,
  files,
  uploadOptions,
}: OutgoingMessagePersistenceOptions): Promise<Message> {
  const client = supabase;
  if (client) message.id = crypto.randomUUID();

  let attachments: MessageAttachment[] = [];
  let persistedMessage = false;

  try {
    if (client) {
      const { error } = await client.from('messages').insert({
        id: message.id,
        conversation_id: conversationId,
        role: 'user',
        content: prompt,
        metadata: null,
      });
      if (error) throw new Error(error.message || 'Unable to save your message.');
      persistedMessage = true;
    }

    if (files.length > 0) {
      if (!client) throw new Error('Private cloud storage is not configured for this account.');
      attachments = await uploadConversationAttachments(
        client,
        userId,
        conversationId,
        message.id,
        files,
        uploadOptions,
      );
      const { error } = await client
        .from('messages')
        .update({ metadata: { attachments } })
        .eq('id', message.id)
        .eq('conversation_id', conversationId);
      if (error) throw new Error(error.message || 'Unable to attach uploaded files to your message.');
    }
  } catch (error) {
    if (client && attachments.length > 0) {
      try {
        await removeConversationAttachments(client, attachments);
      } catch {
        // Cleanup can be retried by storage retention tooling.
      }
    }
    if (client && persistedMessage) {
      const { error: rollbackError } = await client
        .from('messages')
        .delete()
        .eq('id', message.id)
        .eq('conversation_id', conversationId);
      if (rollbackError) {
        console.error('Unable to roll back failed attachment message:', rollbackError.message);
      }
    }
    throw error;
  }

  const displayAttachments = await Promise.all(
    attachments.map(async (attachment) => {
      if (!client) return attachment;
      try {
        return await signConversationAttachment(client, userId, conversationId, attachment);
      } catch (error) {
        console.warn('Attachment uploaded but preview URL could not be created:', error);
        return attachment;
      }
    }),
  );

  return { ...message, attachments: displayAttachments };
}

interface StreamAssistantResponseOptions {
  text: string;
  model: ModelId;
  conversationId: string;
  userId: string;
  mountedRef: MutableRefObject<boolean>;
  requestStartRef: MutableRefObject<number | null>;
  setSending: Dispatch<SetStateAction<boolean>>;
  setLiveModel: Dispatch<SetStateAction<ModelId>>;
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
  setLiveText: Dispatch<SetStateAction<string>>;
  setLiveSteps: Dispatch<SetStateAction<ToolStep[]>>;
  setStatus: Dispatch<SetStateAction<SystemStatus>>;
}

export async function streamAssistantResponse({
  text,
  model,
  conversationId,
  userId,
  mountedRef,
  requestStartRef,
  setSending,
  setLiveModel,
  setConversations,
  setLiveText,
  setLiveSteps,
  setStatus,
}: StreamAssistantResponseOptions): Promise<void> {
  setSending(true);
  requestStartRef.current = performance.now();
  setLiveText('');
  setLiveModel(model);
  setLiveSteps([]);

  let accumulatedText = '';
  const accumulatedSteps: ToolStep[] = [];

  const updateConversationTitle = (title: string) => {
    if (!mountedRef.current) return;
    setConversations((previous) => {
      const next = previous.map((conversation) =>
        conversation.id === conversationId ? { ...conversation, title } : conversation,
      );
      if (!supabase) saveConversations(next, userId);
      return next;
    });
    if (supabase) {
      supabase
        .from('conversations')
        .update({ title, updated_at: new Date().toISOString() })
        .eq('id', conversationId);
    }
  };

  const finishWithAssistantMessage = () => {
    if (!mountedRef.current) return;
    const assistantMessage = createMessage('assistant', accumulatedText, model, accumulatedSteps);
    setConversations((previous) => {
      const next = previous.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              messages: [...conversation.messages, assistantMessage],
              updatedAt: Date.now(),
            }
          : conversation,
      );
      if (!supabase) saveConversations(next, userId);
      return next;
    });
    setLiveText('');
    setLiveSteps([]);

    if (supabase) {
      supabase.from('messages').insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: accumulatedText,
        model,
        steps: accumulatedSteps.length > 0 ? accumulatedSteps : null,
      });
    }

    setStatus((previous) => ({
      ...previous,
      latency:
        requestStartRef.current === null
          ? previous.latency
          : Math.round(performance.now() - requestStartRef.current),
      tokensIn: previous.tokensIn + Math.floor(text.length / 4),
      tokensOut: previous.tokensOut + Math.floor(accumulatedText.length / 4),
      state: 'idle',
    }));
    requestStartRef.current = null;
  };

  const finishWithStreamError = (message: string) => {
    if (!mountedRef.current) return;
    console.error('Reasoning error:', message);
    const errorMessage = createMessage(
      'assistant',
      `Reasoning request failed: ${message}`,
      model,
      accumulatedSteps,
    );
    setConversations((previous) => {
      const next = previous.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              messages: [...conversation.messages, errorMessage],
              updatedAt: Date.now(),
            }
          : conversation,
      );
      if (!supabase) saveConversations(next, userId);
      return next;
    });
    setLiveText('');
    setLiveSteps([]);
    setStatus((previous) => ({
      ...previous,
      latency:
        requestStartRef.current === null
          ? previous.latency
          : Math.round(performance.now() - requestStartRef.current),
      state: 'error',
    }));
    requestStartRef.current = null;
  };

  try {
    await streamReasoning(text, model, {
      onToken: (token) => {
        if (!mountedRef.current) return;
        accumulatedText += token;
        setLiveText(accumulatedText);
      },
      onStep: (step) => {
        if (!mountedRef.current) return;
        accumulatedSteps.push(step);
        setLiveSteps([...accumulatedSteps]);
      },
      onTitle: updateConversationTitle,
      onDone: finishWithAssistantMessage,
      onError: finishWithStreamError,
    });
  } catch {
    console.error('Stream failed');
  } finally {
    setSending(false);
  }
}

type ConversationArchiveEntries = Awaited<ReturnType<typeof readTarArchive>>;

interface PreparedArchiveMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  model?: ModelId;
  steps: ToolStep[];
  files: File[];
}

interface PreparedConversationArchive {
  title: string;
  model: ModelId;
  messages: PreparedArchiveMessage[];
}

function validateConversationArchiveFile(file: File): void {
  if (file.size <= 0 || file.size > MAX_CONVERSATION_ARCHIVE_BYTES) {
    throw new Error('Choose a non-empty TAR archive no larger than 250 MB.');
  }
  if (!file.name.toLowerCase().endsWith('.tar')) {
    throw new Error('Choose a RyanAI .tar conversation archive.');
  }
}

function parseConversationArchiveManifest(archiveEntries: ConversationArchiveEntries): {
  title: string;
  model: ModelId;
  messages: unknown[];
} {
  const entriesByPath = new Map(archiveEntries.map((entry) => [entry.path, entry]));
  const manifestEntry = entriesByPath.get('manifest.json');
  if (!manifestEntry) throw new Error('This archive is missing manifest.json.');

  let manifest: unknown;
  try {
    manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestEntry.data));
  } catch {
    throw new Error('The conversation manifest is not valid UTF-8 JSON.');
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('The conversation manifest is invalid.');
  }

  const data = manifest as Record<string, unknown>;
  if (data.format !== 'ryanai-conversation-archive' || data.version !== 1) {
    throw new Error('This RyanAI archive format or version is not supported.');
  }
  const conversationData = data.conversation;
  if (!conversationData || typeof conversationData !== 'object' || Array.isArray(conversationData)) {
    throw new Error('The archive has no conversation metadata.');
  }
  if (!Array.isArray(data.messages) || data.messages.length === 0 || data.messages.length > 5000) {
    throw new Error('The archive must contain between 1 and 5,000 messages.');
  }

  const rawConversation = conversationData as Record<string, unknown>;
  const title =
    typeof rawConversation.title === 'string' && rawConversation.title.trim()
      ? rawConversation.title.trim().slice(0, 80)
      : 'Imported RyanAI conversation';
  const requestedModel =
    typeof rawConversation.model === 'string'
      ? (rawConversation.model as ModelId)
      : DEFAULT_MODEL;
  const model = Object.hasOwn(MODELS, requestedModel)
    ? requestedModel
    : DEFAULT_MODEL;

  return { title, model, messages: data.messages };
}

function prepareArchiveAttachment(
  rawAttachment: unknown,
  entriesByPath: Map<string, ConversationArchiveEntries[number]>,
  referencedPaths: Set<string>,
): File {
  if (!rawAttachment || typeof rawAttachment !== 'object' || Array.isArray(rawAttachment)) {
    throw new Error('An attachment manifest entry is invalid.');
  }
  const attachment = rawAttachment as Record<string, unknown>;
  if (
    typeof attachment.archivePath !== 'string' ||
    !attachment.archivePath.startsWith('attachments/') ||
    typeof attachment.name !== 'string' ||
    typeof attachment.mimeType !== 'string' ||
    !Number.isSafeInteger(attachment.size) ||
    (attachment.size as number) <= 0 ||
    (attachment.size as number) > MAX_ATTACHMENT_BYTES
  ) {
    throw new Error('An attachment has invalid metadata or an unsupported size.');
  }
  if (referencedPaths.has(attachment.archivePath)) {
    throw new Error('An archive attachment is referenced more than once.');
  }

  referencedPaths.add(attachment.archivePath);
  const entry = entriesByPath.get(attachment.archivePath);
  if (!entry || entry.data.byteLength !== attachment.size) {
    throw new Error('An attachment is missing or its byte count does not match the manifest.');
  }
  return new File(
    [entry.data.slice().buffer as ArrayBuffer],
    safeAttachmentName(attachment.name),
    { type: attachment.mimeType },
  );
}

function sanitizeArchiveSteps(rawSteps: unknown): ToolStep[] {
  if (!Array.isArray(rawSteps)) return [];
  return rawSteps.slice(0, 500).flatMap((rawStep): ToolStep[] => {
    if (!rawStep || typeof rawStep !== 'object' || Array.isArray(rawStep)) return [];
    const step = rawStep as Record<string, unknown>;
    if (typeof step.type !== 'string' || typeof step.name !== 'string') return [];
    return [{
      type: step.type.slice(0, 100),
      name: step.name.slice(0, 200),
      result: typeof step.result === 'string' ? step.result.slice(0, 20_000) : undefined,
      args:
        step.args && typeof step.args === 'object' && !Array.isArray(step.args)
          ? (step.args as Record<string, unknown>)
          : undefined,
    }];
  });
}

function prepareArchiveMessage(
  rawMessage: unknown,
  index: number,
  entriesByPath: Map<string, ConversationArchiveEntries[number]>,
  referencedPaths: Set<string>,
): PreparedArchiveMessage {
  if (!rawMessage || typeof rawMessage !== 'object' || Array.isArray(rawMessage)) {
    throw new Error(`Message ${index + 1} is invalid.`);
  }
  const message = rawMessage as Record<string, unknown>;
  if (message.role !== 'user' && message.role !== 'assistant') {
    throw new Error(`Message ${index + 1} has an unsupported role.`);
  }
  if (typeof message.content !== 'string' || message.content.length > 2_000_000) {
    throw new Error(`Message ${index + 1} has invalid or oversized content.`);
  }

  const attachments = message.attachments === undefined ? [] : message.attachments;
  if (!Array.isArray(attachments) || attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new Error(`Message ${index + 1} exceeds the attachment count limit.`);
  }
  const files = attachments.map((attachment) =>
    prepareArchiveAttachment(attachment, entriesByPath, referencedPaths),
  );
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > MAX_MESSAGE_ATTACHMENT_BYTES) {
    throw new Error('A message exceeds the combined 40 MB attachment limit.');
  }

  const timestamp =
    typeof message.timestamp === 'number' &&
    Number.isFinite(message.timestamp) &&
    Math.abs(message.timestamp) <= 8.64e15
      ? message.timestamp
      : Date.now();
  const requestedModel = typeof message.model === 'string' ? message.model : '';
  const model = Object.hasOwn(MODELS, requestedModel)
    ? (requestedModel as ModelId)
    : undefined;

  return {
    role: message.role,
    content: message.content,
    timestamp,
    model,
    steps: sanitizeArchiveSteps(message.steps),
    files,
  };
}

function validateConversationArchiveEntries(
  archiveEntries: ConversationArchiveEntries,
  referencedPaths: Set<string>,
): void {
  const allowedArchivePaths = new Set(['manifest.json', 'conversation.md']);
  for (const entry of archiveEntries) {
    if (!allowedArchivePaths.has(entry.path) && !entry.path.startsWith('attachments/')) {
      throw new Error(`The archive contains an unsupported extra file: ${entry.path}`);
    }
    if (entry.path.startsWith('attachments/') && !referencedPaths.has(entry.path)) {
      throw new Error('The archive contains unreferenced attachment files.');
    }
  }
}

export async function prepareConversationArchive(file: File): Promise<PreparedConversationArchive> {
  validateConversationArchiveFile(file);
  const archiveEntries = await readTarArchive(file);
  const entriesByPath = new Map(archiveEntries.map((entry) => [entry.path, entry]));
  const manifest = parseConversationArchiveManifest(archiveEntries);
  const referencedPaths = new Set<string>();
  const messages = manifest.messages.map((message, index) =>
    prepareArchiveMessage(message, index, entriesByPath, referencedPaths),
  );
  validateConversationArchiveEntries(archiveEntries, referencedPaths);
  return { title: manifest.title, model: manifest.model, messages };
}

export async function persistImportedConversationMessages(
  client: NonNullable<typeof supabase>,
  userId: string,
  conversationId: string,
  preparedMessages: PreparedArchiveMessage[],
  uploaded: MessageAttachment[],
): Promise<Message[]> {
  const importedMessages: Message[] = [];
  for (const item of preparedMessages) {
    const messageId = crypto.randomUUID();
    const attachments = item.files.length
      ? await uploadConversationAttachments(client, userId, conversationId, messageId, item.files)
      : [];
    uploaded.push(...attachments);

    const { error } = await client.from('messages').insert({
      id: messageId,
      conversation_id: conversationId,
      role: item.role,
      content: item.content,
      model: item.model ?? null,
      steps: item.steps.length ? item.steps : null,
      metadata: attachments.length ? { attachments } : null,
      created_at: new Date(item.timestamp).toISOString(),
    });
    if (error) throw new Error(error.message || 'Unable to save an imported message.');

    const displayAttachments = await Promise.all(
      attachments.map((attachment) =>
        signConversationAttachment(client, userId, conversationId, attachment),
      ),
    );
    importedMessages.push({
      id: messageId,
      role: item.role,
      content: item.content,
      model: item.model,
      steps: item.steps,
      attachments: displayAttachments,
      timestamp: item.timestamp,
    });
  }
  return importedMessages;
}

export async function rollbackImportedConversation(
  client: NonNullable<typeof supabase>,
  userId: string,
  conversationId: string,
  uploaded: MessageAttachment[],
): Promise<void> {
  if (uploaded.length > 0) {
    try {
      await removeConversationAttachments(client, uploaded);
    } catch (cleanupError) {
      console.error('Imported attachment cleanup needs retry:', cleanupError);
    }
  }
  try {
    await client.from('conversations').delete().eq('id', conversationId).eq('user_id', userId);
  } catch (cleanupError) {
    console.error('Failed to roll back the incomplete imported conversation:', cleanupError);
  }
}
