import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Activity, AlertCircle, BrainCircuit, Download, File, Mail, MessageCircle, Paperclip, Phone, RefreshCw, Send, ShieldCheck, X } from 'lucide-react';
import {
  getCommsAttachmentDownloadUrl, getCommsAttachmentStatuses, getCommsConversations,
  getCommsStatus, prepareCommsAttachments, sendCommsMessage, uploadCommsAttachment,
  type CommsAttachment, type CommsChannel, type CommsConversation, type CommsStatus,
} from '@/lib/commsApi';

const channels: { id: CommsChannel; label: string; icon: typeof MessageCircle }[] = [
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { id: 'sms', label: 'SMS', icon: MessageCircle },
  { id: 'voice', label: 'Voice call', icon: Phone },
  { id: 'email', label: 'Email', icon: Mail },
];

const statusChannels = [
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { id: 'sms', label: 'SMS', icon: MessageCircle },
  { id: 'voice', label: 'Voice call', icon: Phone },
  { id: 'email', label: 'Outbound email (SMTP)', icon: Mail },
  { id: 'inboundEmail', label: 'Inbound email (Resend)', icon: Mail },
  { id: 'attachments', label: 'Secure attachments', icon: Paperclip },
  { id: 'openai', label: 'Central OpenAI API', icon: BrainCircuit },
];

const ACCEPTED_FILES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4', 'video/webm',
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'application/pdf',
  'text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/xml',
  'text/javascript', 'text/typescript', 'text/x-python', 'text/x-go', 'text/x-rust',
  'text/x-java', 'text/css', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip',
].join(',');

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString();
}

function sizeLabel(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MiB` : `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}

function scanLabel(status: string) {
  if (status === 'clean') return 'Security scan passed';
  if (status === 'infected' || status === 'quarantined') return 'Quarantined';
  if (status === 'pending') return 'Security scan pending';
  return 'Not available';
}

export default function CommunicationsCenter() {
  const [status, setStatus] = useState<CommsStatus | null>(null);
  const [conversations, setConversations] = useState<CommsConversation[]>([]);
  const [activeId, setActiveId] = useState('');
  const [channel, setChannel] = useState<CommsChannel>('whatsapp');
  const [recipient, setRecipient] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conversationSearch, setConversationSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState<'all' | CommsChannel>('all');

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextConversations] = await Promise.all([
        getCommsStatus(), getCommsConversations(),
      ]);
      setStatus(nextStatus);
      setConversations(nextConversations);
      setActiveId((current) => current && nextConversations.some((item) => item.id === current)
        ? current : nextConversations[0]?.id ?? '');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Communications could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), 15000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [refresh]);

  const active = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) ?? null,
    [conversations, activeId],
  );
  const visibleConversations = useMemo(() => {
    const query = conversationSearch.trim().toLowerCase();
    return conversations.filter((conversation) => {
      if (channelFilter !== 'all' && conversation.channel !== channelFilter) return false;
      if (!query) return true;
      return conversation.externalAddress.toLowerCase().includes(query)
        || conversation.messages.some((item) => item.body.toLowerCase().includes(query)
          || item.attachments?.some((attachment) => attachment.name.toLowerCase().includes(query)));
    });
  }, [conversations, conversationSearch, channelFilter]);

  const attachmentsEnabled = status?.channels?.attachments === true;
  const attachmentsAllowed = attachmentsEnabled && channel !== 'voice';

  async function openAttachment(attachment: CommsAttachment) {
    if (attachment.status !== 'clean') return;
    try {
      const url = await getCommsAttachmentDownloadUrl(attachment.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The attachment could not be opened.');
    }
  }

  function selectFiles(files: FileList | null) {
    if (!files) return;
    const next = Array.from(files);
    const total = next.reduce((sum, file) => sum + file.size, 0);
    if (next.length > 8) {
      setError('Choose no more than 8 attachments.');
      return;
    }
    if (new Set(next.map(file => file.name.normalize('NFKC').toLowerCase())).size !== next.length) {
      setError('Attachment file names must be unique within one message.');
      return;
    }
    if (next.some(file => !ACCEPTED_FILES.split(',').includes(file.type) || file.size <= 0 || file.size > 20 * 1024 * 1024)) {
      setError('Each file must be a supported type and no larger than 20 MiB.');
      return;
    }
    if (total > 40 * 1024 * 1024) {
      setError('Combined attachments cannot exceed 40 MiB.');
      return;
    }
    setError('');
    setSelectedFiles(next);
    setIdempotencyKey(crypto.randomUUID());
  }

  async function uploadAndWaitForClean(files: File[]): Promise<string[]> {
    const prepared = await prepareCommsAttachments({
      channel: channel as Exclude<CommsChannel, 'voice'>,
      message: message.trim(),
      idempotencyKey,
      files: files.map(file => ({ name: file.name, mimeType: file.type, size: file.size })),
      ...(recipient.trim() ? { recipient: recipient.trim() } : {}),
      ...(channel === 'email' && subject.trim() ? { subject: subject.trim() } : {}),
    });
    const intents = prepared.attachments;
    if (!intents.length || intents.length !== files.length) throw new Error('The secure upload reservation was incomplete.');

    let current = await getCommsAttachmentStatuses(intents.map(item => item.id));
    const byId = new Map(current.map(item => [item.id, item]));
    for (let index = 0; index < intents.length; index += 1) {
      const existing = byId.get(intents[index].id);
      if (existing?.status === 'clean' || existing?.status === 'pending') continue;
      if (existing?.status === 'infected' || existing?.status === 'quarantined') {
        throw new Error(`${existing.name} was quarantined by the security scanner.`);
      }
      await uploadCommsAttachment(intents[index], files[index]);
    }

    for (let attempt = 0; attempt < 24; attempt += 1) {
      current = await getCommsAttachmentStatuses(intents.map(item => item.id));
      const rejected = current.find(item => ['infected', 'quarantined', 'rejected'].includes(item.status));
      if (rejected) throw new Error(`${rejected.name} did not pass the security scan and cannot be sent.`);
      if (current.length === intents.length && current.every(item => item.status === 'clean')) {
        return intents.map(item => item.id);
      }
      await new Promise(resolve => window.setTimeout(resolve, 1250));
    }
    throw new Error('Security scanning is still pending. Your draft is retained; refresh the inbox and retry after the scan completes.');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim() || sending) return;
    setSending(true);
    setError('');
    setNotice('');
    try {
      const attachmentIds = selectedFiles.length ? await uploadAndWaitForClean(selectedFiles) : [];
      const result = await sendCommsMessage({
        channel, message: message.trim(), idempotencyKey,
        ...(recipient.trim() ? { recipient: recipient.trim() } : {}),
        ...(channel === 'email' && subject.trim() ? { subject: subject.trim() } : {}),
        ...(attachmentIds.length ? { attachmentIds } : {}),
      });
      setNotice(result.replayed
        ? `Duplicate submission suppressed. Existing request status: ${result.status}. No second provider request was sent.`
        : `${result.channel} request accepted by provider (${result.status}). Delivery is confirmed only by a later provider status callback.`);
      if (!result.replayed || !['dispatching', 'dispatch_unknown'].includes(result.status)) {
        setMessage('');
        setSelectedFiles([]);
        setIdempotencyKey(crypto.randomUUID());
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The message could not be sent.');
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:p-8" aria-labelledby="comms-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-300">Unified communications</p>
          <h1 id="comms-title" className="mt-2 text-2xl font-semibold text-white sm:text-3xl">RyanAI Comms</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">WhatsApp, SMS, voice and email through one authenticated API and durable conversation history.</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/30 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-400/10 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {statusChannels.map(({ id, label, icon: Icon }) => {
          const configured = id === 'openai'
            ? status?.ai?.openai?.status === 'configured_unverified'
            : status?.channels?.[id] === true;
          const value = id === 'attachments'
            ? configured ? 'Enabled · scan-gated' : 'Disabled · scanner required'
            : configured ? 'Configured · unverified' : 'Credentials missing';
          return (
            <div key={id} className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-medium text-slate-200"><Icon className="h-4 w-4 text-cyan-300" />{label}</span>
                <span className={`rounded-full px-2 py-1 text-[10px] ${configured ? 'bg-amber-400/10 text-amber-200' : 'bg-slate-700 text-slate-300'}`}>{value}</span>
              </div>
              <p className="mt-2 text-xs text-slate-500">{id === 'attachments' ? 'Uploads are enabled only when private storage and malware scanning are both active.' : 'Configuration presence only; live connectivity is not implied.'}</p>
            </div>
          );
        })}
      </div>

      {!attachmentsEnabled && <div role="note" aria-label="Attachment availability" className="flex items-start gap-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.04] p-4 text-sm text-amber-100">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
        <div><p className="font-semibold">Secure attachments are currently unavailable.</p><p className="mt-1 text-xs leading-5 text-amber-100/70">The private bucket, owner-linked records and malware scanner must all be enabled. No file is sent or exposed while these controls are unavailable.</p></div>
      </div>}
      {error && <p role="alert" className="rounded-lg border border-rose-400/30 bg-rose-950/30 p-3 text-sm text-rose-200">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-cyan-400/20 bg-cyan-950/20 p-3 text-sm text-cyan-100">{notice}</p>}

      <div className="grid min-h-[560px] gap-4 xl:grid-cols-[minmax(260px,0.8fr)_minmax(0,2fr)]">
        <aside className="overflow-hidden rounded-xl border border-white/10 bg-slate-900/60">
          <div className="space-y-3 border-b border-white/10 p-4">
            <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold text-white">Conversations</h2><span className="text-xs text-slate-500">{visibleConversations.length} / {conversations.length}</span></div>
            <label className="block text-[11px] text-slate-500">Search messages or addresses<input value={conversationSearch} onChange={event => setConversationSearch(event.target.value)} maxLength={120} placeholder="Search this inbox…" className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white placeholder:text-slate-600" /></label>
            <label className="block text-[11px] text-slate-500">Channel<select value={channelFilter} onChange={event => setChannelFilter(event.target.value as 'all' | CommsChannel)} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white"><option value="all">All channels</option>{channels.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          </div>
          <div className="max-h-[680px] overflow-y-auto">
            {loading && <p className="p-4 text-sm text-slate-400">Loading history…</p>}
            {!loading && conversations.length === 0 && <p className="p-4 text-sm text-slate-500">No persisted conversations yet. New inbound and outbound events will appear here.</p>}
            {!loading && conversations.length > 0 && visibleConversations.length === 0 && <p className="p-4 text-sm text-slate-500">No conversations match these filters.</p>}
            {visibleConversations.map((conversation) => (
              <button key={conversation.id} type="button" onClick={() => setActiveId(conversation.id)} className={`block w-full border-b border-white/5 p-4 text-left hover:bg-white/5 ${activeId === conversation.id ? 'bg-cyan-400/10' : ''}`}>
                <span className="flex items-center justify-between gap-2 text-xs uppercase tracking-wide text-cyan-200">
                  {conversation.channel}<span className="truncate text-slate-500 normal-case">{conversation.externalAddress}</span>
                </span>
                <span className="mt-2 block truncate text-sm text-slate-200">{conversation.messages.at(-1)?.body ?? 'No message content'}</span>
                <span className="mt-1 block text-[11px] text-slate-500">{dateLabel(conversation.updatedAt)}</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-slate-900/60">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-white">{active ? active.channel.toUpperCase() : 'Conversation timeline'}</h2>
              <p className="text-xs text-slate-500">{active?.externalAddress ?? 'Select a conversation to inspect its history'}</p>
            </div>
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400"><ShieldCheck className="h-3.5 w-3.5 text-cyan-300" /> Owner-only history</span>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {active?.messages.map((item) => (
              <div key={item.id} className={`flex ${item.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                <article className={`max-w-[85%] rounded-xl border p-3 ${item.direction === 'outbound' ? 'border-cyan-400/20 bg-cyan-950/40' : 'border-white/10 bg-slate-800/70'}`}>
                  <p className="whitespace-pre-wrap break-words text-sm text-slate-100">{item.body}</p>
                  {item.attachments?.length ? <div className="mt-3 space-y-2 border-t border-white/10 pt-2">
                    {item.attachments.map(attachment => <div key={attachment.id} className="flex items-center gap-2 text-xs">
                      <File className="h-4 w-4 shrink-0 text-cyan-300" />
                      <span className="min-w-0 flex-1 truncate text-slate-200">{attachment.name} · {sizeLabel(attachment.size)}</span>
                      <span className="text-[10px] text-slate-500">{scanLabel(attachment.status)}</span>
                      <button type="button" disabled={attachment.status !== 'clean'} onClick={() => void openAttachment(attachment)} aria-label={`Download ${attachment.name}`} className="rounded p-1 text-cyan-200 hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-30"><Download className="h-4 w-4" /></button>
                    </div>)}
                  </div> : null}
                  <p className="mt-2 flex items-center gap-2 text-[10px] text-slate-400"><Activity className="h-3 w-3" />{item.direction} · {item.status} · {dateLabel(item.createdAt)}</p>
                </article>
              </div>
            ))}
            {!active && <p className="text-sm text-slate-500">Conversation messages will be shown here after the first event is persisted.</p>}
          </div>

          <form onSubmit={submit} className="space-y-3 border-t border-white/10 bg-slate-950/50 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-slate-400">Channel
                <select disabled={sending} value={channel} onChange={(event) => { setChannel(event.target.value as CommsChannel); setIdempotencyKey(crypto.randomUUID()); }} className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white">
                  {channels.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-xs text-slate-400">Recipient (optional; defaults to owner)
                <input disabled={sending} value={recipient} onChange={(event) => { setRecipient(event.target.value); setIdempotencyKey(crypto.randomUUID()); }} placeholder={channel === 'email' ? 'name@example.com' : '+27…'} className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white" />
              </label>
            </div>
            {channel === 'email' && <label className="block space-y-1 text-xs text-slate-400">Subject
              <input disabled={sending} value={subject} onChange={(event) => { setSubject(event.target.value); setIdempotencyKey(crypto.randomUUID()); }} maxLength={180} placeholder="RyanAI update" className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white" />
            </label>}
            <label className="block space-y-1 text-xs text-slate-400">Message
              <textarea disabled={sending} value={message} onChange={(event) => { setMessage(event.target.value); setIdempotencyKey(crypto.randomUUID()); }} required maxLength={4000} rows={3} placeholder="Write a message for RyanAI to send…" className="w-full resize-y rounded-lg border border-white/10 bg-slate-900 p-3 text-sm text-white placeholder:text-slate-600" />
            </label>
            {attachmentsAllowed && <div className="space-y-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5">
                <Paperclip className="h-4 w-4 text-cyan-300" /> Attach files
                <input type="file" disabled={sending} multiple accept={ACCEPTED_FILES} className="sr-only" onChange={event => selectFiles(event.target.files)} />
              </label>
              {selectedFiles.length > 0 && <div className="space-y-1 rounded-lg border border-white/10 p-2">
                {selectedFiles.map((file, index) => <div key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center gap-2 text-xs text-slate-300">
                  <File className="h-3.5 w-3.5 text-cyan-300" /><span className="min-w-0 flex-1 truncate">{file.name} · {sizeLabel(file.size)}</span>
                  <button type="button" disabled={sending} onClick={() => { setSelectedFiles(items => items.filter((_, itemIndex) => itemIndex !== index)); setIdempotencyKey(crypto.randomUUID()); }} aria-label={`Remove ${file.name}`} className="rounded p-1 text-slate-400 hover:text-rose-300"><X className="h-3.5 w-3.5" /></button>
                </div>)}
                <p className="text-[10px] text-slate-500">Up to 8 files · 20 MiB each · 40 MiB total · malware scan required before dispatch.</p>
              </div>}
            </div>}
            {attachmentsEnabled && channel === 'voice' && <p className="text-[11px] text-slate-500">Attachments are not supported for voice calls.</p>}
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-1 text-[11px] text-slate-500"><AlertCircle className="h-3 w-3" /> Provider acceptance is not a delivery receipt. Status callbacks update the timeline.</p>
              <button type="submit" disabled={sending || !message.trim()} className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50">
                <Send className="h-4 w-4" />{sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
