import Modal from './Modal';
import { GithubLogo as Github } from '@phosphor-icons/react';

interface GithubModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Report the real integration state and the remaining secure setup work.
 * The ChatGPT GitHub connector is not an OAuth session inside the RyanAI app.
 */
export default function GithubModal({ open, onClose }: GithubModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="GitHub Integration" icon={<Github size={20} />}>
      <div className="space-y-4 text-sm text-ink-300">
        <div className="flex items-center justify-between gap-3">
          <strong>RyanAI GitHub connection</strong>
          <span className="rounded-full border border-amber-400/20 bg-amber-400/5 px-2 py-1 text-xs text-amber-300">Not configured</span>
        </div>
        <p>
          GitHub account linking and conversation sync are not configured in this deployment.
          No GitHub account is connected to this RyanAI workspace. Repository access available
          to an external engineering tool does not establish an in-app GitHub OAuth session.
        </p>
        <div className="rounded-lg border border-white/10 bg-ink-900/50 p-3">
          <h3 className="text-xs font-semibold text-white">Required integration work</h3>
          <ol className="mt-2 list-decimal space-y-2 pl-4 text-xs leading-5 text-ink-400">
            <li>Register a RyanAI GitHub App or OAuth application and define its verified callback URL.</li>
            <li>Implement and test the server-side authorization callback, state validation and token exchange.</li>
            <li>Store tokens only in an encrypted server-side credential store; never expose them to browser code.</li>
            <li>Request least-privilege repository and pull-request access, then add revocation and disconnect controls.</li>
            <li>Verify repository identity, permissions and API health before showing a connected state.</li>
          </ol>
        </div>
        <a href="https://github.com/settings/apps" target="_blank" rel="noreferrer"
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/10">
          Review GitHub App registration
        </a>
        <button type="button" disabled title="The server-side OAuth callback and encrypted token storage are not implemented."
          className="w-full rounded-lg bg-cyan-500/10 px-3 py-2 text-sm text-ink-500 cursor-not-allowed">
          GitHub OAuth setup required
        </button>
        <p className="text-[11px] leading-5 text-ink-500">
          Connection remains disabled until the server-side flow and security controls are implemented.
          No token, repository permission or successful connection is assumed.
        </p>
      </div>
    </Modal>
  );
}
