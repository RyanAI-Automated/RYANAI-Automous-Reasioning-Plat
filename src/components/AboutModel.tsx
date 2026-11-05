import Modal from './Modal';
import { BookOpen } from 'lucide-react';
import packageMetadata from '../../package.json';

interface AboutModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AboutModal({ open, onClose }: AboutModalProps) {
  const buildId = import.meta.env.VITE_BUILD_ID;

  return (
    <Modal open={open} onClose={onClose} title="About RyanAI" icon={<BookOpen size={20} />}>
      <div className="space-y-3 text-sm text-ink-300">
        <p>
          <strong>RyanAI Autonomous Reasoning Platform</strong>
        </p>
        <p>
          A reasoning workspace that connects authenticated conversations to the
          configured RyanAI reasoning services.
        </p>
        <div className="bg-ink-800/30 rounded p-2 text-xs font-mono">
          <div>Version: {packageMetadata.version}</div>
          <div>Build: {buildId || 'Not supplied by the build pipeline'}</div>
          <div>Status: Runtime health not verified</div>
        </div>
        <p className="text-xs text-ink-500">
          This panel reports release metadata only. It does not probe the API,
          database, Redis, model providers, or deployment health. Treat the
          platform as operational only after those checks pass independently.
        </p>
        <p className="text-xs text-ink-500">© 2026 RyanAI. All rights reserved.</p>
      </div>
    </Modal>
  );
}
