import { useCallback, useEffect, useState } from 'react';
import { Activity, Cpu, RefreshCw, ShieldAlert } from 'lucide-react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { API_BASE_URL } from '@/lib/apiBaseUrl';

type BrainConfig = { brain: string; model: string; endpointHost: string; credentialConfigured: boolean; configurationSource: string; mutableAtRuntime: boolean };
type ModelPayload = { brains?: BrainConfig[]; configurationPolicy?: string };
type UsagePayload = { windowDays?: number; totalRuns?: number; runsLast30Days?: number; runsByStatus?: Array<{ status: string; count: number }>; usageAccounting?: { providerRequests?: string; inputTokens?: string; outputTokens?: string; estimatedCost?: string; note?: string } };

export default function ModelUsagePanel() {
  const [models, setModels] = useState<BrainConfig[]>([]);
  const [usage, setUsage] = useState<UsagePayload | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [modelResponse, usageResponse] = await Promise.all([
        authenticatedFetch(API_BASE_URL + '/api/admin/models', { headers: { Accept: 'application/json' } }),
        authenticatedFetch(API_BASE_URL + '/api/admin/usage', { headers: { Accept: 'application/json' } }),
      ]);
      if (!modelResponse.ok || !usageResponse.ok) throw new Error('Admin model or usage request was denied or unavailable.');
      const modelData = await modelResponse.json() as ModelPayload;
      const usageData = await usageResponse.json() as UsagePayload;
      setModels(Array.isArray(modelData.brains) ? modelData.brains : []);
      setUsage(usageData);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load model operations.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [refresh]);

  return (
    <section className="space-y-4 rounded-2xl border border-white/10 bg-slate-950/70 p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="flex items-center gap-2 font-semibold text-white"><Cpu className="h-5 w-5 text-cyan-300" /> Model configuration and usage</h2><p className="mt-1 text-xs text-slate-400">Server-side configuration visibility and persisted execution counts.</p></div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
      </header>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      {loading && <p role="status" className="text-sm text-slate-400">Loading model configuration…</p>}
      {!loading && !error && <div className="grid gap-3 md:grid-cols-3">
        {models.map((brain) => <article key={brain.brain} className="rounded-xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-wider text-cyan-300">{brain.brain}</p><h3 className="mt-2 break-words text-sm font-semibold text-white">{brain.model}</h3><p className="mt-2 text-xs text-slate-400">Endpoint host: {brain.endpointHost}</p><p className="mt-1 text-xs text-slate-400">Credential: {brain.credentialConfigured ? 'configured (value hidden)' : 'not configured'}</p><p className="mt-1 text-xs text-slate-500">Runtime changes: disabled</p></article>)}
      </div>}
      {!loading && !error && usage && <div className="grid gap-3 sm:grid-cols-2">
        <article className="rounded-xl border border-white/10 bg-slate-900/70 p-4"><div className="flex items-center gap-2 text-cyan-200"><Activity className="h-4 w-4" /><span className="text-xs">Persisted executions</span></div><p className="mt-2 text-2xl font-bold tabular-nums text-white">{usage.totalRuns ?? '—'}</p><p className="text-xs text-slate-400">Total runs · {usage.runsLast30Days ?? '—'} in the last 30 days</p></article>
        <article className="rounded-xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs text-slate-400">Run status breakdown</p><div className="mt-2 flex flex-wrap gap-2">{(usage.runsByStatus ?? []).map((item) => <span key={item.status} className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-slate-300">{item.status}: {item.count}</span>)}</div></article>
      </div>}
      {!loading && usage?.usageAccounting && <p className="flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs leading-5 text-amber-100/80"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />Token counts, provider request counts and billing cost are not yet instrumented. This dashboard reports persisted run counts only; it does not invent token or cost estimates.</p>}
    </section>
  );
}
