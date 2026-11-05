import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { ArrowDownToLine, ArrowUpFromLine, RefreshCw, ShieldCheck } from 'lucide-react';

type Position = { symbol: string; quantity: string; average_entry_price: string; last_price: string; market_value: string; unrealized_pnl: string };
type Trade = { id: string; symbol: string; side: string; quantity: string; price: string; fee: string; realized_pnl: string | null; created_at: string };
type StrategySignal = {
  id: string;
  symbol: string;
  strategy: string;
  action: 'buy' | 'sell' | 'hold';
  referencePrice: number;
  generatedAt: string;
  sourceBarDate: string;
};
type Snapshot = {
  mode: 'paper_simulation_only'; brokerConnected: false;
  risk: { maxOrderNotional: number; feeBps: number; shortSelling: boolean };
  account: { startingCash: number; cash: number; marketValue: number; equity: number };
  positions: Position[]; trades: Trade[];
};
type RiskPolicy = {
  tradingEnabled: boolean;
  maxOrderNotional: number;
  maxPositionNotional: number;
  maxGrossExposure: number;
  hardCaps?: { maxOrderNotional: number; maxPositionNotional: number; maxGrossExposure: number };
};
type RiskState = {
  tradingEnabled: boolean;
  emergencyStop: boolean;
  emergencyStopReason: string | null;
  maxDailyLoss: number;
  maxDrawdownPct: number;
  dailyRisk: {
    risk_date: string;
    starting_equity: string;
    current_equity: string;
    daily_loss: string;
  } | null;
  portfolioRisk: {
    peak_equity: string;
    current_equity: string;
    max_drawdown_pct: string;
  } | null;
  enforcement?: string;
};

const money = (value: number | string) => Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PaperTradingPanel() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [riskPolicy, setRiskPolicy] = useState<RiskPolicy>({
    tradingEnabled: true, maxOrderNotional: 10000,
    maxPositionNotional: 25000, maxGrossExposure: 75000,
  });
  const [riskSaving, setRiskSaving] = useState(false);
  const [riskMessage, setRiskMessage] = useState('');
  const [riskState, setRiskState] = useState<RiskState>({
    tradingEnabled: true,
    emergencyStop: false,
    emergencyStopReason: null,
    maxDailyLoss: 5000,
    maxDrawdownPct: 10,
    dailyRisk: null,
    portfolioRisk: null,
  });
  const [riskStateSaving, setRiskStateSaving] = useState(false);
  const [riskStateMessage, setRiskStateMessage] = useState('');
  const [emergencyAction, setEmergencyAction] = useState(false);
  const [strategySignals, setStrategySignals] = useState<StrategySignal[]>([]);
  const [selectedSignalId, setSelectedSignalId] = useState('');
  const [symbol, setSymbol] = useState('AAPL');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('100');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [response, riskResponse, signalResponse, riskStateResponse] = await Promise.all([
        authenticatedFetch('/api/quant/paper'),
        authenticatedFetch('/api/quant/paper/risk'),
        authenticatedFetch('/api/quant/strategy-signals'),
        authenticatedFetch('/api/quant/paper/risk/state'),
      ]);
      const data = await response.json() as Snapshot & { error?: string };
      const riskData = await riskResponse.json() as RiskPolicy & { error?: string };
      const signalData = await signalResponse.json() as { signals?: StrategySignal[]; error?: string };
      const riskStateData = await riskStateResponse.json() as RiskState & { error?: string };
      if (!response.ok) throw new Error(data.error || 'Paper trading account is unavailable.');
      if (!riskResponse.ok) throw new Error(riskData.error || 'Paper risk policy is unavailable.');
      if (!signalResponse.ok) throw new Error(signalData.error || 'Strategy signal history is unavailable.');
      if (!riskStateResponse.ok) throw new Error(riskStateData.error || 'Paper risk state is unavailable.');
      setSnapshot(data);
      setRiskPolicy(riskData);
      setRiskState(riskStateData);
      const signals = signalData.signals ?? [];
      setStrategySignals(signals);
      setSelectedSignalId((current) => current || signals[0]?.id || '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load paper trading.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const recentTrades = snapshot?.trades ?? [];
  const closedSellTrades = recentTrades.filter((trade) => trade.realized_pnl !== null);
  const recordedExitPnl = closedSellTrades.reduce(
    (total, trade) => total + Number(trade.realized_pnl ?? 0),
    0,
  );
  const recordedFees = recentTrades.reduce(
    (total, trade) => total + Number(trade.fee ?? 0),
    0,
  );
  const winningExits = closedSellTrades.filter((trade) => Number(trade.realized_pnl) > 0).length;
  const exitWinRate = closedSellTrades.length > 0
    ? (winningExits / closedSellTrades.length) * 100
    : null;
  const selectedSignal = strategySignals.find((signal) => signal.id === selectedSignalId)
    ?? strategySignals[0]
    ?? null;

  const saveRiskPolicy = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setRiskMessage('');
    setRiskSaving(true);
    try {
      const response = await authenticatedFetch('/api/quant/paper/risk', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tradingEnabled: riskPolicy.tradingEnabled,
          maxOrderNotional: Number(riskPolicy.maxOrderNotional),
          maxPositionNotional: Number(riskPolicy.maxPositionNotional),
          maxGrossExposure: Number(riskPolicy.maxGrossExposure),
        }),
      });
      const data = await response.json() as RiskPolicy & { error?: string };
      if (!response.ok) throw new Error(data.error || 'Risk policy could not be saved.');
      setRiskPolicy(data);
      setRiskMessage('Paper risk policy saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Risk policy could not be saved.');
    } finally {
      setRiskSaving(false);
    }
  };

  const saveDailyRiskLimits = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setRiskStateMessage('');
    setRiskStateSaving(true);
    try {
      const response = await authenticatedFetch('/api/quant/paper/risk/limits', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxDailyLoss: Number(riskState.maxDailyLoss),
          maxDrawdownPct: Number(riskState.maxDrawdownPct),
        }),
      });
      const data = await response.json() as { error?: string; maxDailyLoss?: number; maxDrawdownPct?: number };
      if (!response.ok) throw new Error(data.error || 'Daily risk limits could not be saved.');
      setRiskState((current) => ({
        ...current,
        maxDailyLoss: data.maxDailyLoss ?? current.maxDailyLoss,
        maxDrawdownPct: data.maxDrawdownPct ?? current.maxDrawdownPct,
      }));
      setRiskStateMessage('Daily loss and drawdown limits saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Daily risk limits could not be saved.');
    } finally {
      setRiskStateSaving(false);
    }
  };

  const triggerEmergencyStop = async () => {
    if (!window.confirm('Activate the emergency stop? All new paper orders will be blocked until you explicitly reset it.')) return;
    setError('');
    setRiskStateMessage('');
    setEmergencyAction(true);
    try {
      const response = await authenticatedFetch('/api/quant/paper/risk/emergency-stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'manual_emergency_stop' }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Emergency stop could not be activated.');
      setRiskStateMessage('Emergency stop active. New paper orders are blocked.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Emergency stop could not be activated.');
    } finally {
      setEmergencyAction(false);
    }
  };

  const resetEmergencyStop = async () => {
    if (!window.confirm('Reset the emergency-stop latch? Paper trading will remain disabled and must be re-enabled separately.')) return;
    setError('');
    setRiskStateMessage('');
    setEmergencyAction(true);
    try {
      const response = await authenticatedFetch('/api/quant/paper/risk/emergency-stop/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acknowledge: true }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Emergency stop could not be reset.');
      setRiskStateMessage('Emergency stop reset. Paper trading remains disabled.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Emergency stop could not be reset.');
    } finally {
      setEmergencyAction(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setNotice('');
    setSubmitting(true);
    try {
      const response = await authenticatedFetch('/api/quant/paper/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: symbol.trim().toUpperCase(), side, quantity: Number(quantity),
          reference_price: Number(price), client_order_id: crypto.randomUUID(),
        }),
      });
      const data = await response.json() as {
        error?: string; duplicate?: boolean; fillPrice?: number; emergencyStop?: boolean;
      };
      if (!response.ok) {
        if (data.emergencyStop) {
          setNotice(data.error || 'An automatic risk breach activated the emergency stop. No order was placed.');
          await refresh();
          return;
        }
        throw new Error(data.error || 'Paper order was rejected.');
      }
      setNotice(data.duplicate ? 'This order was already recorded.' : 'Paper order filled in the simulated ledger.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Paper order failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-5 rounded-2xl border border-cyan-400/20 bg-slate-900/70 p-5 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Quant execution workspace</p>
          <h2 className="mt-1 text-xl font-semibold text-white">Paper Trading Terminal</h2>
          <p className="mt-1 text-sm text-slate-400">A persistent virtual portfolio connected to Quant Lab experiment research.</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-amber-300/30 px-3 py-1.5 text-xs text-amber-200">
          <ShieldCheck className="h-4 w-4" /> Simulation only · no broker
        </span>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Virtual equity" value={snapshot ? money(snapshot.account.equity) : '—'} />
        <Metric label="Available cash" value={snapshot ? money(snapshot.account.cash) : '—'} />
        <Metric label="Positions value" value={snapshot ? money(snapshot.account.marketValue) : '—'} />
        <Metric label="Starting balance" value={snapshot ? money(snapshot.account.startingCash) : '—'} />
      </div>
      <section aria-label="Paper trading performance summary" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="font-semibold text-white">Recorded performance</h3>
            <p className="mt-1 text-xs text-slate-500">Calculated from the latest 50 simulated fills only.</p>
          </div>
          <span className="text-xs text-slate-500">Ledger snapshot · manual reference prices</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Recorded sell P&L" value={snapshot ? money(recordedExitPnl) : '—'} />
          <Metric label="Recorded fees" value={snapshot ? money(recordedFees) : '—'} />
          <Metric label="Closed sell fills" value={snapshot ? String(closedSellTrades.length) : '—'} />
          <Metric label="Winning exits" value={exitWinRate === null ? '—' : `${exitWinRate.toFixed(1)}%`} />
        </div>
        <p className="text-xs leading-5 text-amber-200/80">
          This is not total net portfolio return: entry fees are reported separately, the ledger is limited to 50 recent fills,
          and open-position marks are based on the last manual simulated fill price rather than a live quote.
        </p>
      </section>

      <section aria-label="Recent research signals" className="space-y-3 rounded-xl border border-white/10 bg-slate-950/60 p-4">
        <div>
          <h3 className="font-semibold text-white">Recent research signals</h3>
          <p className="mt-1 text-xs text-slate-500">Saved Quant Lab results for review. A signal is research output, not an order instruction.</p>
        </div>
        {strategySignals.length === 0 ? (
          <p className="text-sm text-slate-500">No saved signals yet. Generate one in Quant Lab after importing a fresh dataset.</p>
        ) : (
          <>
            <label className="block text-xs text-slate-400">Select saved signal
              <select
                aria-label="Select saved research signal"
                value={selectedSignal?.id ?? ''}
                onChange={(event) => setSelectedSignalId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white"
              >
                {strategySignals.map((signal) => (
                  <option key={signal.id} value={signal.id}>
                    {signal.symbol} · {signal.action.toUpperCase()} · {signal.sourceBarDate}
                  </option>
                ))}
              </select>
            </label>
            {selectedSignal && (
              <div className="grid gap-3 sm:grid-cols-4">
                <Metric label="Symbol / action" value={`${selectedSignal.symbol} · ${selectedSignal.action.toUpperCase()}`} />
                <Metric label="Research close" value={money(selectedSignal.referencePrice)} />
                <Metric label="Source bar" value={selectedSignal.sourceBarDate} />
                <Metric label="Strategy" value={selectedSignal.strategy.replaceAll('_', ' ')} />
              </div>
            )}
          </>
        )}
        <p className="text-xs text-amber-200/80">No paper order is created or submitted from this signal panel. Review the research in Quant Lab and use the separate manual paper form only after checking its price and size.</p>
      </section>

      <form onSubmit={saveRiskPolicy} className="grid gap-4 rounded-xl border border-white/10 bg-slate-950/60 p-4 sm:grid-cols-2 xl:grid-cols-5">
        <div className="xl:col-span-2">
          <h3 className="font-semibold text-white">Portfolio risk controls</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">Server-enforced order, position and gross exposure limits apply before simulated orders. Platform hard caps cannot be increased here.</p>
          <label className="mt-3 flex items-center gap-2 text-sm text-slate-200">
            <input type="checkbox" checked={riskPolicy.tradingEnabled} onChange={(event) => setRiskPolicy((current) => ({ ...current, tradingEnabled: event.target.checked }))} />
            Paper trading enabled
          </label>
        </div>
        <RiskField label="Maximum order" value={riskPolicy.maxOrderNotional} max={10000} onChange={(value) => setRiskPolicy((current) => ({ ...current, maxOrderNotional: value }))} />
        <RiskField label="Maximum per position" value={riskPolicy.maxPositionNotional} max={50000} onChange={(value) => setRiskPolicy((current) => ({ ...current, maxPositionNotional: value }))} />
        <RiskField label="Maximum gross exposure" value={riskPolicy.maxGrossExposure} max={100000} onChange={(value) => setRiskPolicy((current) => ({ ...current, maxGrossExposure: value }))} />
        <div className="flex items-center gap-3 sm:col-span-2 xl:col-span-5">
          <button type="submit" disabled={riskSaving} className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-100 disabled:opacity-50">{riskSaving ? 'Saving risk policy…' : 'Save risk controls'}</button>
          {riskMessage && <p role="status" className="text-xs text-emerald-200">{riskMessage}</p>}
        </div>
      </form>
      <section aria-label="Daily loss drawdown and emergency stop" className="space-y-4 rounded-xl border border-rose-300/20 bg-slate-950/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-white">Daily loss and drawdown protection</h3>
            <p className="mt-1 text-xs leading-5 text-slate-400">Server-side paper safeguards. Equity is evaluated on confirmed fills using stored simulated fill marks, not live quotes.</p>
          </div>
          {riskState.emergencyStop ? (
            <span role="status" className="rounded-full border border-rose-300/40 bg-rose-300/10 px-3 py-1 text-xs font-semibold text-rose-200">EMERGENCY STOP ACTIVE</span>
          ) : (
            <span className="rounded-full border border-emerald-300/30 px-3 py-1 text-xs text-emerald-200">No emergency stop</span>
          )}
        </div>
        {riskState.emergencyStop && (
          <p className="rounded-lg border border-rose-300/30 bg-rose-300/5 p-3 text-sm text-rose-100">
            {riskState.emergencyStopReason || 'Manual emergency stop'} — all new paper orders are blocked.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Daily loss" value={riskState.dailyRisk ? money(riskState.dailyRisk.daily_loss) : '—'} />
          <Metric label="Daily loss limit" value={money(riskState.maxDailyLoss)} />
          <Metric label="Max observed drawdown" value={riskState.portfolioRisk ? `${Number(riskState.portfolioRisk.max_drawdown_pct).toFixed(2)}%` : '—'} />
          <Metric label="Drawdown limit" value={`${riskState.maxDrawdownPct.toFixed(2)}%`} />
        </div>
        <form onSubmit={saveDailyRiskLimits} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_auto]">
          <label className="block text-xs text-slate-400">Maximum daily loss
            <input type="number" min="100" max="50000" step="100" required value={riskState.maxDailyLoss} onChange={(event) => setRiskState((current) => ({ ...current, maxDailyLoss: Number(event.target.value) }))} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white" />
          </label>
          <label className="block text-xs text-slate-400">Maximum drawdown (%)
            <input type="number" min="1" max="50" step="0.5" required value={riskState.maxDrawdownPct} onChange={(event) => setRiskState((current) => ({ ...current, maxDrawdownPct: Number(event.target.value) }))} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white" />
          </label>
          <button type="submit" disabled={riskStateSaving || riskState.emergencyStop} className="self-end rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-100 disabled:opacity-50">{riskStateSaving ? 'Saving…' : 'Save daily risk limits'}</button>
        </form>
        <div className="flex flex-wrap items-center gap-3">
          {!riskState.emergencyStop ? (
            <button type="button" onClick={() => void triggerEmergencyStop()} disabled={emergencyAction || loading} className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{emergencyAction ? 'Activating…' : 'Activate emergency stop'}</button>
          ) : (
            <button type="button" onClick={() => void resetEmergencyStop()} disabled={emergencyAction || loading} className="rounded-lg border border-rose-300/40 px-4 py-2 text-sm font-semibold text-rose-100 disabled:opacity-50">{emergencyAction ? 'Resetting…' : 'Reset emergency stop'}</button>
          )}
          {riskStateMessage && <p role="status" className="text-xs text-emerald-200">{riskStateMessage}</p>}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <form onSubmit={submit} className="space-y-3 rounded-xl border border-white/10 bg-slate-950/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold text-white">Place simulated order</h3>
            <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-lg p-2 text-slate-400 hover:bg-white/5" aria-label="Refresh paper account"><RefreshCw className="h-4 w-4" /></button>
          </div>
          <label className="block text-xs text-slate-400">Symbol
            <input value={symbol} onChange={(event) => setSymbol(event.target.value)} maxLength={15} pattern="[A-Za-z0-9.\\-]+" required className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-slate-400">Side
              <select value={side} onChange={(event) => setSide(event.target.value as 'buy' | 'sell')} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white"><option value="buy">Buy</option><option value="sell">Sell</option></select>
            </label>
            <label className="block text-xs text-slate-400">Quantity
              <input type="number" min="0.00000001" max="1000000" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} required className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
          </div>
          <label className="block text-xs text-slate-400">Reference price (manual simulation input)
            <input type="number" min="0.00000001" max="10000000" step="any" value={price} onChange={(event) => setPrice(event.target.value)} required className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white" />
          </label>
          <p className="text-xs leading-5 text-slate-500">The reference price is supplied by you; it is not a live quote. Orders fill immediately at that simulated price. Your configured order, position and portfolio exposure limits are enforced server-side; fees are 5 bps and short selling is disabled.</p>
          {error && <p role="alert" className="rounded-lg border border-rose-400/30 p-3 text-sm text-rose-200">{error}</p>}
          {notice && <p role="status" className="rounded-lg border border-emerald-300/20 p-3 text-sm text-emerald-200">{notice}</p>}
          <button type="submit" disabled={submitting || loading || !symbol.trim() || !riskPolicy.tradingEnabled} className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-50">
            {side === 'buy' ? <ArrowDownToLine className="h-4 w-4" /> : <ArrowUpFromLine className="h-4 w-4" />}
            {submitting ? 'Recording simulated fill…' : 'Confirm paper order'}
          </button>
        </form>
        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
            <h3 className="mb-3 font-semibold text-white">Open positions</h3>
            {!snapshot?.positions.length ? <p className="text-sm text-slate-500">No open paper positions.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[460px] text-left text-xs"><thead className="text-slate-500"><tr><th className="p-2">Symbol</th><th className="p-2">Units</th><th className="p-2">Average entry</th><th className="p-2">Mark</th><th className="p-2">Unrealized P&amp;L</th></tr></thead><tbody>{snapshot.positions.map((p) => <tr key={p.symbol} className="border-t border-white/5 text-slate-300"><td className="p-2 font-semibold">{p.symbol}</td><td className="p-2">{p.quantity}</td><td className="p-2">{money(p.average_entry_price)}</td><td className="p-2">{money(p.last_price)}</td><td className="p-2">{money(p.unrealized_pnl)}</td></tr>)}</tbody></table></div>}
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-white">Execution ledger</h3>
              <span className="text-xs text-slate-500">Latest {snapshot?.trades.length ?? 0} of 50 fills</span>
            </div>
            {!snapshot?.trades.length ? <p className="text-sm text-slate-500">Paper fills will appear here.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-left text-xs"><thead className="text-slate-500"><tr><th className="p-2">Time</th><th className="p-2">Symbol</th><th className="p-2">Side</th><th className="p-2">Qty</th><th className="p-2">Fill</th><th className="p-2">Realized P&amp;L</th></tr></thead><tbody>{snapshot.trades.map((trade) => <tr key={trade.id} className="border-t border-white/5 text-slate-300"><td className="p-2">{new Date(trade.created_at).toLocaleString()}</td><td className="p-2">{trade.symbol}</td><td className="p-2 uppercase">{trade.side}</td><td className="p-2">{trade.quantity}</td><td className="p-2">{money(trade.price)}</td><td className="p-2">{trade.realized_pnl == null ? '—' : money(trade.realized_pnl)}</td></tr>)}</tbody></table></div>}
          </div>
        </div>
      </div>
      <p className="text-xs text-slate-500">Paper account data is private to your authenticated user. This feature does not connect to an exchange or brokerage and cannot submit real orders.</p>
    </section>
  );
}

function RiskField({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (value: number) => void }) {
  return <label className="block text-xs text-slate-400">{label}
    <input type="number" min="100" max={max} step="100" value={value} onChange={(event) => onChange(Number(event.target.value))} required className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white" />
  </label>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <article className="rounded-xl border border-white/10 bg-slate-950/60 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-lg font-semibold text-white">{value}</p></article>;
}
