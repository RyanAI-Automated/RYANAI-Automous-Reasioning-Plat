import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { ArrowDownToLine, ArrowUpFromLine, RefreshCw, ShieldCheck } from 'lucide-react';

type Position = { symbol: string; quantity: string; average_entry_price: string; last_price: string; market_value: string; unrealized_pnl: string };
type Trade = { id: string; symbol: string; side: string; quantity: string; price: string; fee: string; realized_pnl: string | null; created_at: string };
type Snapshot = {
  mode: 'paper_simulation_only'; brokerConnected: false;
  risk: { maxOrderNotional: number; feeBps: number; shortSelling: boolean };
  account: { startingCash: number; cash: number; marketValue: number; equity: number };
  positions: Position[]; trades: Trade[];
};

const money = (value: number | string) => Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PaperTradingPanel() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
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
      const response = await authenticatedFetch('/api/quant/paper');
      const data = await response.json() as Snapshot & { error?: string };
      if (!response.ok) throw new Error(data.error || 'Paper trading account is unavailable.');
      setSnapshot(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load paper trading.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

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
      const data = await response.json() as { error?: string; duplicate?: boolean; fillPrice?: number };
      if (!response.ok) throw new Error(data.error || 'Paper order was rejected.');
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
          <p className="text-xs leading-5 text-slate-500">The reference price is supplied by you; it is not a live quote. Orders fill immediately at that simulated price. Maximum notional is 10,000 per order, fees are 5 bps, and short selling is disabled.</p>
          {error && <p role="alert" className="rounded-lg border border-rose-400/30 p-3 text-sm text-rose-200">{error}</p>}
          {notice && <p role="status" className="rounded-lg border border-emerald-300/20 p-3 text-sm text-emerald-200">{notice}</p>}
          <button type="submit" disabled={submitting || loading || !symbol.trim()} className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-50">
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
            <h3 className="mb-3 font-semibold text-white">Execution ledger</h3>
            {!snapshot?.trades.length ? <p className="text-sm text-slate-500">Paper fills will appear here.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-left text-xs"><thead className="text-slate-500"><tr><th className="p-2">Time</th><th className="p-2">Symbol</th><th className="p-2">Side</th><th className="p-2">Qty</th><th className="p-2">Fill</th><th className="p-2">Realized P&amp;L</th></tr></thead><tbody>{snapshot.trades.map((trade) => <tr key={trade.id} className="border-t border-white/5 text-slate-300"><td className="p-2">{new Date(trade.created_at).toLocaleString()}</td><td className="p-2">{trade.symbol}</td><td className="p-2 uppercase">{trade.side}</td><td className="p-2">{trade.quantity}</td><td className="p-2">{money(trade.price)}</td><td className="p-2">{trade.realized_pnl == null ? '—' : money(trade.realized_pnl)}</td></tr>)}</tbody></table></div>}
          </div>
        </div>
      </div>
      <p className="text-xs text-slate-500">Paper account data is private to your authenticated user. This feature does not connect to an exchange or brokerage and cannot submit real orders.</p>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <article className="rounded-xl border border-white/10 bg-slate-950/60 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-lg font-semibold text-white">{value}</p></article>;
}
