import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  ListChecks,
  RefreshCw,
  Send,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';

interface AgentHandoff {
  fromAgent: string;
  toAgent: string;
  status: string;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
}

interface AgentTask {
  id: string;
  objective: string;
  status: string;
  createdAt: string;
  completedAt?: string | null;
  result?: unknown;
  error?: string | null;
  handoffs?: AgentHandoff[];
}

interface PendingAction {
  id: string;
  tool: string;
  summary: string;
  createdAt: string;
  expiresAt: string;
}

interface ApiPayload<T> {
  tasks?: T[];
  actions?: T[];
  error?: string;
  status?: string;
}

async function readPayload<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => ({})) as ApiPayload<unknown> & T;
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : fallback);
  }
  return payload;
}

function formatDate(value?: string | null): string {
  if (!value) return 'Not reported';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Invalid date' : date.toLocaleString();
}

function taskResult(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'synthesis' in value) {
    const synthesis = (value as { synthesis?: unknown }).synthesis;
    return typeof synthesis === 'string' ? synthesis : null;
  }
  return null;
}

function statusClass(status: string): string {
  if (status === 'completed' || status === 'executed') return 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200';
  if (status === 'failed' || status === 'cancelled') return 'border-rose-400/25 bg-rose-400/10 text-rose-200';
  if (status === 'running' || status === 'approved') return 'border-cyan-400/25 bg-cyan-400/10 text-cyan-200';
  return 'border-amber-400/25 bg-amber-400/10 text-amber-100';
}

export default function OperationsCenter({ isAdmin = false }: { isAdmin?: boolean }) {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [actions, setActions] = useState<PendingAction[]>([]);
  const [objective, setObjective] = useState('');
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [loadingActions, setLoadingActions] = useState(isAdmin);
  const [submitting, setSubmitting] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [confirmApproveId, setConfirmApproveId] = useState<string | null>(null);
  const [taskError, setTaskError] = useState('');
  const [approvalError, setApprovalError] = useState('');
  const [notice, setNotice] = useState('');

  const refreshTasks = useCallback(async () => {
    setLoadingTasks(true);
    setTaskError('');
    try {
      const response = await authenticatedFetch('/api/agent/ops/tasks');
      const payload = await readPayload<ApiPayload<AgentTask>>(response, 'Could not load autonomous task history.');
      setTasks(Array.isArray(payload.tasks) ? payload.tasks : []);
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Could not load autonomous task history.');
    } finally {
      setLoadingTasks(false);
    }
  }, []);

  const refreshActions = useCallback(async () => {
    if (!isAdmin) return;
    setLoadingActions(true);
    setApprovalError('');
    try {
      const response = await authenticatedFetch('/api/actions');
      const payload = await readPayload<ApiPayload<PendingAction>>(response, 'Could not load pending approvals.');
      setActions(Array.isArray(payload.actions) ? payload.actions : []);
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : 'Could not load pending approvals.');
    } finally {
      setLoadingActions(false);
    }
  }, [isAdmin]);

  const refresh = useCallback(async () => {
    await Promise.all([refreshTasks(), refreshActions()]);
  }, [refreshActions, refreshTasks]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = objective.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    setTaskError('');
    setNotice('');
    try {
      const response = await authenticatedFetch('/api/agent/ops/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objective: trimmed }),
      });
      const payload = await readPayload<{ taskId?: string; status?: string }>(response, 'The task could not be queued.');
      setObjective('');
      setNotice(payload.taskId
        ? `Task ${payload.taskId} was saved to the durable queue with status ${payload.status || 'queued'}.`
        : 'The task was accepted by the durable queue.');
      await refreshTasks();
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'The task could not be queued.');
    } finally {
      setSubmitting(false);
    }
  }

  async function decideAction(id: string, decision: 'approve' | 'reject') {
    setActingId(id);
    setApprovalError('');
    setNotice('');
    try {
      const response = await authenticatedFetch(`/api/actions/${encodeURIComponent(id)}/${decision}`, {
        method: 'POST',
      });
      const payload = await readPayload<{ status?: string }>(response, 'The approval decision could not be recorded.');
      setConfirmApproveId(null);
      setNotice(decision === 'approve'
        ? `Approval recorded. Action status: ${payload.status || 'submitted'}.`
        : `Action rejected. Status: ${payload.status || 'rejected'}.`);
      await refreshActions();
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : 'The approval decision could not be recorded.');
    } finally {
      setActingId(null);
    }
  }

  return (
    <section className="mx-auto max-w-7xl space-y-7 px-5 py-8 text-slate-100 sm:px-10" aria-labelledby="operations-title">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">RyanAI / Operator tools</p>
          <h1 id="operations-title" className="mt-2 text-3xl font-bold text-white">Operations Center</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            Submit durable reasoning jobs, inspect their persisted progress, and review actions that require an administrator decision.
          </p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loadingTasks || (isAdmin && loadingActions)}
          className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loadingTasks || loadingActions ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </header>

      {notice && <p role="status" className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3 text-sm text-emerald-200">{notice}</p>}

      <section aria-labelledby="task-submit-title" className="rounded-2xl border border-cyan-400/20 bg-slate-900/70 p-5">
        <div className="mb-4 flex items-center gap-3">
          <ListChecks className="h-6 w-6 text-cyan-300" />
          <div>
            <h2 id="task-submit-title" className="font-semibold text-white">Autonomous task queue</h2>
            <p className="text-xs text-slate-400">Tasks are persisted before workers execute them. Queue acceptance does not guarantee completion.</p>
          </div>
        </div>
        <form onSubmit={submitTask} className="space-y-3">
          <label htmlFor="operations-objective" className="block text-xs font-medium text-slate-300">Task objective</label>
          <textarea id="operations-objective" value={objective} onChange={(event) => setObjective(event.target.value)}
            minLength={5} maxLength={20000} rows={4} required
            placeholder="Describe the research, analysis or engineering task RyanAI should queue…"
            className="w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white placeholder:text-slate-600 focus:border-cyan-300 focus:outline-none" />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-slate-500">{objective.length.toLocaleString()} / 20,000 characters</span>
            <button type="submit" disabled={submitting || objective.trim().length < 5}
              className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50">
              <Send className="h-4 w-4" /> {submitting ? 'Queueing task…' : 'Queue task'}
            </button>
          </div>
        </form>
        {taskError && <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-rose-300"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{taskError}</p>}
      </section>

      <section aria-labelledby="task-history-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="task-history-title" className="text-xl font-semibold text-white">Your task history</h2>
            <p className="mt-1 text-xs text-slate-400">Account-scoped records returned by the authenticated task API.</p>
          </div>
          <span className="text-xs text-slate-500">{tasks.length} recent tasks</span>
        </div>
        {loadingTasks && <p role="status" className="rounded-xl border border-white/10 p-4 text-sm text-slate-400">Loading task history…</p>}
        {!loadingTasks && !taskError && tasks.length === 0 && <p className="rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-400">No autonomous tasks have been queued for this account yet.</p>}
        {!loadingTasks && tasks.map((task) => {
          const result = taskResult(task.result);
          return (
            <article key={task.id} className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-slate-500">{task.id}</span>
                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase ${statusClass(task.status)}`}>{task.status}</span>
              </div>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm text-slate-200">{task.objective}</p>
              <p className="mt-2 text-[11px] text-slate-500">Created {formatDate(task.createdAt)} · Completed {formatDate(task.completedAt)}</p>
              {task.handoffs && task.handoffs.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2" aria-label="Agent handoff progress">
                  {task.handoffs.map((handoff, index) => (
                    <span key={`${handoff.fromAgent}-${handoff.toAgent}-${index}`} className="rounded-md border border-white/10 px-2 py-1 text-[10px] text-slate-400">
                      {handoff.fromAgent} → {handoff.toAgent}: {handoff.status}
                    </span>
                  ))}
                </div>
              )}
              {result && <details className="mt-3 rounded-lg border border-cyan-400/15 bg-cyan-400/5 p-3"><summary className="cursor-pointer text-xs font-semibold text-cyan-200">View persisted result</summary><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">{result}</p></details>}
              {task.error && <p className="mt-3 text-xs text-rose-300">Execution error: {task.error}</p>}
            </article>
          );
        })}
      </section>

      {isAdmin && (
        <section aria-labelledby="approval-inbox-title" className="space-y-3 border-t border-white/10 pt-6">
          <div className="flex items-center gap-3">
            <ClipboardCheck className="h-6 w-6 text-violet-300" />
            <div>
              <h2 id="approval-inbox-title" className="text-xl font-semibold text-white">Administrator approval inbox</h2>
              <p className="mt-1 text-xs text-slate-400">Pending actions are global and administrator-only. Approving may execute an external action.</p>
            </div>
          </div>
          {approvalError && <p role="alert" className="flex items-start gap-2 rounded-lg border border-rose-400/20 bg-rose-400/5 p-3 text-sm text-rose-200"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{approvalError}</p>}
          {loadingActions && <p role="status" className="rounded-xl border border-white/10 p-4 text-sm text-slate-400">Loading pending approvals…</p>}
          {!loadingActions && !approvalError && actions.length === 0 && <p className="rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-400">There are no pending actions awaiting an administrator decision.</p>}
          {!loadingActions && actions.map((action) => {
            const confirming = confirmApproveId === action.id;
            const busy = actingId === action.id;
            return (
              <article key={action.id} className="rounded-xl border border-violet-400/20 bg-slate-950/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-violet-200">{action.tool}</span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-500"><Clock3 className="h-3.5 w-3.5" /> Expires {formatDate(action.expiresAt)}</span>
                </div>
                <p className="mt-2 text-sm text-slate-200">{action.summary}</p>
                <p className="mt-2 text-[11px] text-slate-500">Queued {formatDate(action.createdAt)} · Ref {action.id}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => setConfirmApproveId(confirming ? null : action.id)} disabled={busy}
                    className="rounded-lg border border-emerald-400/30 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-400/10 disabled:opacity-50">
                    {confirming ? 'Cancel approval' : 'Review approval'}
                  </button>
                  <button type="button" onClick={() => void decideAction(action.id, 'reject')} disabled={busy || confirming}
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-400/30 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-400/10 disabled:opacity-50">
                    <XCircle className="h-3.5 w-3.5" /> {busy ? 'Recording…' : 'Reject action'}
                  </button>
                </div>
                {confirming && (
                  <div role="group" aria-label={`Confirm approval for ${action.tool}`} className="mt-3 rounded-lg border border-amber-400/25 bg-amber-400/5 p-3">
                    <p className="flex items-start gap-2 text-xs leading-5 text-amber-100"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />This approval can execute the queued action, including sending a communication or triggering another external side effect. Review the summary and confirm only when authorised.</p>
                    <button type="button" onClick={() => void decideAction(action.id, 'approve')} disabled={busy}
                      className="mt-3 rounded-lg bg-emerald-400 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-300 disabled:opacity-50">
                      {busy ? 'Executing approved action…' : 'Confirm and execute'}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}
      <footer className="border-t border-white/10 pt-4 text-xs leading-5 text-slate-500">
        <p className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />Task history is scoped by the authenticated account. Approval decisions are enforced by the backend administrator guard; hiding controls in this UI is not an authorization boundary.</p>
      </footer>
    </section>
  );
}
