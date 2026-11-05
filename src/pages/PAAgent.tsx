import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Database,
  ListChecks,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
  Wifi,
  Workflow,
} from 'lucide-react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';

type PAStatus = {
  active: boolean;
  workState: 'stopped' | 'monitoring' | 'degraded';
  lastHeartbeat: string;
  lastReport: string;
  lastError: string | null;
  observationsCompleted: number;
  retryAttempts: number;
  health: { api: boolean; database: boolean; redis: boolean };
  eBPFPolicyEnforced: false;
  genXPolicyEngineAvailable: boolean;
};

type PATask = {
  id: string;
  objective: string;
  status: string;
  createdAt: string;
  completedAt?: string | null;
  error?: string | null;
  handoffs?: Array<{ fromAgent: string; toAgent: string; status: string }>;
};

type LoadState = 'loading' | 'ready' | 'unavailable';

function dateLabel(value?: string | null): string {
  if (!value) return 'Not reported';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Invalid timestamp' : date.toLocaleString();
}

function statusTone(value: string): string {
  if (value === 'monitoring' || value === 'completed') return 'border-emerald-300/25 bg-emerald-300/10 text-emerald-200';
  if (value === 'degraded' || value === 'running') return 'border-amber-300/25 bg-amber-300/10 text-amber-100';
  if (value === 'failed' || value === 'cancelled') return 'border-rose-300/25 bg-rose-300/10 text-rose-200';
  return 'border-white/10 bg-white/[0.03] text-slate-300';
}

export default function PAAgentPage() {
  const [status, setStatus] = useState<PAStatus | null>(null);
  const [tasks, setTasks] = useState<PATask[]>([]);
  const [statusState, setStatusState] = useState<LoadState>('loading');
  const [tasksState, setTasksState] = useState<LoadState>('loading');
  const [errors, setErrors] = useState<string[]>([]);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    const nextErrors: string[] = [];
    const [statusResult, tasksResult] = await Promise.allSettled([
      authenticatedFetch('/api/agent/ops/pa/status', { headers: { Accept: 'application/json' } }),
      authenticatedFetch('/api/agent/ops/tasks', { headers: { Accept: 'application/json' } }),
    ]);

    if (statusResult.status === 'fulfilled') {
      try {
        const response = statusResult.value;
        const payload = await response.json() as { pa?: PAStatus; error?: string };
        if (!response.ok || !payload.pa) throw new Error(payload.error || 'PA observer is not available.');
        setStatus(payload.pa);
        setStatusState('ready');
      } catch (error) {
        setStatus(null);
        setStatusState('unavailable');
        nextErrors.push(error instanceof Error ? error.message : 'PA status could not be loaded.');
      }
    } else {
      setStatus(null);
      setStatusState('unavailable');
      nextErrors.push('PA status request failed.');
    }

    if (tasksResult.status === 'fulfilled') {
      try {
        const response = tasksResult.value;
        const payload = await response.json() as { tasks?: PATask[]; error?: string };
        if (!response.ok) throw new Error(payload.error || 'Task history is unavailable.');
        setTasks(Array.isArray(payload.tasks) ? payload.tasks : []);
        setTasksState('ready');
      } catch (error) {
        setTasks([]);
        setTasksState('unavailable');
        nextErrors.push(error instanceof Error ? error.message : 'Task history could not be loaded.');
      }
    } else {
      setTasks([]);
      setTasksState('unavailable');
      nextErrors.push('Task history request failed.');
    }

    setErrors(nextErrors);
    setRefreshedAt(new Date().toISOString());
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => { if (active) await refresh(); };
    void load();
    const timer = window.setInterval(() => {
      if (active && document.visibilityState === 'visible') void refresh();
    }, 15000);
    const clock = window.setInterval(() => setNow(Date.now()), 5000);
    const onFocus = () => { if (active) void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.clearInterval(clock);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const heartbeatAge = status?.lastHeartbeat ? now - Date.parse(status.lastHeartbeat) : Number.POSITIVE_INFINITY;
  const heartbeatValid = Number.isFinite(heartbeatAge) && heartbeatAge >= 0;
  const heartbeatFresh = heartbeatValid && heartbeatAge <= 45000;
  const runtimeLabel = !status ? 'Unknown' : !heartbeatValid ? 'Unverified heartbeat' : !heartbeatFresh ? 'Stale heartbeat' : status.workState;
  const runtimeTone = status && heartbeatFresh && status.active && status.workState === 'monitoring'
    ? 'border-emerald-300/25 bg-emerald-300/10 text-emerald-200'
    : status && (status.workState === 'degraded' || !heartbeatFresh)
      ? 'border-amber-300/25 bg-amber-300/10 text-amber-100'
      : 'border-white/10 bg-white/[0.03] text-slate-300';

  const counts = useMemo(() => ({
    queued: tasks.filter((task) => task.status === 'queued').length,
    running: tasks.filter((task) => task.status === 'running').length,
    completed: tasks.filter((task) => task.status === 'completed').length,
    failed: tasks.filter((task) => task.status === 'failed').length,
  }), [tasks]);

  return (
    <section className="mx-auto max-w-7xl space-y-7 px-5 py-8 text-slate-100 sm:px-10" aria-labelledby="pa-title">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200"><BrainCircuit className="h-6 w-6" /></span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">RyanAI / Personal intelligence</p>
            <h1 id="pa-title" className="mt-2 text-3xl font-bold text-white">Personal Assistant</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Your personal command centre for runtime awareness, task continuity and authorised agent coordination.</p>
          </div>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={statusState === 'loading' && tasksState === 'loading'} className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </header>

      {errors.map((error, index) => <p key={index} role="alert" className="flex items-start gap-2 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-sm text-amber-100"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>)}

      <section className="rounded-2xl border border-cyan-300/20 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="pa-runtime-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Operational truth</p><h2 id="pa-runtime-title" className="mt-1 text-lg font-semibold text-white">PA observer</h2></div>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase ${runtimeTone}`}>{statusState === 'loading' ? 'Checking' : runtimeLabel}</span>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-300">{status?.lastReport ?? 'No authenticated PA observer report has been received.'}</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Probe icon={Activity} label="API" value={status ? status.health.api : null} />
          <Probe icon={Database} label="PostgreSQL" value={status ? status.health.database : null} />
          <Probe icon={Wifi} label="Redis" value={status ? status.health.redis : null} />
          <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4"><div className="flex items-center gap-2 text-xs text-slate-400"><Clock3 className="h-4 w-4 text-cyan-300" />Heartbeat</div><p className="mt-3 text-sm font-semibold text-white">{status?.lastHeartbeat ? dateLabel(status.lastHeartbeat) : 'Not received'}</p><p className="mt-1 text-[11px] text-slate-500">{heartbeatFresh ? 'Within 45-second freshness window' : 'Not verified as current'}</p></div>
        </div>
        <div className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
          <Metric label="Observations completed" value={status ? String(status.observationsCompleted) : '—'} />
          <Metric label="Retry attempts" value={status ? String(status.retryAttempts) : '—'} />
          <Metric label="Last dashboard refresh" value={dateLabel(refreshedAt)} />
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Task summary">
        <MetricCard icon={ListChecks} label="Queued" value={tasksState === 'ready' ? String(counts.queued) : '—'} />
        <MetricCard icon={Activity} label="Running" value={tasksState === 'ready' ? String(counts.running) : '—'} />
        <MetricCard icon={CheckCircle2} label="Completed" value={tasksState === 'ready' ? String(counts.completed) : '—'} />
        <MetricCard icon={AlertCircle} label="Failed" value={tasksState === 'ready' ? String(counts.failed) : '—'} />
      </section>

      <section className="space-y-3" aria-labelledby="pa-tasks-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 id="pa-tasks-title" className="text-xl font-semibold text-white">Recent task activity</h2><p className="mt-1 text-sm text-slate-400">Persisted tasks belonging to your authenticated account.</p></div>
          <a href="#/operations" className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-200 hover:text-cyan-100">Open Operations Center <ArrowRight className="h-4 w-4" /></a>
        </div>
        {tasksState === 'loading' && <p role="status" className="rounded-xl border border-white/10 p-4 text-sm text-slate-400">Loading task history…</p>}
        {tasksState === 'ready' && tasks.length === 0 && <p className="rounded-xl border border-dashed border-white/15 p-5 text-sm text-slate-400">No persisted tasks were returned for this account.</p>}
        {tasks.slice(0, 6).map((task) => (
          <article key={task.id} className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-[10px] text-slate-500">{task.id}</span><span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase ${statusTone(task.status)}`}>{task.status}</span></div>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm text-slate-200">{task.objective}</p>
            <p className="mt-2 text-[11px] text-slate-500">Created {dateLabel(task.createdAt)} · Completed {dateLabel(task.completedAt)}</p>
            {task.handoffs && task.handoffs.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{task.handoffs.map((handoff, index) => <span key={`${task.id}-${index}`} className="rounded-md border border-white/10 px-2 py-1 text-[10px] text-slate-400">{handoff.fromAgent} → {handoff.toAgent}: {handoff.status}</span>)}</div>}
            {task.error && <p className="mt-3 text-xs text-rose-300">Reported failure: {task.error}</p>}
          </article>
        ))}
      </section>

      <section className="grid gap-3 md:grid-cols-2" aria-label="PA capabilities">
        <Capability icon={BrainCircuit} title="Personal memory" description="Memory retrieval and authorised note capture are planned next. No memory write is exposed in this release." state="Next increment" />
        <Capability icon={CalendarDays} title="Daily planning" description="Calendar, reminders and briefing integrations are not connected yet." state="Not connected" />
        <Capability icon={MessageSquareText} title="Communications" description="Drafting and delivery stay in RyanAI Comms with destination verification and explicit approval." state="Approval gated" />
        <Capability icon={Workflow} title="Agent coordination" description="Task history is visible here. A dedicated authenticated PA-to-Jarvis handoff is still required." state="In progress" />
      </section>

      <footer className="rounded-xl border border-white/10 bg-slate-950/50 p-4 text-xs leading-5 text-slate-400">
        <div className="flex items-center gap-2 font-semibold text-slate-200"><ShieldCheck className="h-4 w-4 text-cyan-300" />Read-only PA boundary</div>
        <p className="mt-2">This workspace observes runtime health and reads account-scoped task history. It does not send messages, make calls, modify files, change settings, approve actions or perform privileged operations. eBPF enforcement is not claimed. Gen-X policy availability is reported by the observer, not inferred by this UI.</p>
      </footer>
    </section>
  );
}

function Probe({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: boolean | null }) {
  return <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4"><div className="flex items-center gap-2 text-xs text-slate-400"><Icon className="h-4 w-4 text-cyan-300" />{label} probe</div><p className={`mt-3 text-sm font-semibold ${value === true ? 'text-emerald-200' : value === false ? 'text-rose-200' : 'text-slate-400'}`}>{value === true ? 'Healthy' : value === false ? 'Unhealthy' : 'Unknown'}</p></div>;
}
function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-white/10 bg-slate-950/40 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p><p className="mt-1 break-words text-xs font-medium text-slate-200">{value}</p></div>;
}
function MetricCard({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
  return <article className="rounded-xl border border-white/10 bg-slate-900/70 p-4"><div className="flex items-center gap-2 text-xs text-slate-400"><Icon className="h-4 w-4 text-cyan-300" />{label}</div><p className="mt-3 text-2xl font-semibold text-white">{value}</p></article>;
}
function Capability({ icon: Icon, title, description, state }: { icon: typeof Activity; title: string; description: string; state: string }) {
  return <article className="rounded-xl border border-white/10 bg-slate-900/60 p-4"><div className="flex items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-sm font-semibold text-white"><Icon className="h-4 w-4 text-cyan-300" />{title}</h3><span className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-slate-400">{state}</span></div><p className="mt-2 text-xs leading-5 text-slate-400">{description}</p></article>;
}
