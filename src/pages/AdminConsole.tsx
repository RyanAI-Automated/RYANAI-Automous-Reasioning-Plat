import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Activity, AlertTriangle, CheckCircle2, ClipboardCheck, Clock3, Cpu, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';

interface RuntimeMetrics {
  status: string;
  uptime: number;
  timestamp: string;
  database: { status: string; driver: string };
  system: { nodeVersion: string; rssMemoryMB: number; heapUsedMB: number };
}
interface PendingAction {
  id: string;
  userId: string;
  tool: string;
  args: unknown;
  summary: string;
  createdAt: string;
  expiresAt: string;
}
interface EngineeringJob {
  id: string;
  userId: string;
  objective: string;
  status: string;
  approvalStatus: string;
  planHash: string | null;
  baseCommitSha: string | null;
  proposedDiffHash: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  completedAt: string | null;
  _count: { evidence: number; handoffs: number };
}

async function readJson<T>(path: string): Promise<T> {
  const response = await authenticatedFetch(path, { headers: { Accept: 'application/json' } });
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || 'Request failed (' + response.status + ').');
  return payload;
}

function dateLabel(value?: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Invalid timestamp' : date.toLocaleString();
}
function durationLabel(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return 'Not reported';
  const value = Math.floor(seconds);
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return (days ? days + 'd ' : '') + hours + 'h ' + minutes + 'm';
}
function statusTone(value: string) {
  if (['executed', 'approved', 'completed'].includes(value.toLowerCase())) return 'text-emerald-300';
  if (['failed', 'rejected', 'cancelled', 'expired'].includes(value.toLowerCase())) return 'text-rose-300';
  return 'text-amber-200';
}

export default function AdminConsole({ userId }: { userId: string }) {
  const [metrics, setMetrics] = useState<RuntimeMetrics | null>(null);
  const [actions, setActions] = useState<PendingAction[]>([]);
  const [jobs, setJobs] = useState<EngineeringJob[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');

  const refresh = useCallback(async () => {
    const results = await Promise.allSettled([
      readJson<RuntimeMetrics>('/api/admin/metrics'),
      readJson<{ actions: PendingAction[] }>('/api/actions'),
      readJson<{ jobs: EngineeringJob[] }>('/api/engineering/jobs'),
    ]);
    const nextErrors: string[] = [];
    if (results[0].status === 'fulfilled') setMetrics(results[0].value);
    else { setMetrics(null); nextErrors.push('Runtime metrics: ' + String(results[0].reason)); }
    if (results[1].status === 'fulfilled') setActions(results[1].value.actions ?? []);
    else { setActions([]); nextErrors.push('Pending actions: ' + String(results[1].reason)); }
    if (results[2].status === 'fulfilled') setJobs(results[2].value.jobs ?? []);
    else { setJobs([]); nextErrors.push('Engineering approvals: ' + String(results[2].reason)); }
    setErrors(nextErrors);
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      await refresh();
      if (!active) return;
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, [refresh]);

  async function decideAction(action: PendingAction, decision: 'approve' | 'reject') {
    if (busyId) return;
    const consequence = decision === 'approve'
      ? 'Approving this request executes the queued external action. Confirm the destination and content in the action scope first.'
      : 'Reject this queued action? It will not be sent.';
    if (!window.confirm(consequence + '\n\n' + action.summary)) return;
    setBusyId(action.id);
    setNotice('');
    setErrors([]);
    try {
      const response = await authenticatedFetch('/api/actions/' + encodeURIComponent(action.id) + '/' + decision, { method: 'POST' });
      const payload = await response.json().catch(() => ({})) as { status?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Decision failed (' + response.status + ').');
      setNotice(decision === 'approve'
        ? 'Approval completed. Execution result: ' + (payload.status || 'recorded') + '.'
        : 'The pending action was rejected.');
      await refresh();
    } catch (cause) {
      setErrors([cause instanceof Error ? cause.message : 'Could not decide this action.']);
    } finally {
      setBusyId('');
    }
  }

  async function approveJob(job: EngineeringJob) {
    if (!job.planHash || !job.baseCommitSha || !job.proposedDiffHash) {
      setErrors(['This job is missing exact plan, commit or diff bindings. It cannot be approved.']);
      return;
    }
    if (job.userId === userId) {
      setErrors(['Self-approval is prohibited. A different administrator must review this job.']);
      return;
    }
    const confirmed = window.confirm(
      'Approve this exact engineering plan for the coding queue?\n\n' +
      'Objective: ' + job.objective + '\n\n' +
      'This approves the persisted plan, base commit and diff hashes only. It does not itself enqueue or run a coding task.',
    );
    if (!confirmed) return;
    setBusyId(job.id);
    setNotice('');
    setErrors([]);
    try {
      const response = await authenticatedFetch('/api/engineering/jobs/' + encodeURIComponent(job.id) + '/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planHash: job.planHash,
          baseCommitSha: job.baseCommitSha,
          proposedDiffHash: job.proposedDiffHash,
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; approvalStatus?: string };
      if (!response.ok) throw new Error(payload.error || 'Plan approval failed (' + response.status + ').');
      setNotice('Engineering plan approved against its persisted hashes. The separate coding-task enqueue step remains explicit.');
      await refresh();
    } catch (cause) {
      setErrors([cause instanceof Error ? cause.message : 'Could not approve engineering plan.']);
    } finally {
      setBusyId('');
    }
  }

  const pendingJobs = jobs.filter((job) => job.status === 'queued' && job.approvalStatus === 'pending');

  return (
    <section className="mx-auto max-w-7xl space-y-6 px-5 py-8 sm:px-10" aria-labelledby="admin-title">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Restricted control plane</p>
          <h1 id="admin-title" className="mt-2 text-3xl font-bold text-white">RyanAI Admin Console</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            Runtime diagnostics, pending-action decisions and exact-plan engineering approvals.
            Every mutation is sent to an administrator-protected API and requires an explicit confirmation.
          </p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/25 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-300/10 disabled:opacity-50">
          <RefreshCw className={'h-4 w-4 ' + (loading ? 'animate-spin' : '')} /> Refresh control plane
        </button>
      </header>

      {errors.map((error, index) => <p key={index} role="alert" className="rounded-lg border border-rose-400/25 bg-rose-950/20 p-3 text-sm text-rose-200">{error}</p>)}
      {notice && <p role="status" className="rounded-lg border border-cyan-300/20 bg-cyan-950/20 p-3 text-sm text-cyan-100">{notice}</p>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Activity} label="Admin metrics endpoint" value={metrics?.status ?? 'Unavailable'} detail={dateLabel(metrics?.timestamp)} />
        <MetricCard icon={Clock3} label="API process uptime" value={metrics ? durationLabel(metrics.uptime) : 'Not reported'} detail="Process uptime only; not a deployment-health guarantee." />
        <MetricCard icon={Cpu} label="Runtime memory" value={metrics ? metrics.system.rssMemoryMB + ' MB RSS' : 'Not reported'} detail={metrics ? metrics.system.heapUsedMB + ' MB heap · ' + metrics.system.nodeVersion : 'Not reported'} />
        <MetricCard icon={ShieldCheck} label="Pending approvals" value={String(actions.length + pendingJobs.length)} detail={actions.length + ' external actions · ' + pendingJobs.length + ' engineering plans'} />
      </div>

      <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-lg font-semibold text-white">Dependency and runtime truth</h2><p className="mt-1 text-sm text-slate-400">Only values reported by the protected metrics endpoint are shown.</p></div>
          <span className="rounded-full border border-amber-300/25 px-3 py-1 text-xs text-amber-200">Database status: {metrics?.database.status ?? 'Not reported'}</span>
        </div>
        <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
          <InfoRow label="Database driver" value={metrics?.database.driver ?? 'Not reported'} />
          <InfoRow label="Database connectivity" value={metrics?.database.status ?? 'Unknown'} />
          <InfoRow label="Node runtime" value={metrics?.system.nodeVersion ?? 'Not reported'} />
          <InfoRow label="Metrics timestamp" value={dateLabel(metrics?.timestamp)} />
        </dl>
        <p className="mt-4 text-xs leading-5 text-slate-500">The metrics route intentionally reports database state as unknown rather than probing it. Use the System Dashboard for independent API, PostgreSQL, Redis and checkpoint health signals.</p>
      </section>

      <section className="space-y-4" aria-labelledby="pending-actions-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 id="pending-actions-title" className="text-xl font-semibold text-white">Pending external actions</h2><p className="mt-1 text-sm text-slate-400">Approving executes the queued action. Review its summary and arguments before deciding.</p></div>
          <span className="text-xs text-slate-500">{actions.length} awaiting a decision</span>
        </div>
        {loading && <p className="text-sm text-slate-400">Loading administrator queue…</p>}
        {!loading && actions.length === 0 && <EmptyState text="No unexpired actions are waiting for administrator approval." />}
        <div className="space-y-3">
          {actions.map((action) => (
            <article key={action.id} className="rounded-xl border border-amber-300/15 bg-slate-900/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white">{action.summary}</p>
                  <p className="mt-1 text-xs text-slate-500">{action.tool} · submitted {dateLabel(action.createdAt)} · expires {dateLabel(action.expiresAt)}</p>
                  <p className="mt-1 break-all text-[10px] text-slate-600">Request {action.id} · User {action.userId}</p>
                </div>
                <span className="rounded-full border border-amber-300/25 px-2.5 py-1 text-[10px] uppercase tracking-wider text-amber-200">Pending</span>
              </div>
              <details className="mt-3 rounded-lg border border-white/10 bg-slate-950/60 p-3">
                <summary className="cursor-pointer text-xs font-medium text-cyan-200">Inspect action scope and arguments</summary>
                <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-slate-300">{JSON.stringify(action.args, null, 2)}</pre>
              </details>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => void decideAction(action, 'reject')} disabled={Boolean(busyId)} className="inline-flex items-center gap-2 rounded-lg border border-rose-300/25 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-300/10 disabled:opacity-50">
                  <XCircle className="h-3.5 w-3.5" /> Reject
                </button>
                <button type="button" onClick={() => void decideAction(action, 'approve')} disabled={Boolean(busyId)} className="inline-flex items-center gap-2 rounded-lg bg-cyan-300 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-200 disabled:opacity-50">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {busyId === action.id ? 'Processing…' : 'Approve and execute'}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="engineering-approvals-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 id="engineering-approvals-title" className="text-xl font-semibold text-white">Engineering plan approvals</h2><p className="mt-1 text-sm text-slate-400">Approval binds the stored plan hash, base commit and proposed diff hash. Self-approval is blocked by the API.</p></div>
          <span className="text-xs text-slate-500">{pendingJobs.length} awaiting review</span>
        </div>
        {!loading && jobs.length === 0 && <EmptyState text="No engineering jobs are currently visible to this administrator." />}
        <div className="space-y-3">
          {jobs.map((job) => {
            const canApprove = job.status === 'queued' && job.approvalStatus === 'pending'
              && Boolean(job.planHash && job.baseCommitSha && job.proposedDiffHash) && job.userId !== userId;
            return (
              <article key={job.id} className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white">{job.objective}</p>
                    <p className="mt-1 break-all text-[10px] text-slate-600">Job {job.id} · submitted {dateLabel(job.createdAt)}</p>
                  </div>
                  <div className="text-right text-xs"><p className={statusTone(job.status)}>{job.status}</p><p className={statusTone(job.approvalStatus)}>{job.approvalStatus}</p></div>
                </div>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                  <InfoRow label="Evidence records" value={String(job._count?.evidence ?? 0)} />
                  <InfoRow label="Agent handoffs" value={String(job._count?.handoffs ?? 0)} />
                  <InfoRow label="Approved at" value={dateLabel(job.approvedAt)} />
                </div>
                <details className="mt-3 rounded-lg border border-white/10 bg-slate-950/60 p-3">
                  <summary className="cursor-pointer text-xs font-medium text-cyan-200">Inspect approval bindings</summary>
                  <dl className="mt-3 space-y-2 break-all text-[10px] text-slate-400">
                    <InfoRow label="Plan SHA-256" value={job.planHash ?? 'Missing'} />
                    <InfoRow label="Base commit" value={job.baseCommitSha ?? 'Missing'} />
                    <InfoRow label="Diff SHA-256" value={job.proposedDiffHash ?? 'Missing'} />
                    <InfoRow label="Approver ID" value={job.approvedBy ?? 'Not approved'} />
                  </dl>
                </details>
                {job.userId === userId && job.approvalStatus === 'pending' && <p className="mt-3 text-xs text-amber-200">You created this job. Ask a different administrator to review it.</p>}
                {job.approvalStatus === 'pending' && !job.planHash && <p className="mt-3 text-xs text-rose-200">Missing plan bindings; approval is unavailable.</p>}
                <div className="mt-4 flex justify-end">
                  <button type="button" onClick={() => void approveJob(job)} disabled={!canApprove || Boolean(busyId)} className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/30 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-40">
                    <ClipboardCheck className="h-3.5 w-3.5" /> {busyId === job.id ? 'Approving…' : 'Approve exact plan'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <footer className="rounded-xl border border-white/10 bg-slate-950/50 p-4 text-xs leading-5 text-slate-500">
        <div className="flex items-center gap-2 text-slate-300"><AlertTriangle className="h-4 w-4 text-amber-300" /> Administrative scope is intentionally bounded</div>
        <p className="mt-2">This console does not change user roles, credentials, hosting plans, deployments or secrets. Provider probes can incur usage charges and remain in the Cockpit for a deliberate, separately confirmed action.</p>
        <a href="#/cockpit" className="mt-3 inline-flex text-cyan-200 hover:text-cyan-100">Open Cockpit for brain knowledge and controlled patch tools →</a>
      </footer>
    </section>
  );
}

function MetricCard({ icon: Icon, label, value, detail }: { icon: typeof Activity; label: string; value: string; detail: string }) {
  return <article className="rounded-xl border border-white/10 bg-slate-900/70 p-4"><div className="flex items-center gap-2 text-xs text-slate-400"><Icon className="h-4 w-4 text-cyan-300" />{label}</div><p className="mt-3 text-xl font-semibold text-white">{value}</p><p className="mt-1 text-[11px] leading-5 text-slate-500">{detail}</p></article>;
}
function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="flex min-w-0 justify-between gap-3 border-b border-white/5 pb-2"><dt className="text-slate-500">{label}</dt><dd className="max-w-[70%] break-all text-right text-slate-200">{value}</dd></div>;
}
function EmptyState({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-white/15 bg-slate-950/30 p-5 text-sm text-slate-500">{text}</div>;
}
