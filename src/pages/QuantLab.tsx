import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Activity, BarChart3, BrainCircuit, History, Play, ShieldCheck, type LucideIcon } from 'lucide-react';
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
type MarketDataImport = {
  id: string;
  symbol: string;
  provider: string;
  feed: string;
  timeframe: string;
  bar_count: number;
  last_bar_at: string;
  fetched_at: string;
  is_stale: boolean;
  provenance?: { coverageNote?: string };
};
type StrategySignal = {
  id: string;
  importId: string;
  symbol: string;
  strategy: string;
  action: 'buy' | 'sell' | 'hold';
  referencePrice: number;
  previousFastSma: number;
  previousSlowSma: number;
  fastSma: number;
  slowSma: number;
  generatedAt: string;
  sourceBarDate: string;
};

type Experiment = {
  id: string; strategy: string; status: string; createdAt: string;
  result?: BacktestResult | null;
};

const sampleShape = '[{"date":"YYYY-MM-DD","open":100,"high":102,"low":99,"close":101,"volume":1200}]';

export default function QuantLabPage() {
  const [barsJson, setBarsJson] = useState('');
  const [symbol, setSymbol] = useState('SPY');
  const [marketDataImports, setMarketDataImports] = useState<MarketDataImport[]>([]);
  const [selectedImportId, setSelectedImportId] = useState('');
  const [importsLoading, setImportsLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [marketDataError, setMarketDataError] = useState('');
  const [marketDataNotice, setMarketDataNotice] = useState('');
  const [generatingSignal, setGeneratingSignal] = useState(false);
  const [signalError, setSignalError] = useState('');
  const [currentSignal, setCurrentSignal] = useState<StrategySignal | null>(null);
  const [signalHistory, setSignalHistory] = useState<StrategySignal[]>([]);
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
  const [allocationPct, setAllocationPct] = useState('10');
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [promotionNotice, setPromotionNotice] = useState('');
  const [promotionError, setPromotionError] = useState('');

  const fetchHistory = useCallback(async () => {
    const response = await authenticatedFetch('/api/quant/experiments');
    if (!response.ok) throw new Error('Experiment history is unavailable.');
    const data = await response.json() as { experiments: Experiment[] };
    return data.experiments;
  }, []);
  const fetchMarketDataImports = useCallback(async () => {
    const response = await authenticatedFetch('/api/quant/market-data/imports');
    if (!response.ok) throw new Error('Saved market-data imports are unavailable.');
    const data = await response.json() as { imports: MarketDataImport[] };
    return data.imports;
  }, []);

  const fetchSignalHistory = useCallback(async () => {
    const response = await authenticatedFetch('/api/quant/strategy-signals');
    if (!response.ok) throw new Error('Strategy signal history is unavailable.');
    const data = await response.json() as { signals: StrategySignal[] };
    return data.signals;
  }, []);

  const loadSignalHistory = useCallback(async () => {
    setSignalHistory(await fetchSignalHistory());
  }, [fetchSignalHistory]);

  const importMarketData = async () => {
    setMarketDataError('');
    setMarketDataNotice('');
    setImporting(true);
    try {
      const response = await authenticatedFetch('/api/quant/market-data/imports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, limit: 250 }),
      });
      const data = await response.json() as { error?: string; import?: MarketDataImport };
      if (!response.ok || !data.import) throw new Error(data.error || 'Market-data import failed.');
      setMarketDataImports((current) => [data.import!, ...current.filter((item) => item.id !== data.import!.id)]);
      setSelectedImportId(data.import.id);
      setCurrentSignal(null);
      setMarketDataNotice(`Imported ${data.import.bar_count} completed daily bars for ${data.import.symbol} from Alpaca IEX.`);
      await loadSignalHistory();
    } catch (cause) {
      setMarketDataError(cause instanceof Error ? cause.message : 'Market-data import failed.');
    } finally {
      setImporting(false);
    }
  };

  const generateSignal = async () => {
    if (!selectedImportId) {
      setSignalError('Import or select a market-data dataset first.');
      return;
    }
    setSignalError('');
    setGeneratingSignal(true);
    try {
      const response = await authenticatedFetch('/api/quant/strategy-signals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          importId: selectedImportId,
          fastWindow: Number(fastWindow),
          slowWindow: Number(slowWindow),
        }),
      });
      const data = await response.json() as { error?: string; signal?: StrategySignal };
      if (!response.ok || !data.signal) throw new Error(data.error || 'Signal could not be validated.');
      setCurrentSignal(data.signal);
      await loadSignalHistory();
    } catch (cause) {
      setSignalError(cause instanceof Error ? cause.message : 'Signal validation failed.');
    } finally {
      setGeneratingSignal(false);
    }
  };

  const loadHistory = useCallback(async () => {
    try {
      setExperiments(await fetchHistory());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load experiment history.');
    } finally {
      setHistoryLoading(false);
    }
  }, [fetchHistory]);
  const applyHistory = useCallback((history: Experiment[]) => setExperiments(history), []);
  const applyHistoryError = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : 'Unable to load experiment history.');
  }, []);
  const finishHistoryLoad = useCallback(() => setHistoryLoading(false), []);

  useEffect(() => {
    let active = true;
    void fetchMarketDataImports().then((imports) => {
      if (active) {
        setMarketDataImports(imports);
        setSelectedImportId((current) => current || imports.find((item) => !item.is_stale)?.id || '');
      }
    }).catch((cause: unknown) => {
      if (active) setMarketDataError(cause instanceof Error ? cause.message : 'Unable to load market data.');
    }).finally(() => {
      if (active) setImportsLoading(false);
    });
    void fetchSignalHistory().then((signals) => {
      if (active) setSignalHistory(signals);
    }).catch((cause: unknown) => {
      if (active) setSignalError(cause instanceof Error ? cause.message : 'Unable to load signal history.');
    });
    return () => { active = false; };
  }, [fetchMarketDataImports, fetchSignalHistory]);

  useEffect(() => {
    let active = true;
    void fetchHistory().then(
      (history) => { if (active) applyHistory(history); },
      (cause) => { if (active) applyHistoryError(cause); },
    ).finally(() => { if (active) finishHistoryLoad(); });
    return () => { active = false; };
  }, [fetchHistory, applyHistory, applyHistoryError, finishHistoryLoad]);

  // Refresh persisted experiments while this workspace is open. Background
  // failures retain the last successful snapshot instead of disrupting the page.
  useEffect(() => {
    let active = true;
    const refreshHistory = async () => {
      try {
        const history = await fetchHistory();
        if (active) setExperiments(history);
      } catch {
        // The initial load already reports an error; background polls stay quiet.
      }
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshHistory();
    }, 30_000);
    const handleFocus = () => { void refreshHistory(); };
    window.addEventListener('focus', handleFocus);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchHistory]);

  const openExperiment = async (experimentId: string) => {
    setError('');
    try {
      const response = await authenticatedFetch(`/api/quant/experiments/${encodeURIComponent(experimentId)}`);
      const data = await response.json() as { error?: string; experiment?: { result?: BacktestResult | null } };
      if (!response.ok || !data.experiment?.result) throw new Error(data.error || 'Saved experiment result is unavailable.');
      setResult(data.experiment.result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to open saved experiment.');
    }
  };

  const promoteExperiment = async (experimentId: string) => {
    setPromotionError('');
    setPromotionNotice('');
    setPromotingId(experimentId);
    try {
      const response = await authenticatedFetch('/api/quant/paper/strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ experimentId, allocationPct: Number(allocationPct) }),
      });
      const data = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(data.error || 'Strategy could not be added to the paper portfolio.');
      setPromotionNotice(data.message || 'Strategy added to the paper portfolio plan.');
    } catch (cause) {
      setPromotionError(cause instanceof Error ? cause.message : 'Strategy promotion failed.');
    } finally {
      setPromotingId(null);
    }
  };

  const selectedDatasetIsStale = marketDataImports.some(
    (item) => item.id === selectedImportId && item.is_stale,
  );

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
    if (!selectedImportId) {
      try {
        bars = JSON.parse(barsJson);
        if (!Array.isArray(bars)) throw new Error('Paste an array of daily OHLCV rows.');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Market data must be valid JSON.');
        return;
      }
    }
    setRunning(true);
    try {
      const response = await authenticatedFetch('/api/quant/backtests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy: 'sma_crossover',
          ...(selectedImportId ? { market_data_import_id: selectedImportId } : { bars }),
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

      <section className="grid gap-5 xl:grid-cols-2">
        <article className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-5">
          <div>
            <h2 className="text-lg font-semibold text-white">Market data</h2>
            <p className="mt-1 text-sm text-slate-400">Import completed daily US equity/ETF bars through the server-side Alpaca IEX adapter. Provider keys never enter the browser.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="min-w-0 flex-1 text-xs text-slate-400">US ticker
              <input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} maxLength={15} autoCapitalize="characters" className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm uppercase text-white" placeholder="SPY" />
            </label>
            <button type="button" onClick={() => void importMarketData()} disabled={importing || !/^[A-Z0-9.-]{1,15}$/.test(symbol)} className="self-end rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">{importing ? 'Importing…' : 'Import 250 daily bars'}</button>
          </div>
          {marketDataError && <p role="alert" className="rounded-lg border border-rose-400/30 p-3 text-xs text-rose-200">{marketDataError}</p>}
          {marketDataNotice && <p role="status" className="rounded-lg border border-emerald-300/20 p-3 text-xs text-emerald-200">{marketDataNotice}</p>}
          <label className="block text-xs text-slate-400">Saved datasets
            <select value={selectedImportId} onChange={(event) => { setSelectedImportId(event.target.value); setCurrentSignal(null); }} disabled={importsLoading || marketDataImports.length === 0} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white">
              <option value="">Choose a saved import…</option>
              {marketDataImports.map((item) => <option key={item.id} value={item.id}>{item.symbol} · {item.provider.toUpperCase()} {item.feed.toUpperCase()} · {new Date(item.last_bar_at).toLocaleDateString()}{item.is_stale ? ' · STALE' : ''}</option>)}
            </select>
          </label>
          {importsLoading && <p className="text-xs text-slate-500">Loading saved datasets…</p>}
          {!importsLoading && marketDataImports.length === 0 && <p className="text-xs text-slate-500">No market-data imports yet. Configure Alpaca paper-data credentials on the API runtime to enable provider imports.</p>}
          <p className="text-xs leading-5 text-amber-200/80">Feed limitation: IEX is one US exchange, not consolidated SIP coverage. Datasets older than five days are blocked for new backtests and signals.</p>
        </article>

        <article className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-5">
          <div>
            <h2 className="text-lg font-semibold text-white">Strategy signal validation</h2>
            <p className="mt-1 text-sm text-slate-400">Evaluate a moving-average crossover against the selected saved dataset. A signal is research output only.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField label="Fast SMA window" value={fastWindow} onChange={setFastWindow} min="2" max="50" />
            <NumberField label="Slow SMA window" value={slowWindow} onChange={setSlowWindow} min="3" max="200" />
          </div>
          <button type="button" onClick={() => void generateSignal()} disabled={generatingSignal || !selectedImportId || selectedDatasetIsStale || Number(fastWindow) >= Number(slowWindow)} className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-100 disabled:opacity-50">{generatingSignal ? 'Validating signal…' : 'Generate SMA crossover signal'}</button>
          {signalError && <p role="alert" className="rounded-lg border border-rose-400/30 p-3 text-xs text-rose-200">{signalError}</p>}
          {currentSignal && <div role="status" className="rounded-xl border border-white/10 bg-slate-950/70 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs uppercase tracking-wider text-slate-400">{currentSignal.symbol} · {currentSignal.strategy.replaceAll('_', ' ')}</span>
              <span className={`rounded-full px-2 py-1 text-xs font-semibold uppercase ${currentSignal.action === 'buy' ? 'bg-emerald-300/10 text-emerald-200' : currentSignal.action === 'sell' ? 'bg-rose-300/10 text-rose-200' : 'bg-slate-700 text-slate-200'}`}>{currentSignal.action}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-300">
              <p>Reference close <strong>{currentSignal.referencePrice.toFixed(2)}</strong></p>
              <p>Source bar <strong>{currentSignal.sourceBarDate}</strong></p>
              <p>Fast SMA <strong>{currentSignal.fastSma.toFixed(4)}</strong></p>
              <p>Slow SMA <strong>{currentSignal.slowSma.toFixed(4)}</strong></p>
            </div>
            <p className="mt-2 text-xs text-amber-200/80">No order was created, scheduled or executed.</p>
          </div>}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Recent signals</h3>
            {signalHistory.length === 0 ? <p className="mt-2 text-xs text-slate-500">No saved signals yet.</p> :
              <ul className="mt-2 space-y-2">
                {signalHistory.slice(0, 5).map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/5 bg-slate-950/50 p-2 text-xs"><span className="text-slate-300">{item.symbol} · {item.action.toUpperCase()}</span><span className="text-slate-500">{item.sourceBarDate}</span></li>)}
              </ul>}
          </div>
        </article>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <form onSubmit={runBacktest} className="space-y-4 rounded-2xl border border-cyan-400/20 bg-slate-900/70 p-5 sm:p-6">
          <div>
            <h2 className="text-lg font-semibold text-white">New historical experiment</h2>
            <p className="mt-1 text-sm text-slate-400">{selectedImportId ? 'Backtest the selected server-stored import. The API reloads the owned bars and provenance.' : 'Select a saved import above, or use optional manual OHLCV JSON for offline research. At least 30 rows are required.'}</p>
          </div>
          <label className="block text-sm font-medium text-slate-200">
            Optional manual OHLCV fallback (JSON)
            <textarea
              value={barsJson}
              onChange={(event) => setBarsJson(event.target.value)}
              rows={5}
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
          <button type="submit" disabled={running || (selectedImportId ? selectedDatasetIsStale : !barsJson.trim())} className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50">
            <Play className="h-4 w-4" /> {running ? 'Running isolated backtest…' : 'Run backtest'}
          </button>
          <p className="text-xs leading-5 text-slate-500">The isolated Python engine receives validated historical bars only. It does not access provider keys, broker accounts or live-order APIs. Strategy signals are not order instructions.</p>
        </form>

        <aside className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6">
          <div>
            <h2 className="text-lg font-semibold text-white">Recent experiments</h2>
            <p className="mt-1 text-xs text-slate-500">Promote completed research into the separate Trading Terminal as a paper allocation plan.</p>
          </div>
          <label className="block text-xs text-slate-400">Target portfolio allocation (%)
            <input type="number" min="1" max="100" step="1" value={allocationPct} onChange={(event) => setAllocationPct(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" />
          </label>
          {promotionError && <p role="alert" className="rounded-lg border border-rose-400/30 p-3 text-xs text-rose-200">{promotionError}</p>}
          {promotionNotice && <p role="status" className="rounded-lg border border-emerald-300/20 p-3 text-xs text-emerald-200">{promotionNotice} <a href="#/trading" className="underline">Open Trading Terminal</a></p>}
          {historyLoading ? <p className="text-sm text-slate-400">Loading saved runs…</p> :
            experiments.length === 0 ? <p className="text-sm text-slate-400">No saved experiments yet. Run a backtest to create your first traceable result.</p> :
            <ul className="space-y-3">
              {experiments.map((item) => (
                <li key={item.id} className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                  <button type="button" onClick={() => void openExperiment(item.id)} className="w-full text-left transition hover:text-cyan-100">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-white">{item.strategy.replaceAll('_', ' ')}</span>
                      <span className="text-[10px] uppercase tracking-wider text-emerald-300">{item.status}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{new Date(item.createdAt).toLocaleString()}</p>
                    {item.result?.metrics && <p className="mt-2 text-xs text-slate-300">Return: {item.result.metrics.total_return_pct}% · Max drawdown: {item.result.metrics.max_drawdown_pct}%</p>}
                    <span className="mt-2 inline-block text-xs text-cyan-200">Open saved result →</span>
                  </button>
                  {item.status === 'completed' && item.result && <button type="button" onClick={() => void promoteExperiment(item.id)} disabled={promotingId !== null || !Number.isFinite(Number(allocationPct)) || Number(allocationPct) < 1 || Number(allocationPct) > 100} className="mt-3 w-full rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-xs font-medium text-cyan-100 disabled:opacity-50">{promotingId === item.id ? 'Adding paper strategy…' : 'Add to paper portfolio'}</button>}
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
