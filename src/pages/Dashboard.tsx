import { useEffect, useState } from 'react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import {
  Activity,
  BrainCircuit,
  BookAudio,
  Calculator as CalculatorIcon,
  Code2,
  Cpu,
  MessageSquareText,
  ListChecks,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Clock3,
  Database,
  RefreshCw,
  Settings,
  Server,
  Wifi,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { usePlatformHealth } from '@/hooks/usePlatformHealth';
import { getSnapshotFreshness } from '@/lib/healthFreshness';
import type { DashboardUiId, DashboardUiPreferences } from '@/lib/settingsPreferences';

const STALE_AFTER_MS = 90_000;
const PA_HEARTBEAT_STALE_AFTER_MS = 45_000;

type PAStatus = {
  active: boolean;
  workState: 'stopped' | 'monitoring' | 'degraded';
  lastHeartbeat: string;
  lastReport: string;
  lastError: string | null;
  observationsCompleted: number;
  health: { api: boolean; database: boolean; redis: boolean };
};

export default function DashboardPage({ isOwner = false, isAdmin = false, enabledModules }: { isOwner?: boolean; isAdmin?: boolean; enabledModules?: DashboardUiPreferences }) {
  const { health, error, checking, refresh } = usePlatformHealth();
  const [now, setNow] = useState(() => Date.now());
  const [paStatus, setPaStatus] = useState<PAStatus | null>(null);
  const [paError, setPaError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const loadPAStatus = async () => {
      try {
        const response = await authenticatedFetch('/api/agent/ops/pa/status', {
          signal: controller.signal,
        });
        const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
        if (!contentType.includes('json')) {
          throw new Error(
            `PA status endpoint returned a non-JSON response (HTTP ${response.status}). Check the configured API origin.`,
          );
        }
        let payload: { pa?: PAStatus; error?: string };
        try {
          payload = await response.json() as { pa?: PAStatus; error?: string };
        } catch {
          throw new Error(`PA status endpoint returned malformed JSON (HTTP ${response.status}).`);
        }
        if (!response.ok || !payload.pa) throw new Error(payload.error || 'PA status is not available.');
        if (!disposed) {
          setPaStatus(payload.pa);
          setPaError(null);
        }
      } catch (cause) {
        if (!disposed && !(cause instanceof DOMException && cause.name === 'AbortError')) {
          setPaStatus(null);
          setPaError(cause instanceof Error ? cause.message : 'PA status could not be loaded.');
        }
      }
    };
    void loadPAStatus();
    const timer = window.setInterval(() => void loadPAStatus(), 15_000);
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  const healthFreshness = getSnapshotFreshness(health?.timestamp, now, STALE_AFTER_MS);
  const reportedAt = health?.timestamp ? Date.parse(health.timestamp) : Number.NaN;
  const hasTimestamp = healthFreshness !== 'unknown' && Number.isFinite(reportedAt);
  const ageMs = hasTimestamp ? now - reportedAt : null;
  const isStale = healthFreshness === 'stale';
  const healthFresh = Boolean(health && healthFreshness === 'fresh');
  const healthFreshnessUnknown = Boolean(health && healthFreshness === 'unknown');
  const paHeartbeatFreshness = getSnapshotFreshness(paStatus?.lastHeartbeat, now, PA_HEARTBEAT_STALE_AFTER_MS);
  const paHeartbeatAt = paStatus?.lastHeartbeat ? Date.parse(paStatus.lastHeartbeat) : Number.NaN;
  const paHeartbeatKnown = paHeartbeatFreshness !== 'unknown' && Number.isFinite(paHeartbeatAt);
  const paHeartbeatStale = paHeartbeatFreshness === 'stale';
  const paHeartbeatUnverified = paHeartbeatFreshness === 'unknown';
  const paMonitoring = Boolean(paStatus?.active && paStatus.workState === 'monitoring' && paHeartbeatFreshness === 'fresh');
  const paStateLabel = !paStatus ? 'Not reporting' : paHeartbeatStale ? 'Heartbeat stale' : paHeartbeatUnverified ? 'Heartbeat unverified' : paStatus.workState;
  const workspaces = [
    {
      id: 'pa',
      href: '#/pa',
      title: 'Personal Assistant',
      description: 'Review PA runtime health, personal task continuity and authorised agent coordination.',
      icon: BrainCircuit,
    },
    {
      id: 'cockpit',
      href: '#/cockpit',
      title: 'Command Cockpit',
      description: 'Inspect provider readiness, three-brain health and live reasoning activity.',
      icon: Cpu,
    },
    {
      id: 'operator',
      href: '#/operator',
      title: 'Operator Console',
      description: 'Queue durable reasoning tasks and inspect persisted execution progress.',
      icon: Activity,
    },
    {
      id: 'operations',
      href: '#/operations',
      title: 'Operations Center',
      description: 'Queue durable agent tasks and inspect execution progress; administrators can review pending actions.',
      icon: ListChecks,
    },
    {
      id: 'settings',
      href: '#/settings',
      title: 'Settings',
      description: 'Choose enabled workspaces and manage your profile, sign-in details and preferences.',
      icon: Settings,
    },
    {
      id: 'calculator',
      href: '#/calculator',
      title: 'Calculator',
      description: 'Open the calculation and analysis workspace.',
      icon: CalculatorIcon,
    },
    {
      id: 'quant',
      href: '#/quant',
      title: 'Quant Lab',
      description: 'Run historical strategy experiments and review risk analytics.',
      icon: TrendingUp,
    },
    {
      id: 'trading',
      href: '#/trading',
      title: 'Trading Terminal',
      description: 'Review isolated virtual paper-trading workflows.',
      icon: Wallet,
    },
    {
      id: 'workspace',
      href: '#/workspace',
      title: 'Reasoning Workspace',
      description: 'Continue conversations, use voice and manage your project memory.',
      icon: MessageSquareText,
    },
    {
      id: 'audiobook',
      href: '#/audiobook',
      title: 'Audiobook Studio',
      description: 'Prepare chapters, transcribe audio and generate narration.',
      icon: BookAudio,
    },
    ...(isAdmin ? [
      {
        id: 'studio',
        href: '#/studio',
        title: 'RyanAI Studio',
        description: 'Open the protected engineering and coding workspace.',
        icon: Code2,
      },
      {
        id: 'admin',
        href: '#/admin',
        title: 'Admin Console',
        description: 'Review protected approvals, runtime diagnostics and engineering evidence.',
        icon: Database,
      },
    ] : []),
    ...(isOwner ? [{
      id: 'comms',
      href: '#/comms',
      title: 'RyanAI Comms',
      description: 'Manage owner-authorised WhatsApp, SMS, voice and email conversations.',
      icon: Activity,
    }] : []),
  ];
  const visibleWorkspaces = workspaces.filter(({ id }) => (
    id === 'settings' || !enabledUiIds || enabledUiIds.includes(id)
  ));

  const visibleWorkspaces = workspaces.filter((workspace) => {
    const routeId = workspace.href.replace(/^#\//, '') as DashboardUiId;
    return routeId === 'settings' || enabledModules?.[routeId] !== false;
  });

  return (
    <section className="mx-auto max-w-7xl px-5 py-8 sm:px-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">RyanAI Platform</p>
          <h1 className="mt-2 text-3xl font-bold text-white">System dashboard</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Live service health and operator shortcuts. Unknown or stale signals are never presented as healthy.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${isStale ? 'border-amber-300/30 bg-amber-300/5 text-amber-200' : healthFresh ? 'border-emerald-300/20 text-emerald-200' : 'border-slate-500/30 text-slate-300'}`}>
              <Clock3 className="h-3.5 w-3.5" />
              {checking && !health ? 'Checking health…' : hasTimestamp ? `Health signal ${isStale ? 'stale' : 'updated'} ${formatAge(ageMs!)} ago` : health ? 'Health timestamp missing, invalid or future · unverified' : 'Health timestamp not reported'}
            </span>
            {hasTimestamp && (
              <span className="text-slate-500">Reported at {new Date(reportedAt).toLocaleString()}</span>
            )}
          </div>
        </div>
        <button onClick={() => void refresh()} disabled={checking} className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && <div role="alert" className="mt-6 flex items-start gap-3 rounded-xl border border-rose-400/20 bg-rose-400/5 p-4 text-sm text-rose-200"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
      {isStale && <div role="status" className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm text-amber-100">The API timestamp is more than 90 seconds old. Treat this snapshot as stale until a fresh health response is received.</div>}
      {healthFreshnessUnknown && <div role="status" className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">The API returned a missing, invalid or future timestamp. Service signals are unverified until a valid current timestamp is received.</div>}

      <article className="mt-6 rounded-2xl border border-cyan-300/20 bg-slate-900/70 p-5" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Personal Assistant</p>
            <h2 className="mt-1 text-lg font-semibold text-white">PA Agent observer</h2>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs ${paMonitoring ? 'border-emerald-300/30 text-emerald-200' : paStatus?.workState === 'degraded' || paHeartbeatStale ? 'border-amber-300/30 text-amber-200' : 'border-slate-500/30 text-slate-300'}`}>
            {paStateLabel}
          </span>
        </div>
        <p className="mt-3 text-sm text-slate-300">{paStatus?.lastReport ?? paError ?? 'Waiting for an authenticated PA observer report.'}</p>
        <div className="mt-4 grid gap-3 text-xs sm:grid-cols-4">
          <InfoRow label="API probe" value={paStatus ? (paStatus.health.api ? 'Healthy' : 'Unhealthy') : 'Unknown'} />
          <InfoRow label="PostgreSQL probe" value={paStatus ? (paStatus.health.database ? 'Healthy' : 'Unhealthy') : 'Unknown'} />
          <InfoRow label="Redis probe" value={paStatus ? (paStatus.health.redis ? 'Healthy' : 'Unhealthy') : 'Unknown'} />
          <InfoRow label="Observations" value={paStatus ? String(paStatus.observationsCompleted) : '—'} />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Last heartbeat: {paHeartbeatKnown ? new Date(paHeartbeatAt).toLocaleString() : paStatus?.lastHeartbeat ? 'Invalid or future timestamp' : 'Not received'} · {paHeartbeatStale || paHeartbeatUnverified ? 'Heartbeat is stale or unverified; observer status is not live.' : 'Heartbeat is current.'} Read-only monitoring; no messages, calls, file edits or privileged actions.
        </p>
      </article>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatusCard title="API gateway" value={healthServiceLabel(health?.status === 'online', checking, isStale, healthFresh)} icon={Server} healthy={healthFresh ? health?.status === 'online' : undefined} />
        <StatusCard title="PostgreSQL" value={serviceLabel(health?.services?.database, checking, isStale, healthFresh)} icon={Database} healthy={healthFresh ? health?.services?.database : undefined} />
        <StatusCard title="Redis" value={serviceLabel(health?.services?.redis, checking, isStale, healthFresh)} icon={Wifi} healthy={healthFresh ? health?.services?.redis : undefined} />
        <StatusCard title="Agent checkpointer" value={serviceLabel(health?.services?.agentCheckpointer, checking, isStale, healthFresh)} icon={Activity} healthy={healthFresh ? health?.services?.agentCheckpointer : undefined} />
      </div>

      <section className="mt-8" aria-labelledby="platform-workspaces-title">
        <div className="mb-4">
          <h2 id="platform-workspaces-title" className="text-xl font-semibold text-white">Platform workspaces</h2>
          <p className="mt-1 text-sm text-slate-400">
            Open each authenticated RyanAI workspace from one place. Live capabilities depend on verified backend services and configured providers.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibleWorkspaces.map(({ id, href, title, description, icon: Icon }) => (
            <a
              key={id}
              href={href}
              className="group rounded-xl border border-white/10 bg-slate-900/70 p-4 transition hover:border-cyan-300/30 hover:bg-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Icon className="h-4 w-4 text-cyan-300" />
                  {title}
                </span>
                <span aria-hidden="true" className="text-cyan-300 transition group-hover:translate-x-1">↗</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-400">{description}</p>
            </a>
          ))}
        </div>
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-6">
          <h2 className="font-semibold text-white">Reasoning engine</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <InfoRow label="Engine" value={health?.engine || 'Not reported'} />
            <InfoRow label="Graph" value={health?.activeGraph || 'Not reported'} />
            <InfoRow label="Last health check" value={hasTimestamp ? new Date(reportedAt).toLocaleString() : 'Not available'} />
          </dl>
          <a href="#/cockpit" className="mt-5 inline-flex rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300">Open cockpit</a>
        </article>
        <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-6">
          <h2 className="font-semibold text-white">Operator quick actions</h2>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            Start a reasoning request in the cockpit, or open the workspace for conversation history and files. Provider and tool availability must be confirmed by their own live checks.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <a href="#/cockpit" className="inline-flex rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/5">Run a task</a>
            <a href="#/workspace" className="inline-flex rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/5">Open workspace</a>
          </div>
        </article>
      </div>
    </section>
  );
}

function formatAge(milliseconds: number) {
  if (milliseconds < 5_000) return 'just now';
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
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

function healthServiceLabel(online: boolean, checking: boolean, stale: boolean, fresh: boolean) {
  if (stale) return 'Stale signal';
  if (!fresh) return checking ? 'Checking' : 'Freshness unknown';
  return online ? 'Online' : 'Unavailable';
}

function serviceLabel(healthy: boolean | undefined, checking: boolean, stale: boolean, fresh: boolean) {
  if (stale) return 'Stale signal';
  if (!fresh) return checking ? 'Checking' : 'Freshness unknown';
  if (healthy === true) return 'Healthy';
  if (healthy === false) return 'Unavailable';
  return 'Not reported';
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4 border-b border-white/5 pb-2"><dt className="text-slate-400">{label}</dt><dd className="text-right text-slate-200">{value}</dd></div>;
}
