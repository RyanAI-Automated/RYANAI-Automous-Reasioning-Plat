import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Activity, BarChart3, BrainCircuit, History, Play, ShieldCheck, TrendingUp, type LucideIcon } from 'lucide-react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';

type EquityPoint = { date: string; equity: number };
type Trade = { date: string; side: 'buy' | 'sell'; price: number; quantity: number; fee: number; realized_pnl?: number };
type BacktestResult = {
  strategy: string;
  period: { start: string; end: string; bars: number };
  metrics: {
    initial_cash: number; final_equity: number; total_return_pct: number;
    max_drawdown_pct: number; annualized_sharpe: number; trade_count: number;
    closed_trade_count: number; win_rate_pct: number; fees_and_slippage_bps: number;
  };
  equity_curve: EquityPoint[];
  trades: Trade[];
  execution_mode: string;
  disclaimer: string;
};
type Experiment = {
  id: string; strategy: string; status: string; createdAt: string;
  result?: { metrics?: BacktestResult['metrics']; period?: BacktestResult['period'] } | null;
};

const sampleShape = '[\\n  { "date": "YYYY-MM-DD", "open": 100, "high": 102, "low": 99, "close": 101, "volume": 1200 }\\n]';

export default function QuantLabPage() {
  const [barsJson, setBarsJson] = useState('');
  const [initialCash, setInitialCash] = useState('10000');
  const [fastWindow, setFastWindow] = useState('5');
  const [slowWindow, setSlowWindow] = useState('20');
  const [feeBps, setFeeBps] = useState('5');
  const [slippageBps, setSlippageBps] = useState('5');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/api/quant/experiments');
      if (!response.ok) throw new Error('Experiment history is unavailable.');
      const data = await response.json() as { experiments: Experiment[] };
      setExperiments(data.experiments);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load experiment history.');
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => { void loadHistory(); }, []);

  const chartPoints = useMemo(() => {
    const values = result?.equity_curve ?? [];
    if (values.length < 2) return '';
    const equities = values.map((point) => point.equity);
    const min = Math.min(...equities);
    const max = Math.max(...equities);
    const range = max - min || 1;
    return equities.map((value, index) => {
      const x = (index / (equities.length - 1)) * 1000;
      const y = 180 - ((value - min) / range) * 160;
      return `${x},${y}`;
    }).join(' ');
  }, [result]);

  const runBacktest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setResult(null);
    let bars: unknown;
    try {
      bars = JSON.parse(barsJson);
      if (!Array.isArray(bars)) throw new Error('Paste an array of daily OHLCV rows.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Market data must be valid JSON.');
      return;
    }
    setRunning(true);
    try {
      const response = await authenticatedFetch('/api/quant/backtests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy: 'sma_crossover', bars,
          initial_cash: Number(initialCash), fast_window: Number(fastWindow),
          slow_window: Number(slowWindow), fee_bps: Number(feeBps),
          slippage_bps: Number(slippageBps),
        }),
      });
      const data = await response.json() as { error?: string; result?: BacktestResult };
      if (!response.ok || !data.result) throw new Error(data.error || 'Backtest could not be completed.');
      setResult(data.result);
      await loadHistory();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Backtest failed.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="mx-auto max-w-7xl space-y-6 px-5 py-8 sm:px-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">RyanAI · Research workspace</p>
          <h1 className="mt-2 text-3xl font-bold text-white">Quant Intelligence &amp; Trading Lab</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
            Run reproducible historical experiments through RyanAI's isolated Python engine.
            Results are saved to your account and can be inspected after each run.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-300/5 px-3 py-1.5 text-xs font-medium text-amber-200">
          <Activity className="h-3.5 w-3.5" /> Historical simulation only · no broker connected
        </span>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Module icon={BrainCircuit} title="Strategy studio" detail="SMA crossover strategy with configurable windows." />
        <Module icon={BarChart3} title="Backtesting" detail="Next-bar-open fills, fees, slippage and equity curve." />
        <Module icon={History} title="Experiment history" detail="Saved, user-scoped runs and reproducible inputs." />
        <Module icon={ShieldCheck} title="Risk analytics" detail="Drawdown, volatility-adjusted return and trade outcomes." />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <form onSubmit={runBacktest} className="space-y-4 rounded-2xl border border-cyan-400/20 bg-slate-900/70 p-5 sm:p-6">
          <div>
            <h2 className="text-lg font-semibold text-white">New historical experiment</h2>
            <p className="mt-1 text-sm text-slate-400">Paste daily OHLCV JSON from a trusted data source. At least 30 chronologically ordered rows are required.</p>
          </div>
          <label className="block text-sm font-medium text-slate-200">
            Historical market data (JSON)
            <textarea
              value={barsJson}
              onChange={(event) => setBarsJson(event.target.value)}
              required
              rows={8}
              spellCheck={false}
              placeholder={sampleShape}
              className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-200 outline-none focus:border-cyan-300"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <NumberField label="Starting virtual cash" value={initialCash} onChange={setInitialCash} min="1" step="100" />
            <NumberField label="Fast SMA window" value={fastWindow} onChange={setFastWindow} min="2" max="50" />
            <NumberField label="Slow SMA window" value={slowWindow} onChange={setSlowWindow} min="3" max="200" />
            <NumberField label="Trading fee (bps)" value={feeBps} onChange={setFeeBps} min="0" max="1000" step="0.5" />
            <NumberField label="Slippage (bps)" value={slippageBps} onChange={setSlippageBps} min="0" max="1000" step="0.5" />
          </div>
          {error && <p role="alert" className="rounded-lg border border-rose-400/30 bg-rose-400/5 p-3 text-sm text-rose-200">{error}</p>}
          <button type="submit" disabled={running || !barsJson.trim()} className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50">
            <Play className="h-4 w-4" /> {running ? 'Running isolated backtest…' : 'Run backtest'}
          </button>
          <p className="text-xs leading-5 text-slate-500">The engine is dependency-free and runs in an isolated Python process. It does not access networks, provider keys, broker accounts or live-order APIs.</p>
        </form>

        <aside className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-white">Recent experiments</h2>
          {historyLoading ? <p className="text-sm text-slate-400">Loading saved runs…</p> :
            experiments.length === 0 ? <p className="text-sm text-slate-400">No saved experiments yet. Run a backtest to create your first traceable result.</p> :
            <ul className="space-y-3">
              {experiments.map((item) => (
                <li key={item.id} className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-white">{item.strategy.replaceAll('_', ' ')}</span>
                    <span className="text-[10px] uppercase tracking-wider text-emerald-300">{item.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{new Date(item.createdAt).toLocaleString()}</p>
                  {item.result?.metrics && <p className="mt-2 text-xs text-slate-300">Return: {item.result.metrics.total_return_pct}% · Max drawdown: {item.result.metrics.max_drawdown_pct}%</p>}
                </li>
              ))}
            </ul>
          }
        </aside>
      </div>

      {result && (
        <section aria-live="polite" className="space-y-5 rounded-2xl border border-cyan-400/20 bg-slate-900/70 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="text-xl font-semibold text-white">Backtest result</h2><p className="mt-1 text-xs text-slate-400">{result.period.start} → {result.period.end} · {result.period.bars} bars · {result.execution_mode}</p></div>
            <span className="rounded-full border border-emerald-300/30 px-3 py-1 text-xs text-emerald-200">Saved to your history</span>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Final equity" value={result.metrics.final_equity.toLocaleString()} />
            <Metric label="Total return" value={`${result.metrics.total_return_pct}%`} />
            <Metric label="Max drawdown" value={`${result.metrics.max_drawdown_pct}%`} />
            <Metric label="Annualized Sharpe" value={String(result.metrics.annualized_sharpe)} />
            <Metric label="Trades" value={String(result.metrics.trade_count)} />
            <Metric label="Win rate" value={`${result.metrics.win_rate_pct}%`} />
            <Metric label="Starting cash" value={result.metrics.initial_cash.toLocaleString()} />
            <Metric label="Fee + slippage" value={`${result.metrics.fees_and_slippage_bps} bps`} />
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3">
            <h3 className="mb-2 text-sm font-medium text-slate-200">Equity curve</h3>
            <svg viewBox="0 0 1000 200" role="img" aria-label="Backtested portfolio equity curve" className="h-48 w-full">
              <polyline points={chartPoints} fill="none" stroke="#00F2FE" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
            <div className="flex justify-between text-[10px] text-slate-500"><span>{result.period.start}</span><span>{result.period.end}</span></div>
          </div>
          <div className="overflow-x-auto">
            <h3 className="mb-2 text-sm font-medium text-slate-200">Execution ledger</h3>
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="text-slate-500"><tr><th className="p-2">Date</th><th className="p-2">Side</th><th className="p-2">Price</th><th className="p-2">Quantity</th><th className="p-2">Fee</th><th className="p-2">Realized P&amp;L</th></tr></thead>
              <tbody>{result.trades.map((trade, index) => <tr key={index} className="border-t border-white/5 text-slate-300"><td className="p-2">{trade.date}</td><td className="p-2 uppercase">{trade.side}</td><td className="p-2">{trade.price}</td><td className="p-2">{trade.quantity}</td><td className="p-2">{trade.fee}</td><td className="p-2">{trade.realized_pnl ?? '—'}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="text-xs leading-5 text-amber-200/80">{result.disclaimer}</p>
        </section>
      )}
    </section>
  );
}

function Module({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><Icon className="h-5 w-5 text-cyan-300" /><h2 className="mt-3 text-sm font-semibold text-white">{title}</h2><p className="mt-1 text-xs leading-5 text-slate-400">{detail}</p></article>;
}

function NumberField({ label, value, onChange, min, max, step = '1' }: { label: string; value: string; onChange: (value: string) => void; min: string; max?: string; step?: string }) {
  return <label className="block text-xs text-slate-400">{label}<input type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(event.target.value)} required className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300" /></label>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-lg font-semibold text-slate-100">{value}</p></div>;
}
