import { useCallback, useEffect, useState } from 'react';
import { Monitor, RefreshCw, ShieldCheck, ShieldOff } from 'lucide-react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { API_BASE_URL } from '@/lib/apiBaseUrl';

type ApiSession = { id: string; userId: string; email?: string | null; createdAt: string; lastSeenAt: string; revokedAt?: string | null; isCurrent: boolean; status: 'active' | 'revoked' };
type Payload = { sessions?: ApiSession[]; enforcement?: string; error?: string };

export default function SessionControlPanel() {
  const [sessions, setSessions] = useState<ApiSession[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await authenticatedFetch(API_BASE_URL + '/api/admin/sessions', { headers: { Accept: 'application/json' } });
      const data = await response.json().catch(() => ({})) as Payload;
      if (!response.ok) throw new Error(data.error || 'Session list request failed.');
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load API sessions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const revoke = async (session: ApiSession) => {
    if (session.isCurrent || session.status === 'revoked' || busyId) return;
    setBusyId(session.id);
    setError('');
    try {
      const response = await authenticatedFetch(API_BASE_URL + '/api/admin/sessions/' + encodeURIComponent(session.id) + '/revoke', { method: 'POST', headers: { Accept: 'application/json' } });
      const data = await response.json().catch(() => ({})) as Payload;
      if (!response.ok) throw new Error(data.error || 'Session revocation failed.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Session revocation failed.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <section className="space-y-4 rounded-2xl border border-white/10 bg-slate-950/70 p-5">
      <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 font-semibold text-white"><Monitor className="h-5 w-5 text-cyan-300" /> API session controls</h2><p className="mt-1 text-xs text-slate-400">Review recent verified RyanAI API sessions and revoke access server-side.</p></div><button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh</button></header>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      {loading && <p role="status" className="text-sm text-slate-400">Loading sessions…</p>}
      {!loading && !error && sessions.length === 0 && <p className="text-sm text-slate-400">No API sessions have been registered yet.</p>}
      {!loading && sessions.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-xs"><thead className="text-slate-500"><tr className="border-b border-slate-800"><th className="py-2 pr-3">Identity</th><th className="py-2 pr-3">Last seen</th><th className="py-2 pr-3">Status</th><th className="py-2">Action</th></tr></thead><tbody>{sessions.map((session) => <tr key={session.id} className="border-b border-slate-900 text-slate-300"><td className="py-3 pr-3"><p>{session.email || session.userId}</p>{session.isCurrent && <span className="text-[10px] text-cyan-300">Current administrator session</span>}</td><td className="whitespace-nowrap py-3 pr-3 text-slate-400">{new Date(session.lastSeenAt).toLocaleString()}</td><td className="py-3 pr-3">{session.status === 'revoked' ? <span className="text-rose-300">Revoked</span> : <span className="text-emerald-300">Active in API registry</span>}</td><td className="py-3">{session.status === 'revoked' ? <span className="text-slate-500">—</span> : session.isCurrent ? <span className="text-slate-500">Current session protected</span> : <button type="button" onClick={() => void revoke(session)} disabled={Boolean(busyId)} className="inline-flex items-center gap-1 rounded-lg border border-rose-400/30 px-2.5 py-1.5 text-rose-200 disabled:opacity-50"><ShieldOff className="h-3.5 w-3.5" />{busyId === session.id ? 'Revoking…' : 'Revoke API access'}</button>}</td></tr>)}</tbody></table></div>}
      <p className="flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs leading-5 text-amber-100/80"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />Revocation blocks RyanAI API access for the Supabase session ID recorded by the server. It does not directly terminate the Supabase Auth session or other apps using that provider session.</p>
    </section>
  );
}
