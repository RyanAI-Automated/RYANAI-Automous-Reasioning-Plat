import { Activity, AlertCircle, CheckCircle2, Database, RefreshCw, Server, Wifi, type LucideIcon } from 'lucide-react';
import { usePlatformHealth } from '@/hooks/usePlatformHealth';

export default function DashboardPage() {
  const { health, error, checking, refresh } = usePlatformHealth();

  return (
    <section className="mx-auto max-w-7xl px-5 py-8 sm:px-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">RyanAI Platform</p>
          <h1 className="mt-2 text-3xl font-bold text-white">System dashboard</h1>
          <p className="mt-2 text-sm text-slate-400">Service state is read from the live API health endpoint.</p>
        </div>
        <button onClick={() => void refresh()} disabled={checking} className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && <div role="alert" className="mt-6 flex items-start gap-3 rounded-xl border border-rose-400/20 bg-rose-400/5 p-4 text-sm text-rose-200"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatusCard title="API gateway" value={health?.status === 'online' ? 'Online' : checking ? 'Checking' : 'Unavailable'} icon={Server} healthy={health?.status === 'online'} />
        <StatusCard title="PostgreSQL" value={serviceLabel(health?.services?.database, checking)} icon={Database} healthy={health?.services?.database} />
        <StatusCard title="Redis" value={serviceLabel(health?.services?.redis, checking)} icon={Wifi} healthy={health?.services?.redis} />
        <StatusCard title="Agent checkpointer" value={serviceLabel(health?.services?.agentCheckpointer, checking)} icon={Activity} healthy={health?.services?.agentCheckpointer} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-6">
          <h2 className="font-semibold text-white">Reasoning engine</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <InfoRow label="Engine" value={health?.engine || 'Not reported'} />
            <InfoRow label="Graph" value={health?.activeGraph || 'Not reported'} />
            <InfoRow label="Last health check" value={health?.timestamp ? new Date(health.timestamp).toLocaleString() : 'Not available'} />
          </dl>
          <a href="#/workspace" className="mt-5 inline-flex rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300">Open workspace</a>
        </article>
        <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-6">
          <h2 className="font-semibold text-white">Operational guidance</h2>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            A green API indicator means the gateway responds. Database, Redis, and checkpoint status are reported independently by the API. A missing field is shown as unknown rather than assumed healthy.
          </p>
          <a href="#/cockpit" className="mt-5 inline-flex rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/5">Open cockpit</a>
        </article>
      </div>
    </section>
  );
}

function StatusCard({ title, value, icon: Icon, healthy }: { title: string; value: string; icon: LucideIcon; healthy?: boolean }) {
  const statusClass = healthy === true ? 'text-emerald-300' : healthy === false ? 'text-rose-300' : 'text-slate-400';
  return (
    <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-400">{title}</span>
        <Icon className="h-4 w-4 text-cyan-300" />
      </div>
      <div className={`mt-4 flex items-center gap-2 text-xl font-semibold ${statusClass}`}>
        {healthy === true ? <CheckCircle2 className="h-5 w-5" /> : healthy === false ? <AlertCircle className="h-5 w-5" /> : null}
        {value}
      </div>
    </article>
  );
}

function serviceLabel(healthy: boolean | undefined, checking: boolean) {
  if (healthy === true) return 'Healthy';
  if (healthy === false) return 'Unavailable';
  return checking ? 'Checking' : 'Not reported';
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4 border-b border-white/5 pb-2"><dt className="text-slate-400">{label}</dt><dd className="text-right text-slate-200">{value}</dd></div>;
}
