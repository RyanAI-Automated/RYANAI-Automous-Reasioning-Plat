import { useCallback, useEffect, useMemo, useState } from 'react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import {
  Activity,
  Check,
  ChevronRight,
  CircleAlert,
  Code2,
  FileCode2,
  GitBranch,
  Play,
  RefreshCw,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react';

type Job = {
  id: string;
  objective: string;
  status: string;
  approvalStatus: string;
  planHash: string;
  baseCommitSha: string;
  proposedDiffHash: string;
  approvedBy?: string | null;
  createdAt: string;
  completedAt?: string | null;
  _count?: { evidence: number; handoffs: number };
};

type JobDetail = {
  job: Job & { planSnapshot?: unknown; handoffs?: Array<{ id: string; fromAgent: string; toAgent: string; status: string }>; evidence?: Array<{ id: string; eventType: string; sequence: number }> };
  evidenceIntegrity: { valid?: boolean; reason?: string };
  verificationChecks: Array<{ name: string; status: string; source: string; runUrl?: string }>;
  acceptance: { accepted?: boolean; status?: string };
};

const AGENTS = ['codex', 'claude', 'copilot', 'cursor', 'gemini', 'opencode', 'muse', 'vibe', 'antigravity'] as const;
type Agent = (typeof AGENTS)[number];

const DEFAULT_PLAN = JSON.stringify({
  objective: 'Implement the approved RyanAI Studio change',
  steps: [
    'Inspect the scoped workspace and existing implementation',
    'Apply the smallest reviewable patch',
    'Run the relevant typecheck, lint and tests',
    'Report changed files and verification evidence',
  ],
  constraints: [
    'No production credentials',
    'No deployment',
    'No autonomous merge',
  ],
}, null, 2);

export function languageFromPath(path: string): string {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  const languages: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TypeScript React',
    js: 'JavaScript',
    jsx: 'JavaScript React',
    py: 'Python',
    rs: 'Rust',
    go: 'Go',
    java: 'Java',
    cs: 'C#',
    cpp: 'C++',
    c: 'C',
    h: 'C/C++',
    sql: 'SQL',
    sh: 'Bash',
    ps1: 'PowerShell',
    json: 'JSON',
    md: 'Markdown',
    yaml: 'YAML',
    yml: 'YAML',
  };
  return languages[ext] ?? 'Text';
}

export function diffFiles(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split(/\r?\n/)) {
    const match = line.match(/^\+\+\+ b\/(.+)$/);
    if (match && match[1] !== '/dev/null') files.add(match[1]);
  }
  return [...files];
}

export default function CodingStudio() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<JobDetail | null>(null);
  const [objective, setObjective] = useState('');
  const [baseCommitSha, setBaseCommitSha] = useState('');
  const [workspaceKey, setWorkspaceKey] = useState('ryanai-studio');
  const [agent, setAgent] = useState<Agent>('codex');
  const [plan, setPlan] = useState(DEFAULT_PLAN);
  const [proposedDiff, setProposedDiff] = useState('');
  const [taskPrompt, setTaskPrompt] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const changedFiles = useMemo(() => diffFiles(proposedDiff), [proposedDiff]);

  const loadJobs = useCallback(async () => {
    setError(null);
    try {
      const response = await authenticatedFetch('/api/engineering/jobs');
      const payload = await response.json() as { jobs?: Job[]; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Coding jobs could not be loaded.');
      setJobs(payload.jobs ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Coding jobs could not be loaded.');
    }
  }, []);

  useEffect(() => { void loadJobs(); }, [loadJobs]);

  const loadJob = async (jobId: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/engineering/jobs/${encodeURIComponent(jobId)}`);
      const payload = await response.json() as JobDetail & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Coding job could not be loaded.');
      setSelectedJob(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Coding job could not be loaded.');
    } finally {
      setBusy(false);
    }
  };

  const submitJob = async () => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      if (!objective.trim() || !baseCommitSha.trim() || !proposedDiff.trim()) {
        throw new Error('Objective, exact base commit SHA and proposed diff are required.');
      }
      const parsedPlan = JSON.parse(plan);
      const response = await authenticatedFetch('/api/engineering/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          objective: objective.trim(),
          plan: parsedPlan,
          baseCommitSha: baseCommitSha.trim(),
          proposedDiff,
        }),
      });
      const payload = await response.json() as { jobId?: string; message?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Coding plan could not be persisted.');
      setStatus(payload.message || 'Plan persisted and awaiting independent approval.');
      setObjective('');
      setProposedDiff('');
      await loadJobs();
      if (payload.jobId) await loadJob(payload.jobId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Coding plan could not be persisted.');
    } finally {
      setBusy(false);
    }
  };

  const approveJob = async () => {
    if (!selectedJob) return;
    setBusy(true);
    setError(null);
    try {
      const { job } = selectedJob;
      const response = await authenticatedFetch(`/api/engineering/jobs/${encodeURIComponent(job.id)}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          planHash: job.planHash,
          baseCommitSha: job.baseCommitSha,
          proposedDiffHash: job.proposedDiffHash,
        }),
      });
      const payload = await response.json() as { error?: string; approvalStatus?: string };
      if (!response.ok) throw new Error(payload.error || 'Approval was not applied.');
      setStatus(`Plan approved: ${payload.approvalStatus || 'approved'}.`);
      await loadJob(job.id);
      await loadJobs();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Approval was not applied.');
    } finally {
      setBusy(false);
    }
  };

  const enqueueTask = async () => {
    if (!selectedJob || !taskPrompt.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const job = selectedJob.job;
      const response = await authenticatedFetch(`/api/engineering/jobs/${encodeURIComponent(job.id)}/coding-tasks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agent,
          prompt: taskPrompt.trim(),
          workspaceKey,
          maxAttempts: 3,
        }),
      });
      const payload = await response.json() as { taskId?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Coding task could not be queued.');
      setStatus(`Coding task ${payload.taskId ?? 'queued'} is persisted in the coding queue.`);
      setTaskPrompt('');
      await loadJob(job.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Coding task could not be queued.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto flex h-full min-h-[720px] max-w-[1800px] flex-col bg-[#0D0E15] text-[#F8FAFC]">
      <header className="flex flex-wrap items-center gap-3 border-b border-cyan-300/10 bg-[#0a0d14] px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200"><Code2 className="h-5 w-5" /></span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-300">RyanAI Studio</p>
            <h1 className="text-lg font-semibold text-white">Engineering Workbench</h1>
          </div>
        </div>
        <span className="ml-auto rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-400">Evidence-first · no autonomous merge</span>
        <button type="button" onClick={() => void loadJobs()} disabled={busy} className="rounded-lg border border-white/10 p-2 text-slate-300 hover:bg-white/5 disabled:opacity-50" aria-label="Refresh coding jobs"><RefreshCw className="h-4 w-4" /></button>
      </header>

      {(error || status) && (
        <div className="border-b border-white/10 px-5 py-3">
          {error ? <div role="alert" className="flex items-start gap-2 text-sm text-rose-200"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{error}</div> : <div role="status" className="flex items-start gap-2 text-sm text-emerald-200"><Check className="mt-0.5 h-4 w-4 shrink-0" />{status}</div>}
        </div>
      )}

      <div className="grid min-h-0 flex-1 lg:grid-cols-[260px_minmax(0,1fr)_380px]">
        <aside className="min-h-0 border-b border-white/10 bg-[#0a0d14] lg:border-b-0 lg:border-r">
          <div className="border-b border-white/10 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Workspace</p>
            <div className="mt-2 flex items-center gap-2 text-xs text-slate-300"><GitBranch className="h-3.5 w-3.5 text-cyan-300" />{workspaceKey}</div>
          </div>
          <div className="max-h-[420px] overflow-auto p-3">
            <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-600">Patch files</p>
            {changedFiles.length ? changedFiles.map((file) => (
              <div key={file} className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs text-slate-300">
                <FileCode2 className="h-3.5 w-3.5 text-cyan-300" />
                <span className="min-w-0 flex-1 truncate">{file}</span>
                <span className="text-[9px] text-slate-600">{languageFromPath(file)}</span>
              </div>
            )) : <p className="rounded-lg border border-dashed border-white/10 p-3 text-xs text-slate-600">Add a unified diff to populate the scoped file tree. The Studio does not invent repository files.</p>}
          </div>
          <div className="border-t border-white/10 p-3">
            <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-600">Recent plans</p>
            <div className="space-y-1">
              {jobs.slice(0, 12).map((job) => (
                <button key={job.id} type="button" onClick={() => void loadJob(job.id)} className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-white/[0.04]">
                  <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                  <span className="min-w-0 flex-1"><span className="block truncate text-xs text-slate-300">{job.objective}</span><span className="mt-0.5 block text-[9px] uppercase tracking-wider text-slate-600">{job.status} · {job.approvalStatus}</span></span>
                  <ChevronRight className="mt-0.5 h-3 w-3 text-slate-700" />
                </button>
              ))}
            </div>
          </div>
        </aside>

        <main className="min-h-0 overflow-auto">
          <div className="border-b border-white/10 bg-[#0d111b] px-5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100">Patch Editor</span>
              <span className="text-[10px] text-slate-600">Unified diff · secret scanning · exact base commit binding</span>
            </div>
          </div>
          <div className="grid gap-4 p-5 xl:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Objective</span>
              <input value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="What should RyanAI change?" className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-300/40" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Exact base commit SHA</span>
              <input value={baseCommitSha} onChange={(event) => setBaseCommitSha(event.target.value)} placeholder="40-character Git commit SHA" spellCheck={false} className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 font-mono text-xs text-slate-100 outline-none focus:border-cyan-300/40" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Workspace key</span>
              <input value={workspaceKey} onChange={(event) => setWorkspaceKey(event.target.value)} spellCheck={false} className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 font-mono text-xs text-slate-100 outline-none focus:border-cyan-300/40" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Coding agent</span>
              <select value={agent} onChange={(event) => setAgent(event.target.value as Agent)} className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-300/40">
                {AGENTS.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
          </div>
          <div className="px-5 pb-5">
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Proposed unified diff</span>
              <textarea value={proposedDiff} onChange={(event) => setProposedDiff(event.target.value)} spellCheck={false} placeholder={'diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@\n+...'} className="min-h-[360px] w-full resize-y rounded-xl border border-white/10 bg-[#070a10] p-4 font-mono text-xs leading-6 text-slate-200 outline-none focus:border-cyan-300/40" />
            </label>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => void submitJob()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-cyan-300 disabled:opacity-50"><ShieldCheck className="h-4 w-4" />Persist plan for independent approval</button>
              <span className="text-[10px] text-slate-600">{changedFiles.length} changed file{changedFiles.length === 1 ? '' : 's'} detected from the diff</span>
            </div>
          </div>
          <div className="border-t border-white/10 p-5">
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Plan JSON</span>
              <textarea value={plan} onChange={(event) => setPlan(event.target.value)} spellCheck={false} className="min-h-[220px] w-full resize-y rounded-xl border border-white/10 bg-[#070a10] p-4 font-mono text-xs leading-6 text-slate-300 outline-none focus:border-cyan-300/40" />
            </label>
          </div>
        </main>

        <aside className="min-h-0 overflow-auto border-t border-white/10 bg-[#0a0d14] lg:border-l lg:border-t-0">
          <div className="border-b border-white/10 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Evidence & execution</p>
            <p className="mt-1 text-xs text-slate-600">Every task stays bound to an approved plan, commit and diff.</p>
          </div>
          {!selectedJob ? (
            <div className="p-5">
              <div className="rounded-xl border border-dashed border-white/10 p-5 text-center">
                <Terminal className="mx-auto h-6 w-6 text-slate-600" />
                <p className="mt-3 text-sm text-slate-400">Select a plan to inspect evidence and execution controls.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-5 p-4">
              <section>
                <p className="text-[10px] uppercase tracking-wider text-slate-600">Selected plan</p>
                <h2 className="mt-1 text-sm font-semibold text-white">{selectedJob.job.objective}</h2>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
                  <Stat label="Status" value={selectedJob.job.status} />
                  <Stat label="Approval" value={selectedJob.job.approvalStatus} />
                  <Stat label="Evidence" value={String(selectedJob.job._count?.evidence ?? selectedJob.job.evidence?.length ?? 0)} />
                  <Stat label="Handoffs" value={String(selectedJob.job._count?.handoffs ?? selectedJob.job.handoffs?.length ?? 0)} />
                </div>
              </section>

              <section>
                <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-600">Verification</p>
                <div className="space-y-2">
                  {selectedJob.verificationChecks.map((check) => <div key={check.name} className="rounded-lg border border-white/10 bg-slate-950/50 p-2.5"><div className="flex items-center gap-2 text-xs text-slate-300"><CheckState status={check.status} />{check.name}</div><p className="mt-1 text-[9px] text-slate-600">{check.source}</p></div>)}
                </div>
                <p className="mt-2 text-[10px] text-slate-500">Evidence chain: {selectedJob.evidenceIntegrity?.valid === true ? 'valid' : 'unverified'}</p>
              </section>

              {selectedJob.job.approvalStatus === 'pending' && <button type="button" onClick={() => void approveJob()} disabled={busy} className="w-full rounded-lg border border-emerald-300/20 bg-emerald-300/5 px-3 py-2.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-300/10 disabled:opacity-50"><ShieldCheck className="mr-2 inline h-4 w-4" />Approve exact plan</button>}

              {selectedJob.job.approvalStatus === 'approved' && (
                <section className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.03] p-3">
                  <p className="text-[10px] uppercase tracking-wider text-cyan-300">Queue coding execution</p>
                  <textarea value={taskPrompt} onChange={(event) => setTaskPrompt(event.target.value)} placeholder="Instructions for the approved coding worker…" className="mt-2 min-h-28 w-full rounded-lg border border-white/10 bg-slate-950 p-3 text-xs text-slate-200 outline-none focus:border-cyan-300/40" />
                  <button type="button" onClick={() => void enqueueTask()} disabled={busy || !taskPrompt.trim()} className="mt-2 w-full rounded-lg bg-cyan-400 px-3 py-2.5 text-xs font-bold text-slate-950 hover:bg-cyan-300 disabled:opacity-50"><Play className="mr-2 inline h-4 w-4" />Queue approved task</button>
                </section>
              )}

              <section>
                <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-600">Bindings</p>
                <Binding label="Plan" value={selectedJob.job.planHash} />
                <Binding label="Base" value={selectedJob.job.baseCommitSha} />
                <Binding label="Diff" value={selectedJob.job.proposedDiffHash} />
              </section>

              <section>
                <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-600">Handoffs</p>
                <div className="space-y-1.5">
                  {(selectedJob.job.handoffs ?? []).map((handoff) => <div key={handoff.id} className="flex items-center gap-2 rounded-lg bg-slate-950/50 px-2.5 py-2 text-[10px] text-slate-400"><span>{handoff.fromAgent}</span><ChevronRight className="h-3 w-3 text-slate-700" /><span>{handoff.toAgent}</span><span className="ml-auto uppercase text-slate-600">{handoff.status}</span></div>)}
                </div>
              </section>

              <button type="button" onClick={() => setSelectedJob(null)} className="w-full rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-400 hover:bg-white/5"><X className="mr-2 inline h-3.5 w-3.5" />Close evidence</button>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-slate-950/60 p-2"><div className="text-[9px] uppercase tracking-wider text-slate-600">{label}</div><div className="mt-1 truncate text-xs text-slate-300">{value}</div></div>;
}

function Binding({ label, value }: { label: string; value: string }) {
  return <div className="mb-1.5 rounded-lg border border-white/5 bg-slate-950/50 p-2"><div className="text-[9px] uppercase text-slate-600">{label}</div><code className="mt-1 block break-all text-[9px] text-slate-400">{value}</code></div>;
}

function CheckState({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  if (normalized === 'pass' || normalized === 'passed' || normalized === 'approved') return <Check className="h-3.5 w-3.5 text-emerald-300" />;
  if (normalized === 'fail' || normalized === 'failed') return <CircleAlert className="h-3.5 w-3.5 text-rose-300" />;
  return <Activity className="h-3.5 w-3.5 text-amber-300" />;
}
