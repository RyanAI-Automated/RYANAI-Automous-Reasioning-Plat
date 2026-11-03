import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck, UserCog } from 'lucide-react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { API_BASE_URL } from '@/lib/apiBaseUrl';

type AdminUser = { id: string; email: string | null; role: 'user' | 'admin'; createdAt: string; lastSignInAt: string | null; isConfiguredOwner: boolean };
type Payload = { users?: AdminUser[]; canManageRoles?: boolean; error?: string };

export default function UserRolePanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [canManageRoles, setCanManageRoles] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await authenticatedFetch(API_BASE_URL + '/api/admin/users', { headers: { Accept: 'application/json' } });
      const data = await response.json().catch(() => ({})) as Payload;
      if (!response.ok) throw new Error(data.error || 'User directory request failed.');
      setUsers(Array.isArray(data.users) ? data.users : []);
      setCanManageRoles(data.canManageRoles === true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load users.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const changeRole = async (user: AdminUser) => {
    if (!canManageRoles || user.isConfiguredOwner || busyId) return;
    const role = user.role === 'admin' ? 'user' : 'admin';
    if (!window.confirm('Change ' + (user.email || user.id) + ' to ' + role + '?')) return;
    setBusyId(user.id);
    setError('');
    try {
      const response = await authenticatedFetch(API_BASE_URL + '/api/admin/users/' + encodeURIComponent(user.id) + '/role', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ role }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Role update failed.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Role update failed.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <section className="space-y-4 rounded-2xl border border-white/10 bg-slate-950/70 p-5">
      <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 font-semibold text-white"><UserCog className="h-5 w-5 text-cyan-300" /> User and role management</h2><p className="mt-1 text-xs text-slate-400">Identity records from Supabase Auth. Role changes are restricted to the configured owner.</p></div><button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh</button></header>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      {loading && <p role="status" className="text-sm text-slate-400">Loading identity directory…</p>}
      {!loading && !error && users.length === 0 && <p className="text-sm text-slate-400">No identity records were returned.</p>}
      {!loading && !error && users.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-xs"><thead className="text-slate-500"><tr className="border-b border-slate-800"><th className="py-2 pr-3">Account</th><th className="py-2 pr-3">Role</th><th className="py-2 pr-3">Last sign-in</th><th className="py-2">Owner controls</th></tr></thead><tbody>{users.map((user) => <tr key={user.id} className="border-b border-slate-900 text-slate-300"><td className="py-3 pr-3"><p>{user.email || 'No email'}</p><p className="mt-1 max-w-[240px] break-all text-[10px] text-slate-500">{user.id}</p></td><td className="py-3 pr-3">{user.role === 'admin' ? <span className="text-cyan-200">Administrator</span> : <span className="text-slate-400">User</span>}{user.isConfiguredOwner && <span className="ml-2 text-[10px] text-amber-200">Configured owner</span>}</td><td className="whitespace-nowrap py-3 pr-3 text-slate-400">{user.lastSignInAt ? new Date(user.lastSignInAt).toLocaleString() : 'Never recorded'}</td><td className="py-3">{!canManageRoles ? <span className="text-slate-500">Owner approval required</span> : user.isConfiguredOwner ? <span className="inline-flex items-center gap-1 text-amber-200"><ShieldCheck className="h-3.5 w-3.5" /> Protected</span> : <button type="button" onClick={() => void changeRole(user)} disabled={Boolean(busyId)} className="rounded-lg border border-cyan-400/30 px-2.5 py-1.5 text-cyan-100 disabled:opacity-50">{busyId === user.id ? 'Saving…' : user.role === 'admin' ? 'Demote to user' : 'Make administrator'}</button>}</td></tr>)}</tbody></table></div>}
      <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs leading-5 text-amber-100/80">Requires the server-only SUPABASE_SERVICE_ROLE_KEY. The browser never receives that credential. Every role change records an audit intent and completion event; the configured owner cannot be demoted here.</p>
    </section>
  );
}
