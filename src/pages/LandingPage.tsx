import { ArrowRight, Activity, Cpu, LayoutDashboard, MessageSquareText, ShieldCheck, type LucideIcon } from 'lucide-react';
import { usePlatformHealth } from '@/hooks/usePlatformHealth';

export default function LandingPage() {
  const { health, error, checking } = usePlatformHealth();
  const apiOnline = health?.status === 'online';

  return (
    <div className="relative min-h-full overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(8,145,178,0.18),transparent_55%)]" />
      <section className="relative mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-7xl flex-col justify-center px-5 py-14 sm:px-10 lg:px-16">
        <div className="max-w-3xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/5 px-3 py-1.5 text-xs text-cyan-100">
            <span className={`h-2 w-2 rounded-full ${apiOnline ? 'bg-emerald-400' : checking ? 'animate-pulse bg-amber-300' : 'bg-rose-400'}`} />
            {apiOnline ? 'RyanAI API connected' : checking ? 'Checking API connection' : 'API unavailable'}
          </div>
          <h1 className="font-display text-4xl font-black leading-tight tracking-tight text-white sm:text-6xl">
            Reason with your
            <span className="block bg-gradient-to-r from-cyan-300 to-blue-400 bg-clip-text text-transparent">AI engineering platform.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
            RyanAI brings model-powered reasoning, a live service dashboard, and an operator cockpit into one workspace.
            Responses run through your configured API; provider credentials stay on the server.
          </p>
          {!apiOnline && error && (
            <p role="status" className="mt-4 max-w-2xl text-sm text-amber-200">
              {error} Start the API service and set `VITE_API_BASE_URL` for a separately hosted frontend.
            </p>
          )}
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#/workspace" className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300">
              Open reasoning workspace <ArrowRight className="h-4 w-4" />
            </a>
            <a href="#/dashboard" className="rounded-lg border border-white/15 px-5 py-3 font-semibold text-white transition hover:bg-white/5">
              View live dashboard
            </a>
          </div>
        </div>

        <div className="mt-14 grid gap-4 md:grid-cols-3">
          <Feature href="#/workspace" icon={MessageSquareText} title="Reasoning workspace" text="Send prompts to the configured RyanAI model and keep conversations locally or in Supabase." />
          <Feature href="#/dashboard" icon={LayoutDashboard} title="Live dashboard" text="See real API, database, and cache health reported by the backend." />
          <Feature href="#/cockpit" icon={Activity} title="Operator cockpit" text="Check platform availability and run a real reasoning request." />
        </div>

        <div className="mt-10 flex flex-wrap gap-x-6 gap-y-2 border-t border-white/10 pt-5 text-xs text-slate-400">
          <span className="inline-flex items-center gap-2"><Cpu className="h-4 w-4 text-cyan-300" />LangGraph reasoning</span>
          <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-cyan-300" />Server-side provider keys</span>
          <span className="inline-flex items-center gap-2"><Activity className="h-4 w-4 text-cyan-300" />Live health status</span>
        </div>
      </section>
    </div>
  );
}

function Feature({ href, icon: Icon, title, text }: { href: string; icon: LucideIcon; title: string; text: string }) {
  return (
    <a href={href} className="group rounded-2xl border border-white/10 bg-slate-900/70 p-5 transition hover:border-cyan-300/30 hover:bg-slate-900">
      <Icon className="h-5 w-5 text-cyan-300" />
      <h2 className="mt-4 font-semibold text-white">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-400">{text}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-cyan-200">Open <ArrowRight className="h-3 w-3 transition group-hover:translate-x-1" /></span>
    </a>
  );
}
