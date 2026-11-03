import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Activity, BrainCircuit, Mail, MessageCircle, Phone, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import {
  getCommsConversations, getCommsStatus, sendCommsMessage,
  type CommsChannel, type CommsConversation, type CommsStatus,
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
  { id: 'openai', label: 'Central OpenAI API', icon: BrainCircuit },
];

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString();
}

export default function CommunicationsCenter() {
  const [status, setStatus] = useState<CommsStatus | null>(null);
  const [conversations, setConversations] = useState<CommsConversation[]>([]);
  const [activeId, setActiveId] = useState('');
  const [channel, setChannel] = useState<CommsChannel>('whatsapp');
  const [recipient, setRecipient] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim() || sending) return;
    setSending(true);
    setError('');
    setNotice('');
    try {
      const result = await sendCommsMessage({
        channel, message: message.trim(),
        ...(recipient.trim() ? { recipient: recipient.trim() } : {}),
        ...(channel === 'email' && subject.trim() ? { subject: subject.trim() } : {}),
      });
      setNotice(`${result.channel} request accepted by provider (${result.status}). Delivery is confirmed only by a later provider status callback.`);
      setMessage('');
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
          return (
            <div key={id} className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-medium text-slate-200"><Icon className="h-4 w-4 text-cyan-300" />{label}</span>
                <span className={`rounded-full px-2 py-1 text-[10px] ${configured ? 'bg-amber-400/10 text-amber-200' : 'bg-slate-700 text-slate-300'}`}>{configured ? 'Configured · unverified' : 'Credentials missing'}</span>
              </div>
              <p className="mt-2 text-xs text-slate-500">Configuration presence only; live connectivity is not implied.</p>
            </div>
          );
        })}
      </div>

      {error && <p role="alert" className="rounded-lg border border-rose-400/30 bg-rose-950/30 p-3 text-sm text-rose-200">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-cyan-400/20 bg-cyan-950/20 p-3 text-sm text-cyan-100">{notice}</p>}

      <div className="grid min-h-[560px] gap-4 xl:grid-cols-[minmax(260px,0.8fr)_minmax(0,2fr)]">
        <aside className="overflow-hidden rounded-xl border border-white/10 bg-slate-900/60">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <h2 className="text-sm font-semibold text-white">Conversations</h2>
            <span className="text-xs text-slate-500">{conversations.length}</span>
          </div>
          <div className="max-h-[680px] overflow-y-auto">
            {loading && <p className="p-4 text-sm text-slate-400">Loading history…</p>}
            {!loading && conversations.length === 0 && <p className="p-4 text-sm text-slate-500">No persisted conversations yet. New inbound and outbound events will appear here.</p>}
            {conversations.map((conversation) => (
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
                  <p className="mt-2 flex items-center gap-2 text-[10px] text-slate-400"><Activity className="h-3 w-3" />{item.direction} · {item.status} · {dateLabel(item.createdAt)}</p>
                </article>
              </div>
            ))}
            {!active && <p className="text-sm text-slate-500">Conversation messages will be shown here after the first event is persisted.</p>}
          </div>

          <form onSubmit={submit} className="space-y-3 border-t border-white/10 bg-slate-950/50 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-slate-400">Channel
                <select value={channel} onChange={(event) => setChannel(event.target.value as CommsChannel)} className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white">
                  {channels.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-xs text-slate-400">Recipient (optional; defaults to owner)
                <input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder={channel === 'email' ? 'name@example.com' : '+27…'} className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white" />
              </label>
            </div>
            {channel === 'email' && <label className="block space-y-1 text-xs text-slate-400">Subject
              <input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={180} placeholder="RyanAI update" className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white" />
            </label>}
            <label className="block space-y-1 text-xs text-slate-400">Message
              <textarea value={message} onChange={(event) => setMessage(event.target.value)} required maxLength={4000} rows={3} placeholder="Write a message for RyanAI to send…" className="w-full resize-y rounded-lg border border-white/10 bg-slate-900 p-3 text-sm text-white placeholder:text-slate-600" />
            </label>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-slate-500">Provider acceptance is not a delivery receipt. Status callbacks update the timeline.</p>
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
