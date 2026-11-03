import { useCallback, useEffect, useState } from 'react';
import { KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { API_BASE_URL } from '@/lib/apiBaseUrl';

type ManagedUser = {
  id: string;
  email: string | null;
  role: 'user' | 'admin';
  createdAt: string;
  lastSignInAt: string | null;
  isConfiguredOwner: boolean;
};
type UsersPayload = { users?: ManagedUser[]; error?: string; hasMore?: boolean; canManageRoles?: boolean };

export default function UserRoleManagementPanel() {
  const [canManageRoles, setCanManageRoles] = useState(false);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await authenticatedFetch(API_BASE_URL + '/api/admin/users', { headers: { Accept: 'application/json' } });
      const data = await response.json().catch(() => ({})) as UsersPayload;
      if (!response.ok) throw new Error(data.error || 'User directory request failed.');
      setUsers(Array.isArray(data.users) ? data.users : []);
      setCanManageRoles(data.canManageRoles === true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the user directory.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [refresh]);

  const changeRole = async (user: ManagedUser, role: 'user' | 'admin') => {
    if (!canManageRoles || user.isConfiguredOwner || user.role === role || busyId) return;
    if (!window.confirm('Change ' + (user.email || user.id) + ' from ' + user.role + ' to ' + role + '?')) return;
    setBusyId(user.id);
    setError('');
    setNotice('');
    try {
      const response = await authenticatedFetch(API_BASE_URL + '/api/admin/users/' + encodeURIComponent(user.id) + '/role', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ role }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Role update failed.');
      setNotice('Role updated for ' + (user.email || user.id) + '. The user must refresh their Supabase session for the new role claim to appear.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Role update failed.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <section className="space-y-4 rounded-2xl border border-white/10 bg-slate-950/80 p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="flex items-center gap-2 font-semibold text-white"><KeyRound className="h-5 w-5 text-cyan-300" /> Identity and role management</h2><p className="mt-1 text-xs text-slate-400">Supabase Auth directory · first 100 users · role claims are server-controlled app_metadata</p></div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 disabled:opacity-50"><RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} /> Refresh</button>
      </header>
      {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      {!canManageRoles && <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-100/80">Role changes are restricted to the server-verified configured owner. Administrators can inspect the directory but cannot promote or demote users.</p>}
      {loading && <p role="status" className="text-sm text-slate-400">Loading users…</p>}
      {!loading && !error && users.length === 0 && <p className="text-sm text-slate-400">No users returned by the identity provider.</p>}
      {!loading && users.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead className="text-slate-500"><tr className="border-b border-slate-800"><th className="py-2 pr-3">Identity</th><th className="py-2 pr-3">Role</th><th className="py-2 pr-3">Last sign-in</th><th className="py-2">Control</th></tr></thead><tbody>{users.map((user) => <tr key={user.id} className="border-b border-slate-900 text-slate-300"><td className="py-3 pr-3"><p className="font-medium text-white">{user.email || 'Email unavailable'}</p>{user.isConfiguredOwner && <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-cyan-300"><ShieldCheck className="h-3 w-3" /> Configured owner</span>}<p className="mt-1 break-all text-[10px] text-slate-500">{user.id}</p></td><td className="py-3 pr-3"><span className={user.role === 'admin' ? 'text-cyan-200' : 'text-slate-400'}>{user.role}</span></td><td className="whitespace-nowrap py-3 pr-3 text-slate-400">{user.lastSignInAt ? new Date(user.lastSignInAt).toLocaleString() : 'Never'}</td><td className="py-3">{canManageRoles && !user.isConfiguredOwner ? <select aria-label={'Role for ' + (user.email || user.id)} value={user.role} disabled={busyId === user.id || Boolean(busyId)} onChange={(event) => void changeRole(user, event.target.value as 'user' | 'admin')} className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white disabled:opacity-50"><option value="user">User</option><option value="admin">Admin</option></select> : <span className="text-slate-600">Read-only</span>}</td></tr>)}</tbody></table></div>}
      <p className="text-xs leading-5 text-slate-500">Role changes require the server-side Supabase service-role credential, are audited, and never trust browser-editable user_metadata. The configured owner cannot be demoted here.</p>
    </section>
  );
}
