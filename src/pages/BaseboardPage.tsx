import { Activity, BrainCircuit, Boxes, MessageSquare, Network, Server, ShieldCheck, Workflow, Wrench } from 'lucide-react';

const areas = [
  { title: 'System dashboard', detail: 'Infrastructure health, service signals and runtime freshness.', href: '#/dashboard', icon: Server },
  { title: 'Command cockpit', detail: 'Authenticated reasoning, orchestration activity and brain handoffs.', href: '#/cockpit', icon: Workflow },
  { title: 'LLM operations', detail: 'Provider readiness, model identity, latency and reported errors.', href: '#/llm', icon: BrainCircuit },
  { title: 'MCP Tools', detail: 'Tool catalogue, risk classifications and operator-managed allowlist policy.', href: '#/tools', icon: Wrench },
  { title: 'Workspace', detail: 'Conversations, models, voice and private attachments.', href: '#/workspace', icon: MessageSquare },
  { title: 'Communications', detail: 'Owner communications across WhatsApp, SMS, voice and email.', href: '#/comms', icon: Activity },
  { title: 'Administration', detail: 'Owner controls, knowledge operations and CI-gated patch proposals.', href: '#/admin', icon: ShieldCheck },
];

export default function BaseboardPage() {
  return (
    <section className="mx-auto max-w-7xl space-y-7 px-4 py-8 sm:px-8">
      <header className="rounded-3xl border border-cyan-400/20 bg-gradient-to-br from-slate-900 via-slate-950 to-cyan-950/30 p-6 sm:p-9">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300"><Boxes className="h-4 w-4" /> RyanAI Baseboard</div>
        <h1 className="mt-3 text-3xl font-bold text-white sm:text-4xl">One platform. Every control surface.</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">The central launchpad for RyanAI operations. Open each workspace independently; live status remains owned by the relevant service rather than inferred by this page.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <a href="#/cockpit" className="rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950">Open command cockpit</a>
          <a href="#/dashboard" className="rounded-lg border border-white/15 px-4 py-2.5 text-sm font-semibold text-white">View system health</a>
        </div>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {areas.map(({ title, detail, href, icon: Icon }) => (
          <a key={title} href={href} className="group rounded-2xl border border-white/10 bg-slate-900/70 p-5 transition hover:border-cyan-300/40 hover:bg-slate-900">
            <div className="flex items-center justify-between"><span className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 p-3 text-cyan-200"><Icon className="h-5 w-5" /></span><span className="text-slate-500 transition group-hover:translate-x-1 group-hover:text-cyan-200">→</span></div>
            <h2 className="mt-5 text-lg font-semibold text-white">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">{detail}</p>
          </a>
        ))}
      </div>
      <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-white"><Network className="h-4 w-4 text-cyan-300" /> Operating principle</div>
        <p className="mt-2 text-sm leading-6 text-slate-400">A green API health response does not prove provider connectivity, worker execution, or message delivery. Each interface reports only evidence returned by its own authenticated service checks.</p>
      </div>
    </section>
  );
}
