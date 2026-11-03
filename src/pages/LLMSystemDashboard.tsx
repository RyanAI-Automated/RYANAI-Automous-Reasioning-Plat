import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertCircle, BrainCircuit, Clock3, Cpu, RefreshCw, Wifi } from 'lucide-react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { API_BASE_URL } from '@/lib/apiBaseUrl';

type Brain = { brain: 'primary' | 'secondary' | 'logic'; model?: string; status: string; latencyMs?: number | null; lastError?: string | null };
const providers = [
  { id: 'primary', name: 'NVIDIA', role: 'Primary reasoning' },
  { id: 'secondary', name: 'Qwen', role: 'Secondary reasoning' },
  { id: 'logic', name: 'Logic', role: 'Logic and verification' },
] as const;

function statusTone(status?: string) {
  if (status === 'HEALTHY') return 'text-emerald-300 border-emerald-400/20 bg-emerald-400/5';
  if (status) return 'text-amber-200 border-amber-400/20 bg-amber-400/5';
  return 'text-slate-400 border-white/10 bg-white/[0.03]';
}

export default function LLMSystemDashboard() {
  const [brains, setBrains] = useState<Brain[]>([]);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authenticatedFetch(API_BASE_URL + '/api/agent/ops/brains', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Provider health request failed (HTTP ' + response.status + ').');
      const payload = await response.json() as { brains?: Brain[] };
      setBrains(Array.isArray(payload.brains) ? payload.brains : []);
      setCheckedAt(new Date().toISOString());
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Provider health is unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), 30000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, [refresh]);
  const byId = new Map(brains.map((brain) => [brain.brain, brain]));
  const healthy = brains.filter((brain) => brain.status === 'HEALTHY').length;
  return (
    <section className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">Model operations</p><h1 className="mt-2 text-3xl font-bold text-white">LLM System Dashboard</h1><p className="mt-2 max-w-2xl text-sm text-slate-400">Provider readiness from the authenticated brain-health API. Configuration presence is not treated as a successful live inference.</p></div>
        <button onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-sm text-white disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
      </header>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-slate-900/70 p-4"><div className="flex items-center gap-2 text-xs text-slate-400"><BrainCircuit className="h-4 w-4 text-cyan-300" /> Verified healthy</div><p className="mt-3 text-2xl font-semibold text-white">{brains.length ? healthy + ' / 3' : '—'}</p></div>
        <div className="rounded-xl border border-white/10 bg-slate-900/70 p-4"><div className="flex items-center gap-2 text-xs text-slate-400"><Activity className="h-4 w-4 text-cyan-300" /> Provider records</div><p className="mt-3 text-2xl font-semibold text-white">{brains.length} / 3</p></div>
        <div className="rounded-xl border border-white/10 bg-slate-900/70 p-4"><div className="flex items-center gap-2 text-xs text-slate-400"><Clock3 className="h-4 w-4 text-cyan-300" /> Last successful snapshot</div><p className="mt-3 text-sm font-medium text-white">{checkedAt ? new Date(checkedAt).toLocaleString() : 'Not available'}</p></div>
      </div>
      {error && <p role="alert" className="flex items-center gap-2 rounded-xl border border-rose-400/20 bg-rose-400/5 p-4 text-sm text-rose-200"><AlertCircle className="h-4 w-4" />{error}</p>}
      <div className="grid gap-4 lg:grid-cols-3">
        {providers.map((provider) => {
          const brain = byId.get(provider.id);
          return <article key={provider.id} className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
            <div className="flex items-center justify-between"><div className="flex items-center gap-2 text-cyan-200"><Cpu className="h-5 w-5" /><h2 className="font-semibold text-white">{provider.name}</h2></div><span className={`rounded-full border px-2.5 py-1 text-[11px] ${statusTone(brain?.status)}`}>{brain?.status ?? (loading ? 'CHECKING' : 'NOT REPORTED')}</span></div>
            <p className="mt-2 text-xs text-slate-500">{provider.role}</p>
            <dl className="mt-5 space-y-3 text-sm"><div className="flex justify-between gap-3 border-b border-white/5 pb-2"><dt className="text-slate-400">Reported model</dt><dd className="max-w-[60%] break-all text-right text-slate-200">{brain?.model || 'Not reported'}</dd></div><div className="flex justify-between gap-3 border-b border-white/5 pb-2"><dt className="text-slate-400">Latency</dt><dd className="text-slate-200">{typeof brain?.latencyMs === 'number' ? brain.latencyMs + ' ms' : 'Not reported'}</dd></div><div><dt className="text-slate-400">Last error</dt><dd className="mt-1 break-words text-xs text-rose-200">{brain?.lastError || 'None reported'}</dd></div></dl>
          </article>;
        })}
      </div>
      <div className="rounded-xl border border-white/10 bg-slate-900/50 p-4 text-xs leading-5 text-slate-400"><Wifi className="mr-2 inline h-4 w-4 text-cyan-300" />This view does not trigger billable provider probes and never displays credentials. A provider is healthy only when the API reports HEALTHY.</div>
    </section>
  );
}
