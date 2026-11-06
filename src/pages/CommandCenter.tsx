import { useState, useEffect, useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, LogOut, Terminal } from 'lucide-react';
import type {
  Conversation,
  ModelId,
  ToolStep,
  SystemStatus,
  Message,
  MessageAttachment,
} from '@/lib/types';
import { DEFAULT_MODEL, modelMeta, MODELS } from '@/lib/models';
import { DEFAULT_LANGUAGE, isRyanLanguage } from '@/shared/languages';
import {
  createConversation,
  createMessage,
  generateTitle,
  loadConversations as loadLocalConversations,
  saveConversations,
} from '@/lib/storage';
import { streamReasoning } from '@/lib/reasoning';
import { useVoiceRecognition, VOICE_COMMANDS } from '@/lib/useVoiceRecognition';
import { supabase } from '@/lib/supabase';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_MESSAGE, MAX_MESSAGE_ATTACHMENT_BYTES, removeConversationAttachments, safeAttachmentName, signConversationAttachment, uploadConversationAttachments } from '@/lib/attachments';
import type { AttachmentUploadOptions } from '@/lib/attachments';
import { createTarArchive, MAX_CONVERSATION_ARCHIVE_BYTES, readTarArchive } from '@/lib/conversationArchive';
import Sidebar from '@/components/Sidebar';
import ChatPanel from '@/components/ChatPanel';
import TelemetryPanel from '@/components/TelemetryPanel';
import AboutModal from '@/components/AboutModel';
import MemoryVault from '@/components/MemoryVault';
import GithubModal from '@/components/GithubModal';
import CodeRain from '@/components/CodeRain';
import ChatInterface from '@/components/ChatInterface';
import Modal from '@/components/Modal';
import { RyanVoiceStream } from '@/components/RyanVoiceStream';


interface OutgoingMessagePersistenceOptions {
  userId: string;
  conversationId: string;
  message: Message;
  prompt: string;
  files: File[];
  uploadOptions: AttachmentUploadOptions;
}

async function persistOutgoingUserMessage({
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

async function streamAssistantResponse({
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
      'Reasoning request failed: ' + message,
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
  const model = Object.prototype.hasOwnProperty.call(MODELS, requestedModel)
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
    throw new Error('Message ' + (index + 1) + ' is invalid.');
  }
  const message = rawMessage as Record<string, unknown>;
  if (message.role !== 'user' && message.role !== 'assistant') {
    throw new Error('Message ' + (index + 1) + ' has an unsupported role.');
  }
  if (typeof message.content !== 'string' || message.content.length > 2_000_000) {
    throw new Error('Message ' + (index + 1) + ' has invalid or oversized content.');
  }

  const attachments = message.attachments === undefined ? [] : message.attachments;
  if (!Array.isArray(attachments) || attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new Error('Message ' + (index + 1) + ' exceeds the attachment count limit.');
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
  const model = Object.prototype.hasOwnProperty.call(MODELS, requestedModel)
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
      throw new Error('The archive contains an unsupported extra file: ' + entry.path);
    }
    if (entry.path.startsWith('attachments/') && !referencedPaths.has(entry.path)) {
      throw new Error('The archive contains unreferenced attachment files.');
    }
  }
}

async function prepareConversationArchive(file: File): Promise<PreparedConversationArchive> {
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

async function persistImportedConversationMessages(
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

async function rollbackImportedConversation(
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

interface CommandCenterProps {
  onSignOut: () => void;
  userId: string;
  userEmail?: string;
  userFullName?: string;
}

/**
 * Render the account's conversations, reasoning stream, and workspace controls.
 * Use Supabase when configured and userId-scoped local storage otherwise.
 * The caller supplies the authenticated identity and handles sign-out.
 */
export default function CommandCenter({
  onSignOut,
  userId,
  userEmail,
  userFullName,
}: CommandCenterProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
  const [sending, setSending] = useState(false);
  const [voiceLanguage, setVoiceLanguage] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_LANGUAGE;
    try {
      const stored = window.localStorage.getItem('ryanai:language') ?? DEFAULT_LANGUAGE;
      return isRyanLanguage(stored) ? stored : DEFAULT_LANGUAGE;
    } catch {
      return DEFAULT_LANGUAGE;
    }
  });
  const [liveText, setLiveText] = useState('');
  const [liveSteps, setLiveSteps] = useState<ToolStep[]>([]);
  const [liveModel, setLiveModel] = useState<ModelId>(DEFAULT_MODEL);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const leftDrawerRef = useRef<HTMLDivElement>(null);
  const rightDrawerRef = useRef<HTMLDivElement>(null);
  const leftDrawerCloseRef = useRef<HTMLButtonElement>(null);
  const rightDrawerCloseRef = useRef<HTMLButtonElement>(null);
  const leftDrawerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const rightDrawerTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!leftOpen && !rightOpen) return;

    const activeSide = leftOpen ? 'left' : 'right';
    const dialog = activeSide === 'left' ? leftDrawerRef.current : rightDrawerRef.current;
    const closeButton = activeSide === 'left' ? leftDrawerCloseRef.current : rightDrawerCloseRef.current;
    const trigger = activeSide === 'left' ? leftDrawerTriggerRef.current : rightDrawerTriggerRef.current;
    const previouslyFocused =
      trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);

    closeButton?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setLeftOpen(false);
        setRightOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getAttribute('aria-hidden') !== 'true');

      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || active === dialog)) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [leftOpen, rightOpen]);

  useEffect(() => {
    if (!leftOpen && !rightOpen) return;
    const closeDrawersOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLeftOpen(false);
        setRightOpen(false);
      }
    };
    window.addEventListener('keydown', closeDrawersOnEscape);
    return () => window.removeEventListener('keydown', closeDrawersOnEscape);
  }, [leftOpen, rightOpen]);
  const [status, setStatus] = useState<SystemStatus>({
    cpu: null,
    memory: null,
    latency: null,
    tokensIn: 0,
    tokensOut: 0,
    uptime: '00:00:00',
    model: DEFAULT_MODEL,
    state: 'idle',
  });
  const mountedRef = useRef(true);
  const startTimeRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    startTimeRef.current = Date.now();
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    const handleLanguageChange = (event: Event) => {
      const detail = (event as CustomEvent<{ language?: string }>).detail;
      if (detail?.language && isRyanLanguage(detail.language)) {
        setVoiceLanguage(detail.language);
      }
    };
    window.addEventListener('ryanai:language-changed', handleLanguageChange);
    return () => window.removeEventListener('ryanai:language-changed', handleLanguageChange);
  }, []);

  const requestStartRef = useRef<number | null>(null);
  const voiceStopRef = useRef<() => void>(() => undefined);

  /**
   * Load this user's conversations and select the first result when present.
   * Use local storage only without Supabase. A returned conversation-query error leaves
   * state unchanged; returned message-query errors produce empty message lists.
   * Thrown query or local-data shape errors propagate.
   */
  const loadConversations = useCallback(async () => {
    const client = supabase;
    if (!client) {
      const localConversations = loadLocalConversations(userId);
      const supportedConversations = localConversations.map((conversation) => ({
        ...conversation,
        model: MODELS[conversation.model] ? conversation.model : DEFAULT_MODEL,
        messages: conversation.messages.map((message) => ({
          ...message,
          model:
            message.model && MODELS[message.model] ? message.model : undefined,
        })),
      }));
      // Let the effect yield before applying locally loaded state.
      await Promise.resolve();
      if (!mountedRef.current) return;
      setConversations(supportedConversations);
      if (supportedConversations.length > 0) {
        setActiveId(supportedConversations[0].id);
        setModel(supportedConversations[0].model);
      }
      return;
    }

    const { data, error } = await client
      .from('conversations')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Failed to load conversations:', error.message);
      return;
    }

    if (!data || data.length === 0) {
      setConversations([]);
      return;
    }

    // Load messages for each conversation.
    const convsWithMessages: Conversation[] = await Promise.all(
      data.map(async (conv) => {
        const { data: msgs } = await client
          .from('messages')
          .select('*')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: true });

        const messages = await Promise.all((msgs ?? []).map(async (m) => {
          const metadata = m.metadata as { attachments?: MessageAttachment[] } | null;
          const storedAttachments = Array.isArray(metadata?.attachments) ? metadata.attachments : [];
          const attachments = await Promise.all(storedAttachments.map(async (attachment) => {
            try {
              return await signConversationAttachment(client, userId, conv.id, attachment);
            } catch (error) {
              console.warn('Unable to create attachment preview link:', error);
              return null;
            }
          }));
          return {
            id: m.id,
            role: m.role,
            content: m.content,
            model: m.model as ModelId | undefined,
            steps: m.steps as ToolStep[] | undefined,
            attachments: attachments.filter((attachment): attachment is MessageAttachment => attachment !== null),
            timestamp: new Date(m.created_at).getTime(),
          };
        }));

        return {
          id: conv.id,
          title: conv.title,
          model: MODELS[conv.model as ModelId]
            ? (conv.model as ModelId)
            : DEFAULT_MODEL,
          messages,
          createdAt: new Date(conv.created_at).getTime(),
          updatedAt: new Date(conv.updated_at).getTime(),
        };
      }),
    );

    setConversations(convsWithMessages);
    if (convsWithMessages.length > 0) {
      setActiveId(convsWithMessages[0].id);
      setModel(convsWithMessages[0].model);
    }
  }, [userId]);

  useEffect(() => {
    // Defer loading so state updates do not run synchronously inside this effect.
    const loadTimer = window.setTimeout(() => {
      void loadConversations();
    }, 0);
    return () => {
      window.clearTimeout(loadTimer);
    };
  }, [loadConversations, userId]);

  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const hours = Math.floor(elapsed / 3600000);
      const mins = Math.floor((elapsed % 3600000) / 60000);
      const secs = Math.floor((elapsed % 60000) / 1000);
      const uptime = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

      setStatus((prev) => ({
        ...prev,
        uptime,
        model: sending ? liveModel : model,
        state: sending ? 'thinking' : 'idle',
      }));
    }, 2000);
    return () => clearInterval(interval);
  }, [sending, model, liveModel]);

  const activeConversation = conversations.find((c) => c.id === activeId);
  const activeMessages = activeConversation?.messages ?? [];

  /**
   * Create and select an empty conversation, returning its id.
   * Use account-scoped local storage without Supabase; returned insert errors yield
   * null, while thrown errors propagate.
   */
  const newConversation = useCallback(async () => {
    if (!supabase) {
      const conv = createConversation(model);
      setConversations((prev) => {
        const next = [conv, ...prev];
        saveConversations(next, userId);
        return next;
      });
      setActiveId(conv.id);
      setLiveText('');
      setLiveSteps([]);
      setLeftOpen(false);
      return conv.id;
    }

    const { data, error } = await supabase
      .from('conversations')
      .insert({ title: 'New Thread', model, user_id: userId })
      .select()
      .single();

    if (error || !data) {
      console.error('Failed to create conversation:', error?.message);
      return null;
    }

    const conv: Conversation = {
      id: data.id,
      title: data.title,
      model: data.model as ModelId,
      messages: [],
      createdAt: new Date(data.created_at).getTime(),
      updatedAt: new Date(data.updated_at).getTime(),
    };

    setConversations((prev) => [conv, ...prev]);
    setActiveId(conv.id);
    setLiveText('');
    setLiveSteps([]);
    setLeftOpen(false);
    return conv.id;
  }, [model, userId]);

  /** Select a thread, restore its model when found, and clear the live response display. */
  const selectConversation = useCallback(
    (id: string) => {
      setActiveId(id);
      setLeftOpen(false);
      setLiveText('');
      setLiveSteps([]);
      const conv = conversations.find((c) => c.id === id);
      if (conv) setModel(conv.model);
    },
    [conversations],
  );

  /**
   * Delete a thread remotely when configured, then remove it from local UI state.
   * Returned provider errors are ignored; thrown errors prevent the local removal.
   * Without Supabase, persist the remaining threads under userId.
   */
  const deleteConversation = useCallback(
    async (id: string) => {
      if (supabase) {
        const conversation = conversations.find((item) => item.id === id);
        const attachments = conversation?.messages.flatMap((message) => message.attachments ?? []) ?? [];
        try {
          if (attachments.length) await removeConversationAttachments(supabase, attachments);
          const { error } = await supabase.from('conversations').delete().eq('id', id);
          if (error) throw error;
        } catch (error) {
          console.error('Conversation deletion failed; keeping the thread available:', error);
          return;
        }
      }
      setConversations((prev) => {
        const remaining = prev.filter((c) => c.id !== id);
        if (!supabase) saveConversations(remaining, userId);
        if (activeId === id) {
          if (remaining.length > 0) {
            setActiveId(remaining[0].id);
            setModel(remaining[0].model);
          } else {
            setActiveId(null);
          }
        }
        return remaining;
      });
    },
    [activeId, userId, conversations],
  );

  /**
   * Persist the user's message and stream the assistant response for the active thread.
   * Persistence and stream lifecycle details live in focused helpers above.
   */
  const sendMessage = useCallback(
    async (text: string, files: File[] = [], uploadOptions: AttachmentUploadOptions = {}) => {
      const prompt = text.trim();
      if (!prompt) throw new Error('Add a message before sending attachments.');

      let conversationId = activeId;
      if (!conversationId) {
        conversationId = await newConversation();
        if (!conversationId) return;
      }
      if (!mountedRef.current) return;

      const userMessage = createMessage('user', prompt);
      const storedUserMessage = await persistOutgoingUserMessage({
        userId,
        conversationId,
        message: userMessage,
        prompt,
        files,
        uploadOptions,
      });

      setConversations((previous) => {
        const next = previous.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                messages: [...conversation.messages, storedUserMessage],
                updatedAt: Date.now(),
                title:
                  conversation.messages.length === 0
                    ? generateTitle(prompt)
                    : conversation.title,
              }
            : conversation,
        );
        if (!supabase) saveConversations(next, userId);
        return next;
      });

      if (!mountedRef.current) return;
      const conversation = conversations.find((item) => item.id === conversationId);
      if (conversation && conversation.messages.length === 0) {
        const title = generateTitle(text);
        if (supabase) {
          await supabase
            .from('conversations')
            .update({ title, updated_at: new Date().toISOString() })
            .eq('id', conversationId);
        }
      }

      if (!mountedRef.current) return;
      await streamAssistantResponse({
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
      });
    },
    [activeId, model, newConversation, conversations, userId],
  );

  /**
   * Change the selected model and update the active conversation in UI state.
   * Persist locally without Supabase; otherwise construct a remote update without
   * awaiting it or inspecting its result.
   */
  const changeModel = useCallback(
    (m: ModelId) => {
      setModel(m);
      if (activeId) {
        setConversations((prev) => {
          const next = prev.map((c) =>
            c.id === activeId ? { ...c, model: m } : c,
          );
          if (!supabase) saveConversations(next, userId);
          return next;
        });
        if (supabase) {
          supabase
            .from('conversations')
            .update({ model: m })
            .eq('id', activeId);
        }
      }
    },
    [activeId, userId],
  );

  /** Export a portable TAR bundle containing the transcript, manifest, and original attachment bytes. */
  const exportThread = useCallback(async () => {
    const conv = conversations.find((c) => c.id === activeId);
    if (!conv || conv.messages.length === 0) return;
    const title = conv.title || 'RyanAI thread';
    let md = '# ' + title + '\n\n> Exported from RyanAI · Autonomous Reasoning Engine\n> Model: ' + modelMeta(conv.model).label + '\n\n';
    const manifestMessages: Array<Record<string, unknown>> = [];
    const archiveEntries: Array<{ path: string; data: Uint8Array }> = [];

    for (const message of conv.messages) {
      md += '## ' + (message.role === 'user' ? 'Operator' : 'RyanAI (' + modelMeta(message.model).label + ')') + '\n\n' + message.content + '\n\n';
      if (message.steps?.length) {
        md += '<details><summary>Tool trace (' + message.steps.length + ')</summary>\n\n';
        message.steps.forEach((step) => {
          md += '- **' + step.type + '** **' + step.name + '** → ' + (step.result || JSON.stringify(step.args)) + '\n';
        });
        md += '\n</details>\n\n';
      }
      md += '---\n\n';

      const exportedAttachments: Array<Record<string, unknown>> = [];
      for (const attachment of message.attachments ?? []) {
        if (!supabase) throw new Error('Cloud storage must be configured to export original attachment files.');
        const signed = await signConversationAttachment(supabase, userId, conv.id, attachment);
        if (!signed.url) throw new Error('Unable to create a download link for ' + attachment.name + '.');
        const response = await fetch(signed.url);
        if (!response.ok) throw new Error('Unable to download ' + attachment.name + ' (HTTP ' + response.status + ').');
        const data = new Uint8Array(await response.arrayBuffer());
        if (data.byteLength !== attachment.size) {
          throw new Error('Attachment size verification failed for ' + attachment.name + '.');
        }
        const archivePath = 'attachments/' + attachment.id + '-' + safeAttachmentName(attachment.name).slice(0, 32);
        archiveEntries.push({ path: archivePath, data });
        exportedAttachments.push({
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          size: attachment.size,
          archivePath,
        });
      }
      manifestMessages.push({
        id: message.id,
        role: message.role,
        content: message.content,
        model: message.model ?? null,
        timestamp: message.timestamp,
        steps: message.steps ?? [],
        attachments: exportedAttachments,
      });
    }

    archiveEntries.unshift(
      { path: 'conversation.md', data: new TextEncoder().encode(md) },
      {
        path: 'manifest.json',
        data: new TextEncoder().encode(JSON.stringify({
          format: 'ryanai-conversation-archive',
          version: 1,
          exportedAt: new Date().toISOString(),
          conversation: { id: conv.id, title, model: conv.model },
          messages: manifestMessages,
        }, null, 2)),
      },
    );

    const blob = createTarArchive(archiveEntries);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = (title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40) || 'ryanai-thread') + '.tar';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [activeId, conversations, userId]);

  /** Validate and import a RyanAI TAR bundle into a new, account-owned conversation. */
  const importThread = useCallback(async (file: File) => {
    const client = supabase;
    if (!client) {
      throw new Error('Private cloud storage must be configured before importing conversations.');
    }

    const archive = await prepareConversationArchive(file);
    const { data: created, error: createError } = await client
      .from('conversations')
      .insert({ title: archive.title, model: archive.model, user_id: userId })
      .select()
      .single();
    if (createError || !created) {
      throw new Error(createError?.message || 'Unable to create the imported conversation.');
    }

    const uploaded: MessageAttachment[] = [];
    try {
      const importedMessages = await persistImportedConversationMessages(
        client,
        userId,
        created.id,
        archive.messages,
        uploaded,
      );
      const updatedAt = Math.max(
        Date.now(),
        ...importedMessages.map((message) => message.timestamp),
      );
      const { error: updateError } = await client
        .from('conversations')
        .update({ updated_at: new Date(updatedAt).toISOString() })
        .eq('id', created.id)
        .eq('user_id', userId);
      if (updateError) {
        throw new Error(updateError.message || 'Unable to finalize the imported conversation.');
      }

      const importedConversation: Conversation = {
        id: created.id,
        title: archive.title,
        model: archive.model,
        messages: importedMessages,
        createdAt: new Date(created.created_at).getTime(),
        updatedAt,
      };
      setConversations((previous) => [importedConversation, ...previous]);
      setActiveId(created.id);
      setModel(archive.model);
      setLiveText('');
      setLiveSteps([]);
      setLeftOpen(false);
    } catch (error) {
      await rollbackImportedConversation(client, userId, created.id, uploaded);
      throw error;
    }
  }, [userId]);

  // Voice command handler
  /** Dispatch recognized voice command names to workspace actions; args and unknown names are ignored. */
  const handleVoiceCommand = useCallback(
    (command: string, args: string) => {
      void args;
      switch (command) {
        case 'new_thread':
          newConversation();
          break;
        case 'switch_gemini':
          changeModel('gemini-3.1-pro');
          break;
        case 'switch_claude':
          changeModel('claude-sonnet-4.6');
          break;
        case 'switch_gpt':
          changeModel('gpt-5.4');
          break;
        case 'export':
          exportThread();
          break;
        case 'open_memory':
          setMemoryOpen(true);
          break;
        case 'open_about':
          setAboutOpen(true);
          break;
        case 'open_github':
          setGithubOpen(true);
          break;
        case 'stop':
          voiceStopRef.current();
          break;
      }
    },
    [newConversation, changeModel, exportThread],
  );

  /**
   * Submit a nonempty final transcript unless it starts with a known command keyword.
   * Interim transcripts and command-like text are ignored here.
   */
  const handleVoiceTranscript = useCallback(
    (text: string, isFinal: boolean) => {
      if (!isFinal) return;
      const lower = text.toLowerCase().trim();
      const isCommand = Object.values(VOICE_COMMANDS).some((def) =>
        def.keywords.some((kw) => lower.startsWith(kw)),
      );
      if (!isCommand && text.trim()) {
        sendMessage(text.trim());
      }
    },
    [sendMessage],
  );

  const voice = useVoiceRecognition({
    onTranscript: handleVoiceTranscript,
    onCommand: handleVoiceCommand,
    language: voiceLanguage,
  });
  useEffect(() => {
    voiceStopRef.current = voice.stop;
  }, [voice.stop]);

  const lastAssistant = [...activeMessages]
    .reverse()
    .find((m) => m.role === 'assistant');
  const traceSteps = sending ? liveSteps : (lastAssistant?.steps ?? []);

  const sidebar = (
    <Sidebar
      conversations={conversations}
      activeId={activeId}
      onSelect={selectConversation}
      onNew={newConversation}
      onDelete={deleteConversation}
      onAbout={() => setAboutOpen(true)}
      onMemory={() => setMemoryOpen(true)}
      onConsole={() => setConsoleOpen(true)}
      onGithub={() => setGithubOpen(true)}
    />
  );

  const telemetry = (
    <TelemetryPanel status={status} steps={traceSteps} sending={sending} />
  );

  // Updated chatPanelProps utilizing explicit union type casting
  const refreshAttachmentUrl = useCallback(async (attachment: MessageAttachment) => {
    if (!supabase || !activeId) {
      throw new Error('Private cloud storage is unavailable for this conversation.');
    }
    const refreshed = await signConversationAttachment(supabase, userId, activeId, attachment);
    if (!refreshed.url) throw new Error('A secure attachment link could not be created.');
    return refreshed.url;
  }, [activeId, userId]);

  const chatPanelProps = {
    messages: activeMessages,
    model,
    onModelChange: changeModel,
    sending,
    liveText,
    liveModel,
    onSend: sendMessage,
    attachmentsEnabled: Boolean(supabase),
    onExport: exportThread,
    onImport: importThread,
    onRefreshAttachment: refreshAttachmentUrl,
    activeTitle: activeConversation?.title,
    onOpenLeft: () => setLeftOpen(true),
    onOpenRight: () => setRightOpen(true),
    voiceState: voice.state as 'listening' | 'processing' | 'idle',
    voiceInterim: voice.interimText,
    voiceSupported: voice.isSupported,
    onVoiceToggle: voice.toggle,
    onVoiceCommand: handleVoiceCommand,
  };

  return (
    <div className="h-[calc(100dvh-10rem)] min-h-[26rem] hud-radial hud-grid hud-scanlines relative overflow-hidden">
      <CodeRain />
      <RyanVoiceStream language={voiceLanguage} />

      {/* Desktop layout */}
      <div className="h-full hidden lg:grid lg:grid-cols-12 gap-4 p-4 relative z-10">
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="lg:col-span-3 h-full"
        >
          {sidebar}
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="lg:col-span-6 h-full"
        >
          <ChatPanel {...chatPanelProps} />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="lg:col-span-3 h-full"
        >
          {telemetry}
        </motion.div>
      </div>

      {/* Mobile layout */}
      <div className="h-full lg:hidden flex flex-col relative z-10">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-cyan-500/15 glass">
          <button
            type="button"
            onClick={(event) => { leftDrawerTriggerRef.current = event.currentTarget; setLeftOpen(true); }}
            aria-label="Open conversation history"
            aria-expanded={leftOpen}
            className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-cyan-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
          >
            <Menu size={18} />
          </button>
          <div className="flex items-center gap-2 flex-1">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-400 to-cyan-600 flex items-center justify-center">
              <span className="font-display font-black text-ink-950 text-xs">
                R
              </span>
            </div>
            <span className="font-display font-bold text-cyan-300 text-sm tracking-wider">
              RYANAI
            </span>
          </div>
          <div className="flex items-center gap-2">
            {userEmail && (
              <span className="text-[10px] text-ink-500 font-mono hidden sm:inline">
                {userFullName || userEmail}
              </span>
            )}
            <button
              type="button"
              onClick={onSignOut}
              aria-label="Sign out"
              className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-rose-500/10 hover:text-rose-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
            >
              <LogOut size={16} />
            </button>
          </div>
          <button
            type="button"
            onClick={(event) => { rightDrawerTriggerRef.current = event.currentTarget; setRightOpen(true); }}
            aria-label="Open live telemetry"
            aria-expanded={rightOpen}
            className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-cyan-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
          >
            <Menu size={18} className="rotate-180" />
          </button>
        </div>
        <div className="flex-1 p-3">
          <ChatPanel {...chatPanelProps} />
        </div>
      </div>

      {/* Mobile drawers */}
      <AnimatePresence>
        {leftOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="presentation"
            className="fixed inset-0 z-40 lg:hidden"
            onClick={() => setLeftOpen(false)}
          >
            <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" />
            <motion.div
              ref={leftDrawerRef}
              role="dialog"
              aria-modal="true"
              aria-label="Conversation history"
              tabIndex={-1}
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'tween', duration: 0.25 }}
              onClick={(e) => e.stopPropagation()}
              className="absolute bottom-0 left-0 top-0 w-[min(88vw,20rem)] p-3"
            >
              <button
                type="button"
                onClick={() => setLeftOpen(false)}
                ref={leftDrawerCloseRef}
                aria-label="Close conversation history"
                className="absolute right-5 top-5 z-30 rounded-lg bg-slate-950/90 px-2.5 py-1.5 text-xs text-cyan-100 shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
              >Close</button>
              {sidebar}
            </motion.div>
          </motion.div>
        )}
        {rightOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="presentation"
            className="fixed inset-0 z-40 lg:hidden"
            onClick={() => setRightOpen(false)}
          >
            <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" />
            <motion.div
              ref={rightDrawerRef}
              role="dialog"
              aria-modal="true"
              aria-label="Live telemetry"
              tabIndex={-1}
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.25 }}
              onClick={(e) => e.stopPropagation()}
              className="absolute bottom-0 right-0 top-0 w-[min(88vw,20rem)] p-3"
            >
              <button
                type="button"
                onClick={() => setRightOpen(false)}
                ref={rightDrawerCloseRef}
                aria-label="Close live telemetry"
                className="absolute right-5 top-5 z-30 rounded-lg bg-slate-950/90 px-2.5 py-1.5 text-xs text-cyan-100 shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
              >Close</button>
              {telemetry}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modals */}
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <MemoryVault
        userId={userId}
        open={memoryOpen}
        onClose={() => setMemoryOpen(false)}
      />
      <Modal
        open={consoleOpen}
        onClose={() => setConsoleOpen(false)}
        title="Inference Console"
        icon={<Terminal size={16} />}
      >
        <div className="h-[26rem] -m-2 overflow-hidden rounded-lg">
          <ChatInterface />
        </div>
      </Modal>
      <GithubModal
        open={githubOpen}
        onClose={() => setGithubOpen(false)}
      />
    </div>
  );
}
