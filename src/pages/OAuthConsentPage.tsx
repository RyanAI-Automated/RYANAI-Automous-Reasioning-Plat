import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface OAuthConsentDetails {
  clientName: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
}
interface OAuthConsentPageProps {
  userId: string;
  onRedirect?: (url: string) => void;
}
const defaultRedirect = (url: string) => window.location.assign(url);

function redirectToClient(url: string, onRedirect: (url: string) => void, expectedRedirectUri?: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Supabase returned an invalid OAuth redirect URL.');
  }
  if (['javascript:', 'data:', 'vbscript:', 'file:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('Supabase returned an invalid OAuth redirect URL.');
  }
  // Bind approval/denial to the exact callback shown on the consent screen.
  // Custom URI schemes remain available for registered native clients.
  if (expectedRedirectUri) {
    let expected: URL;
    try {
      expected = new URL(expectedRedirectUri);
    } catch {
      throw new Error('The registered OAuth callback URI is invalid.');
    }
    if (parsed.protocol !== expected.protocol || parsed.hostname !== expected.hostname || parsed.pathname !== expected.pathname) {
      throw new Error('Supabase returned a redirect that does not match the registered callback URI.');
    }
  }
  onRedirect(parsed.toString());
}

function getConsentDetails(value: unknown): OAuthConsentDetails | null {
  if (!value || typeof value !== 'object') return null;
  const result = value as Record<string, unknown>;
  if (!Object.hasOwn(result, 'authorization_id')) return null;
  const client = result.client && typeof result.client === 'object' ? result.client as Record<string, unknown> : {};
  const redirectUri = typeof result.redirect_uri === 'string' ? result.redirect_uri : '';
  if (!redirectUri) return null;
  const rawScope = typeof result.scope === 'string' ? result.scope.trim() : '';
  return {
    clientName: typeof client.name === 'string' && client.name.trim() ? client.name.trim() : 'Unidentified application',
    clientId: typeof client.id === 'string' ? client.id : typeof client.client_id === 'string' ? client.client_id : '',
    redirectUri,
    scopes: rawScope ? [...new Set(rawScope.split(/\\s+/).filter(Boolean))] : [],
  };
}

/**
 * Supabase Auth handles authorization codes, PKCE, token issuance and signing.
 * RyanAI authenticates the account, displays the client request and records the
 * user's explicit decision through the Supabase OAuth Server SDK methods.
 */
export default function OAuthConsentPage({ userId, onRedirect = defaultRedirect }: OAuthConsentPageProps) {
  const authorizationId = new URLSearchParams(window.location.search).get('authorization_id')?.trim() ?? '';
  const [details, setDetails] = useState<OAuthConsentDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const loadDetails = async () => {
      if (!authorizationId) {
        setError('This authorization link is missing its request identifier. Close this page and restart the connection from the requesting application.');
        setLoading(false);
        return;
      }
      if (!supabase) {
        setError('RyanAI authentication is not configured. The authorization request cannot continue.');
        setLoading(false);
        return;
      }
      try {
        // Revalidate the session with Auth before exposing or approving any request.
        const { data: identity, error: identityError } = await supabase.auth.getUser();
        if (identityError || !identity.user || identity.user.is_anonymous || identity.user.id !== userId) {
          throw new Error('Your session could not be verified. Sign in again before authorizing this application.');
        }
        const { data, error: requestError } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
        if (requestError || !data) throw new Error('The authorization request is invalid, expired, or unavailable.');
        const result = data as unknown as Record<string, unknown>;
        // Supabase returns a redirect directly when this user has already consented.
        if (!Object.hasOwn(result, 'authorization_id')) {
          if (typeof result.redirect_url !== 'string') throw new Error('Supabase returned an incomplete authorization response.');
          redirectToClient(result.redirect_url, onRedirect);
          return;
        }
        const parsed = getConsentDetails(data);
        if (!parsed) throw new Error('The requesting application details are incomplete. No access was granted.');
        if (active) setDetails(parsed);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to retrieve the authorization request.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void loadDetails();
    return () => { active = false; };
  }, [authorizationId, userId, onRedirect]);

  const decide = async (decision: 'approve' | 'deny') => {
    if (!supabase || !authorizationId || busy || !details) return;
    setBusy(true);
    setError('');
    try {
      const response = decision === 'approve'
        ? await supabase.auth.oauth.approveAuthorization(authorizationId)
        : await supabase.auth.oauth.denyAuthorization(authorizationId);
      if (response.error || !response.data?.redirect_url) {
        throw new Error(decision === 'approve'
          ? 'RyanAI could not approve this request. No access was granted.'
          : 'RyanAI could not deny this request. Please retry.');
      }
      redirectToClient(response.data.redirect_url, onRedirect, details.redirectUri);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The authorization decision failed.');
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center px-5 py-10 sm:px-8">
      <div className="rounded-2xl border border-cyan-400/20 bg-slate-900/90 p-6 shadow-2xl shadow-cyan-950/20 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">RyanAI secure authorization</p>
        <h1 className="mt-3 font-display text-2xl font-bold text-white sm:text-3xl">Connect an application</h1>
        <p className="mt-2 text-sm leading-6 text-slate-300">Review the application and the requested permissions before granting access to your RyanAI account.</p>

        {loading ? (
          <p role="status" className="mt-8 rounded-lg bg-slate-800 p-4 text-sm text-slate-300">Verifying the authorization request…</p>
        ) : error ? (
          <div role="alert" className="mt-8 rounded-lg border border-rose-400/30 bg-rose-950/30 p-4 text-sm text-rose-200">{error}</div>
        ) : details ? (
          <>
            <div className="mt-8 space-y-4 rounded-xl border border-white/10 bg-slate-950/70 p-5">
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-500">Application</p>
                <p className="mt-1 break-words text-lg font-semibold text-white">{details.clientName}</p>
                {details.clientId && <p className="mt-1 break-all font-mono text-xs text-slate-500">Client ID: {details.clientId}</p>}
              </div>
              <div className="border-t border-white/10 pt-4">
                <p className="text-xs uppercase tracking-wider text-slate-500">Redirect destination</p>
                <p className="mt-1 break-all text-sm text-slate-200">{details.redirectUri}</p>
              </div>
              <div className="border-t border-white/10 pt-4">
                <p className="text-xs uppercase tracking-wider text-slate-500">Requested permissions</p>
                {details.scopes.length ? (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {details.scopes.map((scope) => <li key={scope} className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-100">{scope}</li>)}
                  </ul>
                ) : <p className="mt-2 text-sm text-slate-300">No additional scopes were requested.</p>}
              </div>
            </div>
            <p className="mt-5 text-xs leading-5 text-slate-400">Access remains subject to your account permissions and row-level security policies. You can deny this request without sharing data.</p>
            <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" disabled={busy} onClick={() => void decide('deny')} className="rounded-lg border border-slate-600 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:cursor-not-allowed disabled:opacity-50">
                {busy ? 'Processing…' : 'Deny access'}
              </button>
              <button type="button" disabled={busy} onClick={() => void decide('approve')} className="rounded-lg bg-cyan-400 px-5 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 disabled:cursor-not-allowed disabled:opacity-50">
                {busy ? 'Processing…' : 'Approve access'}
              </button>
            </div>
          </>
        ) : <p role="status" className="mt-8 text-sm text-slate-300">Waiting for the authorization response from Supabase.</p>}
      </div>
    </section>
  );
}
