import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Activity, ListChecks, Play, RefreshCw, RotateCw, XCircle } from 'lucide-react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';

interface Handoff {
  fromAgent: string;
  toAgent: string;
  status: string;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
}
interface OperatorTask {
  id: string;
  objective: string;
  status: string;
  createdAt: string;
  completedAt?: string | null;
  error?: string | null;
  attempts?: number;
  maxAttempts?: number;
  handoffs?: Handoff[];
  result?: { synthesis?: string } | string | null;
}

function dateLabel(value?: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Invalid timestamp' : date.toLocaleString();
}
function tone(status: string) {
  switch (status.toLowerCase()) {
    case 'completed': return 'text-emerald-300 border-emerald-300/20';
    case 'failed': case 'cancelled': return 'text-rose-300 border-rose-300/20';
    case 'running': return 'text-cyan-200 border-cyan-300/20';
    default: return 'text-amber-200 border-amber-300/20';
  }
}
function handoffLabel(value: string) {
  if (value === 'supervisor') return 'Orchestrator';
  if (value === 'primary') return 'NVIDIA';
  if (value === 'secondary') return 'Qwen';
  if (value === 'logic') return 'Logic';
  return value;
}

export default function OperatorConsole() {
  const [objective, setObjective] = useState('');
  const [tasks, setTasks] = useState<OperatorTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [dispatching, setDispatching] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [filter, setFilter] = useState('all');
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/api/agent/ops/tasks', { headers: { Accept: 'application/json' } });
      const payload = await response.json() as { tasks?: OperatorTask[]; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Task history is unavailable (' + response.status + ').');
      const nextTasks = Array.isArray(payload.tasks) ? payload.tasks : [];
      setTasks(nextTasks);
      setSelectedId((current) => current && nextTasks.some((task) => task.id === current) ? current : nextTasks[0]?.id ?? '');
      setRefreshedAt(new Date().toISOString());
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load operator task history.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => { await refresh(); if (!active) return; };
    void load();
    const timer = window.setInterval(() => {
      if (active && document.visibilityState === 'visible') void refresh();
    }, 15000);
    const focus = () => { if (active) void refresh(); };
    window.addEventListener('focus', focus);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [refresh]);

  const visibleTasks = useMemo(() => filter === 'all' ? tasks : tasks.filter((task) => task.status === filter), [tasks, filter]);
  const selected = tasks.find((task) => task.id === selectedId) ?? visibleTasks[0] ?? null;
  const counts = useMemo(() => ({
    queued: tasks.filter((task) => task.status === 'queued').length,
    running: tasks.filter((task) => task.status === 'running').length,
    completed: tasks.filter((task) => task.status === 'completed').length,
    failed: tasks.filter((task) => task.status === 'failed').length,
  }), [tasks]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = objective.trim();
    if (value.length < 5 || dispatching) return;
    setDispatching(true);
    setError('');
    setNotice('');
    try {
      const response = await authenticatedFetch('/api/agent/ops/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objective: value }),
      });
      const payload = await response.json() as { success?: boolean; taskId?: string; status?: string; error?: string };
      if (!response.ok || !payload.taskId) throw new Error(payload.error || 'RyanAI could not queue this task.');
      setObjective('');
      setNotice('Task persisted. Queue status: ' + (payload.status || 'queued') + '. Reference: ' + payload.taskId + '.');
      await refresh();
      setSelectedId(payload.taskId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Task dispatch failed.');
    } finally {
      setDispatching(false);
    }
  }

  return (
    <section className="mx-auto max-w-7xl space-y-6 px-5 py-8 sm:px-10" aria-labelledby="operator-title">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Execution workspace</p>
          <h1 id="operator-title" className="mt-2 text-3xl font-bold text-white">RyanAI Operator Console</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Queue authenticated work, inspect durable task lifecycle and review persisted three-brain handoffs. The API stores a task before notifying workers.</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/25 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-300/10 disabled:opacity-50">
          <RefreshCw className={'h-4 w-4 ' + (loading ? 'animate-spin' : '')} /> Refresh queue
        </button>
      </header>

      {error && <p role="alert" className="rounded-lg border border-rose-400/25 bg-rose-950/20 p-3 text-sm text-rose-200">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-cyan-300/20 bg-cyan-950/20 p-3 text-sm text-cyan-100">{notice}</p>}

      <div className="grid gap-3 grid-cols-2 xl:grid-cols-4">
        <QueueMetric label="Queued" value={counts.queued} tone="text-amber-200" />
        <QueueMetric label="Running" value={counts.running} tone="text-cyan-200" />
        <QueueMetric label="Completed" value={counts.completed} tone="text-emerald-300" />
        <QueueMetric label="Failed" value={counts.failed} tone="text-rose-300" />
      </div>

      <form onSubmit={submit} className="space-y-4 rounded-2xl border border-cyan-300/20 bg-slate-900/70 p-5 sm:p-6">
        <div className="flex items-center gap-2"><Play className="h-5 w-5 text-cyan-300" /><h2 className="text-lg font-semibold text-white">Dispatch a durable task</h2></div>
        <label htmlFor="operator-objective" className="block text-sm font-medium text-slate-200">Task objective</label>
        <textarea id="operator-objective" value={objective} onChange={(event) => setObjective(event.target.value)} rows={4} minLength={5} maxLength={20000} required placeholder="Describe the work RyanAI should reason through…" className="w-full resize-y rounded-xl border border-white/10 bg-slate-950 p-4 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-300/50" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-slate-500">{objective.length.toLocaleString()} / 20,000 characters · persisted task queue</span>
          <button type="submit" disabled={dispatching || objective.trim().length < 5} className="inline-flex items-center gap-2 rounded-lg bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50">
            <ListChecks className="h-4 w-4" /> {dispatching ? 'Queueing…' : 'Queue task'}
          </button>
        </div>
        <p className="text-xs leading-5 text-slate-500">Queue acceptance is not task completion. Worker progress, handoffs, retries and terminal results are read from persisted records.</p>
      </form>

      <div className="grid gap-4 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.4fr)]">
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70" aria-labelledby="operator-history-title">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4">
            <div><h2 id="operator-history-title" className="font-semibold text-white">Task history</h2><p className="mt-1 text-xs text-slate-500">{tasks.length} recent user-owned tasks</p></div>
            <select aria-label="Filter tasks" value={filter} onChange={(event) => setFilter(event.target.value)} className="rounded-lg border border-white/10 bg-slate-950 px-2 py-1.5 text-xs text-slate-200">
              <option value="all">All</option><option value="queued">Queued</option><option value="running">Running</option><option value="completed">Completed</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div className="max-h-[620px] overflow-y-auto">
            {loading && <p className="p-4 text-sm text-slate-400">Loading tasks…</p>}
            {!loading && visibleTasks.length === 0 && <p className="p-5 text-sm text-slate-500">No tasks match this view yet.</p>}
            {visibleTasks.map((task) => (
              <button key={task.id} type="button" onClick={() => setSelectedId(task.id)} aria-pressed={selectedId === task.id} className={'block w-full border-b border-white/5 p-4 text-left transition hover:bg-white/5 ' + (selectedId === task.id ? 'bg-cyan-300/[0.08]' : '')}>
                <span className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-white">{task.objective}</span><span className={'shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase ' + tone(task.status)}>{task.status}</span></span>
                <span className="mt-2 block text-[10px] text-slate-500">{dateLabel(task.createdAt)}</span>
                <span className="mt-1 block break-all font-mono text-[9px] text-slate-600">{task.id}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="min-w-0 rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="operator-detail-title">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-xs uppercase tracking-[0.18em] text-cyan-300">Selected execution</p><h2 id="operator-detail-title" className="mt-1 text-lg font-semibold text-white">{selected ? 'Task details' : 'No task selected'}</h2></div>
            {selected && <span className={'rounded-full border px-3 py-1 text-xs uppercase ' + tone(selected.status)}>{selected.status}</span>}
          </div>
          {selected ? <>
            <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">{selected.objective}</p>
            <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
              <InfoRow label="Task ID" value={selected.id} />
              <InfoRow label="Created" value={dateLabel(selected.createdAt)} />
              <InfoRow label="Completed" value={dateLabel(selected.completedAt)} />
              <InfoRow label="Attempts" value={selected.attempts === undefined ? 'Not reported' : selected.attempts + ' / ' + (selected.maxAttempts ?? 'unreported')} />
            </dl>
            {selected.error && <p role="alert" className="mt-4 rounded-lg border border-rose-400/20 bg-rose-950/20 p-3 text-xs text-rose-200">{selected.error}</p>}
            <div className="mt-5 border-t border-white/10 pt-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><Activity className="h-4 w-4 text-cyan-300" /> Persisted agent handoffs</h3>
              {selected.handoffs?.length ? <ul className="mt-3 space-y-2">{selected.handoffs.map((handoff, index) => <li key={handoff.fromAgent + '-' + handoff.toAgent + '-' + index} className="rounded-lg border border-white/5 bg-slate-950/50 p-3"><div className="flex items-center justify-between gap-3 text-xs"><span className="text-slate-200">{handoffLabel(handoff.fromAgent)} → {handoffLabel(handoff.toAgent)}</span><span className={tone(handoff.status).split(' ')[0]}>{handoff.status}</span></div>{handoff.error && <p className="mt-2 text-[11px] text-rose-200">{handoff.error}</p>}</li>)}</ul> : <p className="mt-2 text-xs text-slate-500">No handoff transitions have been recorded for this task.</p>}
            </div>
            {selected.result && <div className="mt-5 border-t border-white/10 pt-4"><h3 className="text-sm font-semibold text-white">Persisted result</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{typeof selected.result === 'string' ? selected.result : selected.result.synthesis || 'Result payload exists; no synthesis text was reported.'}</p></div>}
          </> : <div className="mt-5 rounded-lg border border-dashed border-white/10 p-5 text-sm text-slate-500">Queue your first task or select a task from history to inspect its lifecycle.</div>}
          <p className="mt-5 flex items-center gap-2 border-t border-white/10 pt-4 text-[11px] text-slate-500"><RotateCw className="h-3.5 w-3.5" /> Last refreshed: {dateLabel(refreshedAt)} · history is scoped to your authenticated account.</p>
        </section>
      </div>

      <div className="rounded-xl border border-white/10 bg-slate-950/50 p-4 text-xs leading-5 text-slate-500">
        <div className="flex items-center gap-2 text-slate-300"><XCircle className="h-4 w-4 text-amber-300" /> Execution controls remain policy-bound</div>
        <p className="mt-2">This console queues reasoning work only. It does not approve outbound messages, run engineering patches, trigger provider probes or bypass human review. Use the Admin Console for protected approvals and the Cockpit for live brain status.</p>
        <a href="#/cockpit" className="mt-3 inline-flex text-cyan-200 hover:text-cyan-100">Open Command Cockpit →</a>
      </div>
    </section>
  );
}

function QueueMetric({ label, value, tone: textTone }: { label: string; value: number; tone: string }) {
  return <article className="rounded-xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs text-slate-500">{label}</p><p className={'mt-2 text-2xl font-semibold ' + textTone}>{value}</p></article>;
}
function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="flex min-w-0 justify-between gap-3 border-b border-white/5 pb-2"><dt className="text-slate-500">{label}</dt><dd className="max-w-[70%] break-all text-right text-slate-200">{value}</dd></div>;
}
