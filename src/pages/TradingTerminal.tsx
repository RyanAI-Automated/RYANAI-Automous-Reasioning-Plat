import PaperTradingPanel from '@/components/quant/PaperTradingPanel';
import PaperStrategyAllocations from '@/components/quant/PaperStrategyAllocations';
import { Activity, ShieldCheck, Workflow } from 'lucide-react';

export default function TradingTerminalPage() {
  return (
    <section className="mx-auto max-w-7xl space-y-6 px-5 py-8 sm:px-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">RyanAI · Execution workspace</p>
          <h1 className="mt-2 text-3xl font-bold text-white">Trading Terminal</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">Manage the virtual portfolio, configure server-enforced risk limits and review strategies promoted from Quant Lab.</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-300/5 px-3 py-1.5 text-xs font-medium text-amber-200"><Activity className="h-3.5 w-3.5" /> Paper simulation only · no broker</span>
      </header>
      <div className="grid gap-4 sm:grid-cols-3">
        <Module icon={Workflow} title="Research linked" detail="Completed Quant Lab experiments can be promoted into this paper portfolio." />
        <Module icon={ShieldCheck} title="Risk governed" detail="Per-order, per-position and gross exposure limits are enforced by the API." />
        <Module icon={Activity} title="Execution ledger" detail="Simulated fills, positions, cash and P&L are recorded per authenticated user." />
      </div>
      <PaperStrategyAllocations />
      <PaperTradingPanel />
    </section>
  );
}

function Module({ icon: Icon, title, detail }: { icon: typeof Activity; title: string; detail: string }) {
  return <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><Icon className="h-5 w-5 text-cyan-300" /><h2 className="mt-3 text-sm font-semibold text-white">{title}</h2><p className="mt-1 text-xs leading-5 text-slate-400">{detail}</p></article>;
}
