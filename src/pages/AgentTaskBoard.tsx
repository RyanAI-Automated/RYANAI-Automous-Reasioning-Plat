import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';

type Handoff = {
  id: string;
  fromAgent: string;
  toAgent: string;
  status: string;
  startedAt: string;
  completedAt?: string | null;
  error?: string | null;
};

type Evidence = {
  id: string;
  sequence: number;
  eventType: string;
  actorId?: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

type AgentTask = {
  id: string;
  objective: string;
  status: string;
  approvalStatus: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  error?: string | null;
  attempts: number;
  maxAttempts: number;
  handoffs: Handoff[];
  evidence: Evidence[];
};

const columns = [
  { id: 'queued', title: 'To do', description: 'Persisted and waiting for a worker' },
  { id: 'running', title: 'Doing', description: 'A worker has claimed the task' },
  { id: 'completed', title: 'Completed', description: 'Execution ended; acceptance is separate' },
  { id: 'failed', title: 'Blocked', description: 'Execution failed and needs attention' },
  { id: 'cancelled', title: 'Cancelled', description: 'Execution was cancelled' },
] as const;

async function readError(response: Response): Promise<string> {
  const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
  return body.error || body.message || `Request failed (${response.status})`;
}

export default function AgentTaskBoard() {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [objective, setObjective] = useState('');
  const [comments, setComments] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [commenting, setCommenting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/api/jarvis/internal/tasks');
      if (!response.ok) throw new Error(await readError(response));
      const data = await response.json() as { tasks: AgentTask[] };
      setTasks(data.tasks);
      setLastUpdated(new Date().toISOString());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load agent tasks.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
    const interval = window.setInterval(() => void loadTasks(), 8000);
    return () => window.clearInterval(interval);
  }, [loadTasks]);

  const grouped = useMemo(() => Object.fromEntries(
    columns.map((column) => [column.id, tasks.filter((task) => task.status === column.id)]),
  ) as Record<(typeof columns)[number]['id'], AgentTask[]>, [tasks]);

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanObjective = objective.trim();
    if (cleanObjective.length < 5) return;
    setCreating(true);
    setError(null);
    try {
      const response = await authenticatedFetch('/api/jarvis/internal/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objective: cleanObjective }),
      });
      if (!response.ok) throw new Error(await readError(response));
      setObjective('');
      await loadTasks();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to queue the task.');
    } finally {
      setCreating(false);
    }
  }

  async function addComment(taskId: string) {
    const comment = (comments[taskId] || '').trim();
    if (!comment) return;
    setCommenting(taskId);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/jarvis/internal/tasks/${encodeURIComponent(taskId)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment }),
      });
      if (!response.ok) throw new Error(await readError(response));
      setComments((current) => ({ ...current, [taskId]: '' }));
      await loadTasks();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to add the comment.');
    } finally {
      setCommenting(null);
    }
  }

  return (
    <section className="mx-auto w-full max-w-[1600px] space-y-6 p-4 sm:p-8" aria-labelledby="agent-task-board-title">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">RyanAI · Orchestration</p>
          <h1 id="agent-task-board-title" className="mt-2 text-3xl font-bold text-white">Agent task board</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">A shared view of durable work queued for Jarvis and RyanAI workers. Status is read from PostgreSQL, not simulated.</p>
        </div>
        <div className="text-xs text-slate-500" aria-live="polite">
          {lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleTimeString()}` : 'Waiting for first update'}
        </div>
      </div>

      <form onSubmit={createTask} className="rounded-2xl border border-cyan-400/20 bg-slate-900/70 p-4 sm:p-5">
        <label htmlFor="agent-task-objective" className="mb-2 block text-sm font-semibold text-slate-200">Create an engineering task</label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <textarea
            id="agent-task-objective"
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            minLength={5}
            maxLength={20000}
            required
            rows={2}
            placeholder="Describe the task, expected outcome and constraints…"
            className="min-h-14 flex-1 resize-y rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400"
          />
          <button type="submit" disabled={creating || objective.trim().length < 5} className="rounded-xl bg-cyan-300 px-5 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50">
            {creating ? 'Queueing…' : 'Queue task'}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">Queueing persists the task and audit record before notifying workers. It does not approve privileged actions or code changes.</p>
      </form>

      {error && <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">{error}</p>}

      {loading ? (
        <p role="status" className="p-8 text-center text-sm text-slate-400">Loading persisted tasks…</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
          {columns.map((column) => (
            <section key={column.id} aria-labelledby={`column-${column.id}`} className="min-h-64 rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
              <div className="mb-3 flex items-center justify-between gap-2 px-1">
                <div>
                  <h2 id={`column-${column.id}`} className="font-semibold text-slate-100">{column.title}</h2>
                  <p className="mt-1 text-xs text-slate-500">{column.description}</p>
                </div>
                <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs tabular-nums text-slate-300">{grouped[column.id].length}</span>
              </div>
              <div className="space-y-3">
                {grouped[column.id].map((task) => {
                  const taskComments = task.evidence.filter((event) => event.eventType === 'task.comment');
                  return (
                    <article key={task.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3 shadow-sm">
                      <p className="whitespace-pre-wrap text-sm leading-6 text-slate-100">{task.objective}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                        <span>{new Date(task.createdAt).toLocaleString()}</span>
                        <span>·</span>
                        <span>{task.attempts}/{task.maxAttempts} attempts</span>
                        <span>·</span>
                        <span>Approval: {task.approvalStatus}</span>
                      </div>
                      {task.handoffs.length > 0 && (
                        <div className="mt-3 space-y-1 border-t border-slate-800 pt-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Agent activity</p>
                          {task.handoffs.map((handoff) => (
                            <div key={handoff.id} className="flex items-center justify-between gap-2 text-xs">
                              <span className="text-slate-300">{handoff.fromAgent} → {handoff.toAgent}</span>
                              <span className={handoff.status === 'failed' ? 'text-rose-300' : handoff.status === 'completed' ? 'text-emerald-300' : 'text-amber-300'}>{handoff.status}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {task.error && <p className="mt-3 rounded-lg bg-rose-950/40 p-2 text-xs text-rose-200">{task.error}</p>}
                      {taskComments.length > 0 && (
                        <div className="mt-3 space-y-2 border-t border-slate-800 pt-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Comments</p>
                          {taskComments.map((event) => (
                            <div key={event.id} className="rounded-lg bg-slate-950/80 p-2">
                              <p className="whitespace-pre-wrap text-xs text-slate-300">{String(event.payload.comment || '')}</p>
                              <p className="mt-1 text-[10px] text-slate-600">{new Date(event.createdAt).toLocaleString()}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="mt-3 flex gap-2">
                        <input
                          aria-label={`Comment on task ${task.id}`}
                          value={comments[task.id] || ''}
                          onChange={(event) => setComments((current) => ({ ...current, [task.id]: event.target.value }))}
                          maxLength={4000}
                          placeholder="Add a progress comment…"
                          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-cyan-400"
                        />
                        <button type="button" onClick={() => void addComment(task.id)} disabled={commenting === task.id || !(comments[task.id] || '').trim()} className="rounded-lg border border-cyan-400/40 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/10 disabled:opacity-40">
                          {commenting === task.id ? '…' : 'Comment'}
                        </button>
                      </div>
                    </article>
                  );
                })}
                {grouped[column.id].length === 0 && <p className="rounded-xl border border-dashed border-slate-800 p-5 text-center text-xs text-slate-600">No tasks in this column.</p>}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
