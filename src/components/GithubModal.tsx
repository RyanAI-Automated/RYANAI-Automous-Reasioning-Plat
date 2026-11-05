import { useCallback, useEffect, useState } from 'react';
import Modal from './Modal';
import { GithubLogo as Github } from '@phosphor-icons/react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';

interface GitHubStatus {
  status: 'not_configured' | 'not_connected' | 'connected' | 'reauthorization_required' | 'repository_access_missing' | 'unverified';
  connected?: boolean;
  configured?: boolean;
  account?: { login: string; avatarUrl?: string };
  repository?: { fullName: string; permissions?: Record<string, boolean> };
  accessTokenExpiresAt?: string | null;
  message?: string;
}

interface GitHubModalProps {
  open: boolean;
  onClose: () => void;
}

function statusLabel(status: GitHubStatus['status'] | null, checking: boolean): string {
  if (checking && !status) return 'Checking';
  switch (status?.status) {
    case 'connected': return 'Connected · verified';
    case 'not_connected': return 'Not connected';
    case 'reauthorization_required': return 'Reconnect required';
    case 'repository_access_missing': return 'Repository access missing';
    case 'unverified': return 'Verification unavailable';
    default: return 'Not configured';
  }
}

/** The app reports connected only after server-side account and repository verification. */
export default function GithubModal({ open, onClose }: GitHubModalProps) {
  const [integration, setIntegration] = useState<GitHubStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refreshStatus = useCallback(async () => {
    setChecking(true);
    setError('');
    try {
      const response = await authenticatedFetch('/api/github/status');
      const payload = await response.json().catch(() => ({})) as GitHubStatus & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Could not verify the GitHub connection.');
      setIntegration(payload);
    } catch (cause) {
      setIntegration({ status: 'unverified', connected: false });
      setError(cause instanceof Error ? cause.message : 'Could not verify the GitHub connection.');
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refreshStatus();
  }, [open, refreshStatus]);

  async function connectGitHub() {
    if (busy || integration?.status === 'connected') return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await authenticatedFetch('/api/github/connect');
      const payload = await response.json().catch(() => ({})) as { authorizationUrl?: string; error?: string };
      if (!response.ok || !payload.authorizationUrl) {
        throw new Error(payload.error || 'GitHub App authorization is not configured.');
      }
      const authorizationUrl = new URL(payload.authorizationUrl);
      if (authorizationUrl.origin !== 'https://github.com' || authorizationUrl.pathname !== '/login/oauth/authorize') {
        throw new Error('The server returned an untrusted GitHub authorization URL.');
      }
      window.location.assign(authorizationUrl.toString());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start GitHub authorization.');
      setBusy(false);
    }
  }

  async function disconnectGitHub() {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await authenticatedFetch('/api/github/disconnect', { method: 'POST' });
      const payload = await response.json().catch(() => ({})) as {
        disconnected?: boolean;
        remoteRevocation?: 'confirmed' | 'unconfirmed' | 'not_needed';
        error?: string;
      };
      if (!response.ok || payload.disconnected !== true) {
        throw new Error(payload.error || 'Could not disconnect the GitHub account.');
      }
      setNotice(payload.remoteRevocation === 'confirmed'
        ? 'The GitHub authorization was revoked and the local connection was removed.'
        : 'The local connection was removed. Remote revocation could not be confirmed; review the app authorization in GitHub settings.');
      await refreshStatus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not disconnect the GitHub account.');
    } finally {
      setBusy(false);
    }
  }

  const connected = integration?.status === 'connected';
  const notConfigured = !integration || integration.status === 'not_configured';

  return (
    <Modal open={open} onClose={onClose} title="GitHub Integration" icon={<Github size={20} />}>
      <div className="space-y-4 text-sm text-ink-300">
        <div className="flex items-center justify-between gap-3">
          <strong>RyanAI GitHub connection</strong>
          <span className={`rounded-full border px-2 py-1 text-xs ${
            connected
              ? 'border-emerald-400/20 bg-emerald-400/5 text-emerald-300'
              : 'border-amber-400/20 bg-amber-400/5 text-amber-300'
          }`}>{statusLabel(integration, checking)}</span>
        </div>

        {connected ? (
          <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3">
            <p className="text-sm font-semibold text-emerald-100">
              Connected as {integration?.account?.login || 'GitHub user'}
            </p>
            <p className="mt-1 text-xs text-ink-300">
              Verified repository: {integration?.repository?.fullName}
            </p>
            <p className="mt-2 text-[11px] leading-5 text-ink-400">
              The server verified this account and repository read access. RyanAI’s integration currently exposes read-only repository status; this connection does not authorize automatic merges, pushes or deployments.
            </p>
          </div>
        ) : (
          <p>
            Link a GitHub account to the official RyanAI repository. The connection is not considered active until the server verifies the returned GitHub identity and repository read permission.
          </p>
        )}

        {integration?.status === 'reauthorization_required' && (
          <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-200">
            The user access token or refresh token has expired or could not be refreshed. Reauthorize the GitHub App to continue.
          </p>
        )}
        {integration?.status === 'repository_access_missing' && (
          <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-200">
            The GitHub account is identifiable, but access to the official RyanAI repository could not be verified. Check the GitHub App installation and its repository selection.
          </p>
        )}
        {integration?.status === 'unverified' && (
          <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-200">
            GitHub could not verify the saved connection. RyanAI will not treat it as connected until verification succeeds.
          </p>
        )}

        {notConfigured && (
          <div className="rounded-lg border border-white/10 bg-ink-900/50 p-3">
            <h3 className="text-xs font-semibold text-white">Registration and server configuration required</h3>
            <ol className="mt-2 list-decimal space-y-2 pl-4 text-xs leading-5 text-ink-400">
              <li>Register a GitHub App and grant only the repository read permissions required by the integration.</li>
              <li>Register the exact API callback URL <code>/api/github/callback</code> and configure the matching server-side URL.</li>
              <li>Provide the App client ID, client secret and a 32-byte token-encryption key through the approved server secret-management process.</li>
              <li>Configure the trusted frontend return URL. No credentials are supplied by this screen.</li>
            </ol>
            <a href="https://github.com/settings/apps" target="_blank" rel="noreferrer"
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/10">
              Review GitHub App registration
            </a>
          </div>
        )}

        {error && <p role="alert" className="rounded-lg border border-rose-400/20 bg-rose-400/5 p-3 text-xs text-rose-200">{error}</p>}
        {notice && <p role="status" className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-3 text-xs text-cyan-100">{notice}</p>}

        <div className="flex flex-wrap gap-2">
          {!connected ? (
            <button type="button" onClick={() => void connectGitHub()}
              disabled={busy || checking || notConfigured}
              className="flex-1 rounded-lg bg-cyan-400 px-3 py-2 text-sm font-semibold text-ink-950 disabled:cursor-not-allowed disabled:opacity-40">
              {busy ? 'Connecting…' : 'Connect GitHub'}
            </button>
          ) : (
            <button type="button" onClick={() => void disconnectGitHub()} disabled={busy}
              className="flex-1 rounded-lg border border-rose-400/30 px-3 py-2 text-sm text-rose-200 disabled:opacity-50">
              {busy ? 'Disconnecting…' : 'Disconnect GitHub'}
            </button>
          )}
          <button type="button" onClick={() => void refreshStatus()} disabled={checking || busy}
            className="rounded-lg border border-white/10 px-3 py-2 text-sm text-ink-300 disabled:opacity-40">
            {checking ? 'Checking…' : 'Refresh status'}
          </button>
        </div>
        <p className="text-[11px] leading-5 text-ink-500">
          OAuth uses a short-lived one-time state value, PKCE S256 and encrypted server-side tokens. Browser code receives no access or refresh token. An external engineering connector is not treated as an in-app GitHub session.
        </p>
      </div>
    </Modal>
  );
}
