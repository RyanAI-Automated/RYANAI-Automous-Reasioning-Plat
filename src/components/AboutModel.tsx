import Modal from './Modal';
import { BookOpen, Database, GitBranch, Network, RefreshCw, ShieldCheck, Workflow } from 'lucide-react';
import packageMetadata from '../../package.json';
import { usePlatformHealth } from '@/hooks/usePlatformHealth';
import { getSnapshotFreshness } from '@/lib/healthFreshness';

interface AboutModalProps {
  open: boolean;
  onClose: () => void;
}

const architecture = [
  { icon: Database, title: 'Persistent memory', detail: 'Account-scoped PostgreSQL memory with pgvector-backed retrieval services.' },
  { icon: Network, title: 'Reasoning', detail: 'Authenticated API orchestration across configured reasoning providers and local fallback paths.' },
  { icon: Workflow, title: 'Workspace', detail: 'Conversations, operator tools, Comms, Quant Lab and specialist workspaces.' },
  { icon: GitBranch, title: 'Engineering', detail: 'GitHub-managed source, pull requests, CI evidence and human-reviewed changes.' },
];

const serviceLabels: Record<string, string> = {
  api: 'API process',
  database: 'PostgreSQL',
  redis: 'Redis',
  agentCheckpointer: 'Agent checkpointer',
};

function readinessLabel(
  checking: boolean,
  error: string | null,
  health: ReturnType<typeof usePlatformHealth>['health'],
  service?: string,
): string {
  if (checking && !health) return 'Checking';
  if (error || !health) return 'Unreachable';
  const freshness = getSnapshotFreshness(health.timestamp);
  if (freshness !== 'fresh') return freshness === 'stale' ? 'Stale' : 'Unknown';
  if (service) {
    if (typeof health.services?.[service] !== 'boolean') return 'Not reported';
    return health.services[service] ? 'Ready' : 'Unavailable';
  }
  return health.status === 'online' ? 'Ready' : 'Degraded';
}

export default function AboutModal({ open, onClose }: AboutModalProps) {
  const buildId = import.meta.env.VITE_BUILD_ID;
  const { health, error, checking, refresh } = usePlatformHealth(30_000);

  const overallStatus = readinessLabel(checking, error, health);
  const serviceStatus = (key: string) => readinessLabel(checking, error, health, key);

  return (
    <Modal open={open} onClose={onClose} title="About RyanAI" icon={<BookOpen size={20} />}>
      <div className="space-y-4 text-sm text-ink-300">
        <div>
          <p className="font-semibold text-white">RyanAI Autonomous Reasoning Platform</p>
          <p className="mt-1 text-xs leading-5 text-ink-400">
            An authenticated, modular AI workspace for conversations, persistent memory, model inference,
            agent operations and connected productivity tools.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {architecture.map(({ icon: Icon, title, detail }) => (
            <div key={title} className="rounded-lg border border-white/10 bg-ink-900/50 p-3">
              <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-cyan-200"><Icon size={14} />{title}</div>
              <p className="text-[11px] leading-5 text-ink-400">{detail}</p>
            </div>
          ))}
        </div>
        <section aria-label="Live platform readiness" className="rounded-lg border border-white/10 bg-ink-800/30 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-white">Live platform readiness</p>
              <p className="mt-1 text-[11px] text-ink-400" role="status" aria-live="polite">
                Overall: {overallStatus}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={checking}
              className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-ink-300 hover:bg-white/5 disabled:opacity-50"
              aria-label="Refresh platform readiness"
            >
              <RefreshCw size={12} className={checking ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2">
            {Object.entries(serviceLabels).map(([key, label]) => (
              <div key={key} className="rounded-md bg-black/20 px-2 py-2">
                <dt className="text-[10px] text-ink-500">{label}</dt>
                <dd className="mt-1 text-xs font-medium text-ink-200">{serviceStatus(key)}</dd>
              </div>
            ))}
            <div className="rounded-md bg-black/20 px-2 py-2">
              <dt className="text-[10px] text-ink-500">Model providers</dt>
              <dd className="mt-1 text-xs font-medium text-ink-200">Not probed</dd>
            </div>
            <div className="rounded-md bg-black/20 px-2 py-2">
              <dt className="text-[10px] text-ink-500">GitHub authorization</dt>
              <dd className="mt-1 text-xs font-medium text-ink-200">Not probed</dd>
            </div>
          </dl>
          {health?.timestamp && (
            <p className="mt-2 text-[10px] text-ink-500">
              Probe timestamp: {new Date(health.timestamp).toLocaleString()}
            </p>
          )}
          {error && (
            <p className="mt-2 text-[11px] text-amber-300">
              Live readiness could not be retrieved. Check API reachability; provider and infrastructure health remain unverified.
            </p>
          )}
        </section>
        <div className="rounded-lg border border-white/10 bg-ink-800/30 p-3 text-xs font-mono">
          <div>Version: {packageMetadata.version}</div>
          <div>Build: {buildId || 'Not supplied by the build pipeline'}</div>
        </div>
        <p className="flex items-start gap-2 text-[11px] leading-5 text-ink-500">
          <ShieldCheck size={14} className="mt-0.5 shrink-0" />
          Readiness is a point-in-time probe of the API, PostgreSQL, Redis and agent checkpointer. It does not test model-provider inference, GitHub authorization, frontend delivery or deployment health. A capability listing is not proof of an external integration.
        </p>
        <p className="text-[11px] text-ink-600">© 2026 RyanAI. All rights reserved.</p>
      </div>
    </Modal>
  );
}
