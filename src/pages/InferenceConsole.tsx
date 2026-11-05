import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, BrainCircuit, Clock3, RefreshCw, ShieldCheck } from 'lucide-react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { API_BASE_URL } from '@/lib/apiBaseUrl';
import { getSnapshotFreshness } from '@/lib/healthFreshness';

type BrainId = 'primary' | 'secondary' | 'logic';
interface BrainHealth {
  brain: BrainId;
  model?: string;
  status: string;
  latencyMs?: number | null;
  lastError?: string | null;
}
interface BrainHealthResponse { brains?: BrainHealth[]; }

const labels: Record<BrainId, string> = {
  primary: 'NVIDIA · Primary',
  secondary: 'Qwen · Secondary',
  logic: 'Logic · Independent reviewer',
};
const STALE_AFTER_MS = 60_000;

/** Read-only view of provider health; model selection and benchmark execution stay gated elsewhere. */
export default function InferenceConsolePage() {
  const [brains, setBrains] = useState<BrainHealth[]>([]);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await authenticatedFetch(API_BASE_URL + '/api/agent/ops/brains', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
      });
      if (!response.ok) throw new Error('Provider health request failed (HTTP ' + response.status + ').');
      const payload = await response.json() as BrainHealthResponse;
      setBrains(Array.isArray(payload.brains) ? payload.brains : []);
      setCheckedAt(new Date().toISOString());
      setError(null);
    } catch (cause) {
      if (signal?.aborted) return;
      setError(cause instanceof Error ? cause.message : 'Provider health is unavailable.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const poll = window.setInterval(() => void refresh(), 20_000);
    const clock = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => {
      controller.abort();
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, [refresh]);

  const freshness = getSnapshotFreshness(checkedAt, now, STALE_AFTER_MS);
  const current = freshness === 'fresh';
  const stale = freshness === 'stale';
  const byId = useMemo(() => new Map(brains.map((brain) => [brain.brain, brain])), [brains]);
  const healthyCount = current ? brains.filter((brain) => brain.status === 'HEALTHY').length : 0;

  return (
    <section className="mx-auto max-w-7xl space-y-6 px-5 py-8 sm:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Model operations</p>
          <h1 className="mt-2 text-3xl font-bold text-white">Inference Console</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            Inspect independently reported provider readiness. This page is read-only: it does not change model routing,
            start provider probes, or promote a model into production.
          </p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/25 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-300/10 disabled:opacity-50">
          <RefreshCw className={'h-4 w-4 ' + (loading ? 'animate-spin' : '')} /> Refresh status
        </button>
      </header>

      {error && <p role="alert" className="rounded-xl border border-rose-300/20 bg-rose-300/5 p-4 text-sm text-rose-200">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Summary label="Verified healthy" value={current ? healthyCount + ' / 3' : 'Unverified'} detail={current ? 'Fresh provider snapshot' : stale ? 'Last snapshot is stale' : 'Awaiting a valid snapshot'} />
        <Summary label="Snapshot status" value={stale ? 'Stale' : current ? 'Fresh' : 'Unknown'} detail={checkedAt ? 'Read ' + new Date(checkedAt).toLocaleTimeString() : 'No successful read yet'} />
        <Summary label="Routing authority" value="Governed" detail="Provider health does not authorize model promotion" />
      </div>

      {stale && <div role="status" className="flex items-start gap-3 rounded-xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm text-amber-100">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        The last provider snapshot is older than 60 seconds. Last-known states are shown for context and are not counted as currently healthy.
      </div>}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold text-white">Three-brain provider status</h2><p className="mt-1 text-xs text-slate-500">Data from the authenticated brain-operations health endpoint.</p></div>
          <span className="text-xs text-slate-500">{loading && !checkedAt ? 'Loading…' : checkedAt ? 'Updated ' + new Date(checkedAt).toLocaleString() : 'Not reported'}</span>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {(['primary', 'secondary', 'logic'] as BrainId[]).map((id) => {
            const brain = byId.get(id);
            const healthy = current && brain?.status === 'HEALTHY';
            const failed = current && brain && ['FAILED', 'UNHEALTHY', 'ERROR'].includes(brain.status);
            const tone = healthy ? 'text-emerald-300' : failed ? 'text-rose-300' : 'text-amber-200';
            return <article key={id} className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><BrainCircuit className="h-4 w-4 text-cyan-300" />{labels[id]}</h3>
                <span className={'text-[10px] font-semibold uppercase tracking-wider ' + tone}>{stale ? 'STALE' : current ? brain?.status || 'UNKNOWN' : 'UNKNOWN'}</span>
              </div>
              <p className="mt-4 truncate text-sm text-slate-300" title={brain?.model}>{brain?.model || 'Model not reported'}</p>
              <div className="mt-3 flex items-center justify-between text-xs"><span className="text-slate-500">Reported latency</span><span className="text-slate-300">{current && typeof brain?.latencyMs === 'number' ? brain.latencyMs + ' ms' : 'Not current'}</span></div>
              {brain?.lastError && <p className="mt-3 break-words text-xs text-rose-300">{brain.lastError}</p>}
              <p className="mt-3 border-t border-white/5 pt-3 text-[11px] text-slate-500">{healthy ? 'Fresh health signal verified' : 'Requires attention or verification'}</p>
            </article>;
          })}
        </div>
        {!loading && !error && brains.length === 0 && <p className="rounded-xl border border-dashed border-white/15 p-4 text-sm text-slate-400">The API returned no provider health records.</p>}
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <article className="rounded-xl border border-white/10 bg-slate-950/50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white"><ShieldCheck className="h-4 w-4 text-cyan-300" /> Benchmark and promotion gate</div>
          <p className="mt-2 text-sm leading-6 text-slate-400">Offline model comparison is a separate, isolated six-gate process. No benchmark run or promotion decision is exposed here, and provider availability alone is not model-quality evidence.</p>
          <p className="mt-3 text-xs text-amber-200">Evaluation status: not reported by this endpoint</p>
        </article>
        <article className="rounded-xl border border-white/10 bg-slate-950/50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white"><Activity className="h-4 w-4 text-cyan-300" /> Continue operations review</div>
          <p className="mt-2 text-sm leading-6 text-slate-400">Use the Cockpit to inspect persisted reasoning activity and the Operator Console to review durable task handoffs.</p>
          <div className="mt-3 flex flex-wrap gap-3 text-xs"><a className="text-cyan-200 hover:text-cyan-100" href="#/cockpit">Open Command Cockpit →</a><a className="text-cyan-200 hover:text-cyan-100" href="#/operator">Open Operator Console →</a></div>
        </article>
      </section>
      <p className="flex items-center gap-2 text-[11px] text-slate-600"><Clock3 className="h-3.5 w-3.5" /> Refreshes every 20 seconds while this page is open.</p>
    </section>
  );
}

function Summary({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="rounded-xl border border-white/10 bg-slate-950/50 p-4">
    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
    <p className="mt-2 text-xl font-semibold text-white">{value}</p>
    <p className="mt-1 text-xs text-slate-500">{detail}</p>
  </article>;
}
