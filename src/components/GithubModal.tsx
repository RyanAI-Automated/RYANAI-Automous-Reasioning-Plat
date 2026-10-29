import Modal from './Modal';
import { GithubLogo as Github } from '@phosphor-icons/react';

interface GithubModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Be explicit that account linking is unavailable until a server-side GitHub
 * OAuth flow is configured. Browser-local state is not proof of authorization.
 */
export default function GithubModal({ open, onClose }: GithubModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="GitHub Integration" icon={<Github size={20} />}>
      <div className="space-y-3 text-sm text-ink-300">
        <div>
          <strong>Status:</strong>{' '}
          <span className="text-amber-400">Not configured</span>
        </div>
        <p>
          GitHub account linking and conversation sync are not configured in this deployment.
          No GitHub account is connected. A server-side GitHub App or OAuth callback and
          securely stored credentials are required before this can be enabled.
        </p>
        <button
          type="button"
          disabled
          title="Configure the server-side GitHub OAuth flow to enable account linking."
          className="w-full px-3 py-2 bg-cyan-500/10 rounded text-ink-500 text-sm cursor-not-allowed"
        >
          GitHub OAuth setup required
        </button>
      </div>
    </Modal>
  );
}
