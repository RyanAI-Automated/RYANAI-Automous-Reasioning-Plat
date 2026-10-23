import Modal from './Modal';
import { BookOpen } from 'lucide-react';

interface AboutModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AboutModal({ open, onClose }: AboutModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="About RyanAI" icon={<BookOpen size={20} />}>
      <div className="space-y-3 text-sm text-ink-300">
        <p>
          <strong>RyanAI Autonomous Reasoning Platform</strong>
        </p>
        <p>
          A powerful reasoning engine combining state-of-the-art language models with
          advanced autonomous reasoning capabilities.
        </p>
        <div className="bg-ink-800/30 rounded p-2 text-xs font-mono">
          <div>Version: 1.0.0</div>
          <div>Build: {new Date().toISOString().split('T')[0]}</div>
          <div>Status: Operational</div>
        </div>
        <p className="text-xs text-ink-500">© 2026 RyanAI. All rights reserved.</p>
      </div>
    </Modal>
  );
}
