import Modal from './Modal';
import { BookOpen, Database, GitBranch, Network, ShieldCheck, Workflow } from 'lucide-react';
import packageMetadata from '../../package.json';

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

export default function AboutModal({ open, onClose }: AboutModalProps) {
  const buildId = import.meta.env.VITE_BUILD_ID;

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
        <div className="rounded-lg border border-white/10 bg-ink-800/30 p-3 text-xs font-mono">
          <div>Version: {packageMetadata.version}</div>
          <div>Build: {buildId || 'Not supplied by the build pipeline'}</div>
          <div>Status: Runtime health not verified</div>
        </div>
        <p className="flex items-start gap-2 text-[11px] leading-5 text-ink-500">
          <ShieldCheck size={14} className="mt-0.5 shrink-0" />
          This page reports product architecture and release metadata only. It does not probe the API,
          database, Redis, model providers, GitHub authorization or deployment health. A listed capability
          is not proof that its external provider is connected or operational.
        </p>
        <p className="text-[11px] text-ink-600">© 2026 RyanAI. All rights reserved.</p>
      </div>
    </Modal>
  );
}
