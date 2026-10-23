import Modal from './Modal';
import { Github } from 'lucide-react';

interface GithubModalProps {
  open: boolean;
  onClose: () => void;
  connected: boolean;
}

export default function GithubModal({ open, onClose, connected }: GithubModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="GitHub Integration" icon={<Github size={20} />}>
      <div className="space-y-3 text-sm text-ink-300">
        <div>
          <strong>Status:</strong>{' '}
          <span className={connected ? 'text-green-400' : 'text-amber-400'}>
            {connected ? '✓ Connected' : '✗ Not Connected'}
          </span>
        </div>
        <p>Connect your GitHub account to sync conversations and share reasoning traces.</p>
        <button className="w-full px-3 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 rounded text-cyan-300 text-sm">
          {connected ? 'Manage Connection' : 'Connect GitHub'}
        </button>
      </div>
    </Modal>
  );
}
