import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { Activity, AlertCircle, Brain, CheckCircle2, CircleDot, Cpu, Database, LoaderCircle, Network, Send, ShieldAlert, Wifi } from 'lucide-react';
import { usePlatformHealth } from '@/hooks/usePlatformHealth';
import { API_BASE_URL } from '@/lib/apiBaseUrl';
import { API_ROUTES } from '@/config/core';
import { DEFAULT_MODEL } from '@/lib/models';

type BrainId = 'primary' | 'secondary' | 'logic';
interface BrainHealth { brain: BrainId; model?: string; status: string; latencyMs?: number | null; lastError?: string | null; }
interface BrainHealthResponse { brains?: BrainHealth[]; }
interface HandoffSnapshot { fromAgent: string; toAgent: string; status: string; startedAt?: string; completedAt?: string | null; error?: string | null; }
interface StreamEvent { status?: 'processing' | 'complete'; message?: string; result?: string; error?: string; handoffs?: HandoffSnapshot[]; runId?: string; runStatus?: string; }
const labels: Record<BrainId, string> = { primary: 'NVIDIA', secondary: 'Qwen', logic: 'Logic' };
const regions = ['Perception', 'Planning', 'Reasoning', 'Memory', 'Verification', 'Execution'] as const;

/** Cockpit renders only provider health and activity actually reported by the API. */
export default function RyanAICockpit() {
  const { health, error: healthError, checking, refresh } = usePlatformHealth();
  const [prompt, setPrompt] = useState('');
  const [answer, setAnswer] = useState('');
  const [requestError, setRequestError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [activity, setActivity] = useState('No reasoning request is running.');
  const [brains, setBrains] = useState<BrainHealth[]>([]);
  const [brainError, setBrainError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [handoffs, setHandoffs] = useState<HandoffSnapshot[]>([]);

  const refreshBrains = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await authenticatedFetch(API_BASE_URL + '/api/agent/ops/brains', {
        method: 'GET', headers: { Accept: 'application/json' }, signal,
      });
      if (!response.ok) throw new Error('Brain health request failed (HTTP ' + response.status + ').');
      const payload = await response.json() as BrainHealthResponse;
      setBrains(Array.isArray(payload.brains) ? payload.brains : []);
      setCheckedAt(new Date().toISOString());
      setBrainError(null);
    } catch (cause) {
      if (signal?.aborted) return;
      setBrainError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // Defer the initial state update until after the effect has committed.
    const initialRefresh = window.setTimeout(() => {
      void refreshBrains(controller.signal);
    }, 0);
    const timer = window.setInterval(() => void refreshBrains(), 20000);
    return () => {
      controller.abort();
      window.clearTimeout(initialRefresh);
      window.clearInterval(timer);
    };
  }, [refreshBrains]);

  async function runReasoning(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const objective = prompt.trim();
    if (!objective || sending) return;
    setSending(true);
    setRequestError(null);
    setAnswer('');
    setHandoffs([]);
    setActivity('Opening authenticated reasoning stream…');
    try {
      const response = await authenticatedFetch(API_BASE_URL + API_ROUTES.streamPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ prompt: objective, model: DEFAULT_MODEL }),
      });
      if (!response.ok) throw new Error('Reasoning request failed (HTTP ' + response.status + ').');
      if (!response.body) throw new Error('The reasoning stream is unavailable in this browser.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let completed = false;
      const consume = (frame: string) => {
        const line = frame.split('\n').find((entry) => entry.startsWith('data:'));
        if (!line) return;
        const raw = line.slice(5).trim();
        if (!raw) return;
        const message = JSON.parse(raw) as StreamEvent;
        if (message.status === 'processing') {
          setActivity(message.message || 'Orchestrator is processing.');
          if (Array.isArray(message.handoffs)) setHandoffs(message.handoffs);
        }
        if (message.status === 'complete') {
          if (!message.result) throw new Error('RyanAI completed without returning a response.');
          setAnswer(message.result);
          if (Array.isArray(message.handoffs)) setHandoffs(message.handoffs);
          setActivity('Reasoning stream completed successfully.');
          completed = true;
        }
        if (message.error) throw new Error(message.error);
      };
      while (true) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value, { stream: !chunk.done });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';
        frames.forEach(consume);
        if (chunk.done) break;
      }
      if (buffer.trim()) consume(buffer);
      if (!completed) throw new Error('Reasoning stream ended before a completion event was received.');
    } catch (cause) {
      setRequestError(cause instanceof Error ? cause.message : String(cause));
      setActivity('Reasoning request failed.');
    } finally {
      setSending(false);
      void refreshBrains();
    }
  }

  const byId = new Map(brains.map((brain) => [brain.brain, brain]));
  const healthyCount = brains.filter((brain) => brain.status === 'HEALTHY').length;

  return (
    <section className="mx-auto max-w-7xl px-4 py-7 sm:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">Neural operations interface</p>
          <h1 className="mt-2 text-3xl font-bold text-white">RyanAI Command Cockpit</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">Live service health, authenticated reasoning activity and independently reported brain readiness.</p>
        </div>
        <div className={'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm ' + (health?.status === 'online' ? 'border-emerald-300/30 text-emerald-200' : 'border-rose-300/30 text-rose-200')}>
          <Activity className="h-4 w-4" />
          {health?.status === 'online' ? 'API online' : checking ? 'Checking API' : 'API unavailable'}
        </div>
      </header>
      {healthError && <Alert tone="error">{healthError}</Alert>}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ServiceValue icon={<Database className="h-4 w-4" />} label="PostgreSQL" value={reported(health?.services?.database)} />
        <ServiceValue icon={<Wifi className="h-4 w-4" />} label="Redis" value={reported(health?.services?.redis)} />
        <ServiceValue icon={<Cpu className="h-4 w-4" />} label="Reasoning graph" value={health?.activeGraph || 'Not reported'} />
        <ServiceValue icon={<ShieldAlert className="h-4 w-4" />} label="Provider readiness" value={brains.length ? healthyCount + '/3 verified healthy' : 'Not reported'} />
      </div>

      <section className="mt-7 rounded-2xl border border-cyan-400/20 bg-slate-950/80 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-xs uppercase tracking-[0.18em] text-cyan-300">Neural core network</p><h2 className="mt-1 text-xl font-semibold text-white">Three-brain status</h2></div>
          <span className="text-xs text-slate-500">{checkedAt ? 'Health snapshot ' + new Date(checkedAt).toLocaleTimeString() : 'Awaiting provider health snapshot'}</span>
        </div>
        {brainError && <Alert tone="warning">{brainError}</Alert>}
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {(['primary', 'secondary', 'logic'] as BrainId[]).map((id) => <BrainCard key={id} id={id} health={byId.get(id)} activity={brainActivity(id, handoffs)} />)}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-400">
          <Network className="h-4 w-4 text-cyan-300" />
          <span>Handoff states below are read from persisted PostgreSQL execution records.</span>
          <span className="text-slate-500">No connection is shown unless the worker records it.</span>
        </div>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <form onSubmit={runReasoning} className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-7">
          <label htmlFor="cockpit-prompt" className="flex items-center gap-2 font-semibold text-white"><Brain className="h-5 w-5 text-cyan-300" /> Run a reasoning request</label>
          <textarea id="cockpit-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={20000} rows={4} placeholder="Describe the question or task for RyanAI…" className="mt-4 w-full resize-y rounded-xl border border-white/10 bg-slate-950 p-4 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-300/50" />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-slate-500">{prompt.length.toLocaleString()} / 20,000 characters</span>
            <button type="submit" disabled={sending || !prompt.trim() || !health || health.status !== 'online'} className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50">
              {sending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {sending ? 'Reasoning…' : 'Run request'}
            </button>
          </div>
        </form>
        <aside className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-white"><Activity className="h-4 w-4 text-cyan-300" /> Live operation</div>
          <div className="mt-4 flex items-start gap-3"><span className={'mt-1 inline-flex h-2.5 w-2.5 rounded-full ' + (sending ? 'animate-pulse bg-cyan-300' : answer ? 'bg-emerald-400' : requestError ? 'bg-rose-400' : 'bg-slate-600')} /><p aria-live="polite" className="text-sm leading-6 text-slate-300">{activity}</p></div>
          <p className="mt-4 border-t border-white/10 pt-4 text-xs leading-5 text-slate-500">Brain activity and handoff states reflect persisted worker transitions. Six-region activation and live capacity metrics remain unavailable until the backend reports them.</p>
          <div className="mt-4 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Persisted brain handoffs</p>
            {handoffs.length ? <ul className="mt-2 space-y-2">{handoffs.map((handoff, index) => <li key={handoff.fromAgent + '-' + handoff.toAgent + '-' + index} className="flex items-center justify-between gap-3 text-xs"><span className="text-slate-300">{agentLabel(handoff.fromAgent)} → {agentLabel(handoff.toAgent)}</span><span className={handoff.status === 'completed' ? 'text-emerald-300' : handoff.status === 'failed' ? 'text-rose-300' : handoff.status === 'running' ? 'text-cyan-300' : 'text-slate-500'}>{handoff.status}</span></li>)}</ul> : <p className="mt-2 text-xs text-slate-500">No handoff transitions reported for this request.</p>}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <Metric label="CPU / GPU" value="Not reported" /><Metric label="Memory" value="Not reported" /><Metric label="Token rate" value="Not reported" /><Metric label="Queue depth" value="Not reported" />
          </div>
        </aside>
      </section>
      {requestError && <Alert tone="error">{requestError}</Alert>}
      {answer && <article className="mt-4 rounded-2xl border border-cyan-300/20 bg-slate-900/70 p-5 sm:p-7"><h2 className="font-semibold text-cyan-100">RyanAI response</h2><p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-200">{answer}</p></article>}
      <button onClick={() => { void refresh(); void refreshBrains(); }} className="mt-5 text-xs text-slate-500 hover:text-cyan-200">Refresh service and brain health</button>
    </section>
  );
}

function BrainCard({ id, health, activity }: { id: BrainId; health?: BrainHealth; activity: string }) {
  const status = health?.status || 'UNKNOWN';
  const healthy = status === 'HEALTHY';
  const failed = status === 'DEGRADED' || status === 'UNCONFIGURED' || status === 'FAILED';
  const tone = healthy ? 'text-emerald-300' : failed ? 'text-rose-300' : 'text-amber-200';
  const border = healthy ? 'border-emerald-400/25' : failed ? 'border-rose-400/25' : 'border-amber-300/20';
  return (
    <article className={'rounded-xl border ' + border + ' bg-slate-900/80 p-4'}>
      <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 font-semibold text-white"><Brain className={'h-5 w-5 ' + tone} /> {labels[id]}</div><span className={'text-[10px] font-semibold uppercase tracking-wider ' + tone}>{status}</span></div>
      <div className="my-4 flex items-center justify-center"><div className={'relative flex h-24 w-24 items-center justify-center rounded-full border ' + border + ' bg-slate-950 '}><div className={'absolute inset-2 rounded-full border border-dashed ' + (healthy ? 'border-cyan-400/40' : 'border-slate-700')} style={{ animationDuration: '18s' }} /><Brain className={'h-10 w-10 ' + tone} /></div></div>
      <p className="truncate text-xs text-slate-400" title={health?.model}>{health?.model || 'Model not reported'}</p>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs"><span className="text-slate-500">Live execution</span><span className={activity === 'Completed' ? 'text-emerald-300' : activity === 'Failed' ? 'text-rose-300' : activity === 'Processing' ? 'text-cyan-300' : 'text-slate-400'}>{activity}</span></div>
      <div className="mt-2 flex justify-between gap-2 text-xs"><span className="text-slate-500">Last latency</span><span className="text-slate-300">{typeof health?.latencyMs === 'number' ? health.latencyMs + ' ms' : 'Not reported'}</span></div>
      {health?.lastError && <p className="mt-2 text-xs text-rose-300">{health.lastError}</p>}
      <div className="mt-4 border-t border-white/10 pt-3"><p className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">Functional regions · live stage telemetry unavailable</p><div className="grid grid-cols-2 gap-1.5">{regions.map((region) => <div key={region} className="flex items-center gap-1.5 rounded-md bg-slate-950/70 px-2 py-1.5 text-[10px] text-slate-500"><CircleDot className="h-3 w-3 shrink-0" />{region}</div>)}</div></div>
      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-500">{healthy ? <CheckCircle2 className="h-3 w-3 text-emerald-300" /> : <ShieldAlert className="h-3 w-3 text-amber-300" />}{healthy ? 'Provider health verified' : 'Provider requires attention or verification'}</div>
    </article>
  );
}
function agentLabel(agent: string): string {
  if (agent === 'supervisor') return 'Orchestrator';
  if (agent === 'primary') return 'NVIDIA';
  if (agent === 'secondary') return 'Qwen';
  if (agent === 'logic') return 'Logic';
  return 'Unknown agent';
}
function brainActivity(id: BrainId, handoffs: HandoffSnapshot[]): string {
  const relevant = id === 'logic'
    ? handoffs.filter((handoff) => handoff.toAgent === 'logic')
    : handoffs.filter((handoff) => handoff.fromAgent === 'supervisor' && handoff.toAgent === id);
  if (!relevant.length) return 'Not started';
  if (relevant.some((handoff) => handoff.status === 'running')) return 'Processing';
  if (relevant.some((handoff) => handoff.status === 'failed')) return 'Failed';
  if (relevant.every((handoff) => handoff.status === 'completed')) return 'Completed';
  if (relevant.every((handoff) => handoff.status === 'pending')) return 'Queued';
  return 'Waiting';
}
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-slate-950/70 p-2"><div className="text-slate-500">{label}</div><div className="mt-1 font-medium text-slate-300">{value}</div></div>; }
function Alert({ children, tone }: { children: ReactNode; tone: 'error' | 'warning' }) { return <div role="alert" className={'mt-4 flex gap-2 rounded-xl border p-4 text-sm ' + (tone === 'error' ? 'border-rose-400/20 bg-rose-400/5 text-rose-200' : 'border-amber-400/20 bg-amber-400/5 text-amber-200')}><AlertCircle className="h-4 w-4 shrink-0" />{children}</div>; }
function reported(value: boolean | undefined) { return value === true ? 'Healthy' : value === false ? 'Unavailable' : 'Not reported'; }
function ServiceValue({ icon, label, value }: { icon: ReactNode; label: string; value: string }) { return <article className="rounded-xl border border-white/10 bg-slate-900/60 p-4"><div className="flex items-center gap-2 text-xs text-slate-500">{icon}{label}</div><div className="mt-2 text-sm font-semibold text-slate-100">{value}</div></article>; }
