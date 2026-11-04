import { Activity, BarChart3, BrainCircuit, ShieldCheck, TrendingUp } from 'lucide-react';

const modules = [
  {
    title: 'Strategy studio',
    description: 'Define an agent, investment thesis, market universe and evaluation window.',
    status: 'Foundation planned',
    icon: BrainCircuit,
  },
  {
    title: 'Historical backtesting',
    description: 'Replay strategies against historical data with fees, slippage and benchmark comparisons.',
    status: 'Not connected',
    icon: BarChart3,
  },
  {
    title: 'Paper trading',
    description: 'Observe simulated orders and virtual portfolio changes without placing real orders.',
    status: 'Disabled',
    icon: TrendingUp,
  },
  {
    title: 'Risk and decision audit',
    description: 'Inspect drawdown, exposure, volatility, risk limits and every agent decision.',
    status: 'Foundation planned',
    icon: ShieldCheck,
  },
];

export default function QuantLabPage() {
  return (
    <section className="mx-auto max-w-7xl px-5 py-8 sm:px-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">RyanAI · Research workspace</p>
          <h1 className="mt-2 text-3xl font-bold text-white">Quant Intelligence &amp; Trading Lab</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
            Build and evaluate AI-assisted strategies using reproducible experiments, historical simulations
            and risk-first paper trading. This workspace is research-only while its data and execution
            adapters are being implemented.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-300/5 px-3 py-1.5 text-xs font-medium text-amber-200">
          <Activity className="h-3.5 w-3.5" /> Research mode · no broker connected
        </span>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {modules.map(({ title, description, status, icon: Icon }) => (
          <article key={title} className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
            <div className="flex items-center justify-between">
              <Icon className="h-5 w-5 text-cyan-300" />
              <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase tracking-wider text-slate-400">{status}</span>
            </div>
            <h2 className="mt-5 text-base font-semibold text-white">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
          </article>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-cyan-400/20 bg-slate-900/70 p-6">
          <h2 className="text-lg font-semibold text-white">Experiment overview</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            No experiment data is connected yet. RyanAI will only display returns, benchmark results,
            portfolio values or agent activity after they are returned by a verified run and stored with
            its configuration and data provenance.
          </p>
          <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <Metric label="Experiments" value="Not available" />
            <Metric label="Active simulations" value="Not available" />
            <Metric label="Portfolio value" value="Not available" />
            <Metric label="Benchmark return" value="Not available" />
          </div>
        </article>
        <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-6">
          <h2 className="text-lg font-semibold text-white">Execution safeguards</h2>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
            <li>• Historical backtests and simulated fills only in the initial release.</li>
            <li>• No broker credentials or live-order endpoints are exposed to the browser.</li>
            <li>• Risk limits, audit trails and explicit approvals are required before any future execution capability.</li>
            <li>• Missing provider or market-data credentials must produce an unavailable state, never a simulated success.</li>
          </ul>
          <p className="mt-5 rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 text-xs leading-5 text-amber-100">
            Backtesting and paper-trading controls remain unavailable until their backend adapters,
            persistence, tests and risk checks are implemented and independently verified.
          </p>
        </article>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-950/60 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-semibold text-slate-300">{value}</p>
    </div>
  );
}
