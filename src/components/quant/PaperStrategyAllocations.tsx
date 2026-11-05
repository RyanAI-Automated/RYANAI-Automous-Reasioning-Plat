import { useCallback, useEffect, useState } from 'react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { Layers3, Trash2 } from 'lucide-react';

type Strategy = {
  id: string;
  experiment_id: string;
  strategy: string;
  allocation_pct: string;
  enabled: boolean;
  created_at: string;
  metrics?: {
    total_return_pct?: number;
    max_drawdown_pct?: number;
    annualized_sharpe?: number;
    trade_count?: number;
  } | null;
};

export default function PaperStrategyAllocations() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/api/quant/paper/strategies');
      const data = await response.json() as { strategies?: Strategy[]; error?: string };
      if (!response.ok) throw new Error(data.error || 'Paper strategy allocations are unavailable.');
      setStrategies(data.strategies ?? []);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load paper strategies.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const remove = async (experimentId: string) => {
    setRemoving(experimentId);
    setError('');
    try {
      const response = await authenticatedFetch(`/api/quant/paper/strategies/${encodeURIComponent(experimentId)}`, { method: 'DELETE' });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Strategy could not be removed.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Strategy could not be removed.');
    } finally {
      setRemoving(null);
    }
  };

  const allocated = strategies.filter((item) => item.enabled).reduce((sum, item) => sum + Number(item.allocation_pct), 0);

  return (
    <section className="space-y-4 rounded-2xl border border-cyan-400/20 bg-slate-900/70 p-5 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Research → portfolio</p>
          <h2 className="mt-1 text-xl font-semibold text-white">Promoted paper strategies</h2>
          <p className="mt-1 text-sm text-slate-400">Completed Quant Lab experiments selected for paper portfolio tracking.</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Allocated target</p>
          <p className="text-lg font-semibold text-white">{allocated.toFixed(1)}% <span className="text-xs font-normal text-slate-500">/ 100%</span></p>
        </div>
      </header>
      {error && <p role="alert" className="rounded-lg border border-rose-400/30 p-3 text-sm text-rose-200">{error}</p>}
      {loading ? <p className="text-sm text-slate-400">Loading paper strategy allocations…</p> :
        strategies.length === 0 ? <div className="rounded-xl border border-dashed border-white/10 p-6 text-center"><Layers3 className="mx-auto h-6 w-6 text-slate-500" /><p className="mt-2 text-sm text-slate-300">No research strategies promoted yet.</p><p className="mt-1 text-xs text-slate-500">Run a backtest in Quant Lab, then add its completed result to this paper portfolio.</p></div> :
        <div className="space-y-3">
          {strategies.map((item) => (
            <article key={item.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-slate-950/60 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-white">{item.strategy.replaceAll('_', ' ')}</h3>
                  <span className="rounded-full border border-amber-300/20 px-2 py-0.5 text-[10px] text-amber-200">Paper plan · not auto-executing</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">Promoted {new Date(item.created_at).toLocaleString()}</p>
                {item.metrics && <p className="mt-2 text-xs text-slate-300">Historical return {item.metrics.total_return_pct ?? '—'}% · Max drawdown {item.metrics.max_drawdown_pct ?? '—'}% · Sharpe {item.metrics.annualized_sharpe ?? '—'} · Trades {item.metrics.trade_count ?? '—'}</p>}
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right"><p className="text-[10px] uppercase text-slate-500">Target allocation</p><p className="font-semibold tabular-nums text-cyan-100">{Number(item.allocation_pct).toFixed(1)}%</p></div>
                <button type="button" onClick={() => void remove(item.experiment_id)} disabled={removing === item.experiment_id} aria-label={`Remove ${item.strategy} from paper portfolio`} className="rounded-lg border border-white/10 p-2 text-slate-400 hover:border-rose-300/30 hover:text-rose-200 disabled:opacity-50"><Trash2 className="h-4 w-4" /></button>
              </div>
            </article>
          ))}
        </div>
      }
      <p className="text-xs leading-5 text-slate-500">Allocations are planning targets only. Promoting or removing a strategy never places, cancels or changes paper orders.</p>
    </section>
  );
}
