import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Brain, Pencil, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react';
import Modal from './Modal';
import { authenticatedFetch } from '@/lib/authenticatedFetch';

interface VaultEntry {
  id: string;
  key: string;
  value: string;
  category: string;
  createdAt: string | null;
}

interface MemoryVaultProps {
  open: boolean;
  userId: string;
  onClose: () => void;
}

const CATEGORIES = ['preference', 'project', 'note', 'decision', 'context'] as const;

function dateLabel(value: string | null): string {
  if (!value) return 'Date not reported';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString();
}

/** Account-scoped UI for the same persistent memory records used by RyanAI reasoning. */
export default function MemoryVault({ open, userId, onClose }: MemoryVaultProps) {
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [search, setSearch] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [category, setCategory] = useState<string>('preference');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editCategory, setEditCategory] = useState('preference');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async (signal?: AbortSignal, append = false, query = activeSearch, cursor?: string) => {
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (cursor) params.set('cursor', cursor);
      params.set('limit', '50');
      const response = await authenticatedFetch('/api/user/memory?' + params.toString(), {
        headers: { Accept: 'application/json' },
        signal,
      });
      const payload = await response.json().catch(() => ({})) as { entries?: VaultEntry[]; error?: string; hasMore?: boolean; nextCursor?: string | null };
      if (!response.ok) throw new Error(payload.error || 'Could not load saved memories.');
      setError('');
      const loaded = Array.isArray(payload.entries) ? payload.entries : [];
      setEntries((current) => append ? [...current, ...loaded] : loaded);
      setHasMore(payload.hasMore === true);
      setNextCursor(typeof payload.nextCursor === 'string' ? payload.nextCursor : null);
    } catch (cause) {
      if (signal?.aborted) return;
      setError(cause instanceof Error ? cause.message : 'Could not load saved memories.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [activeSearch]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [open, userId, refresh]);

  async function addMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = input.trim();
    if (!value || saving) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await authenticatedFetch('/api/user/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, category }),
      });
      const payload = await response.json().catch(() => ({})) as { entry?: VaultEntry; error?: string };
      if (!response.ok || !payload.entry) throw new Error(payload.error || 'Could not save this memory.');
      setInput('');
      setNotice('Memory saved to your account and made available to RyanAI reasoning.');
      // Reload the active filter so a new entry cannot corrupt filtered results or page cursors.
      await refresh(undefined, false, activeSearch);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this memory.');
    } finally {
      setSaving(false);
    }
  }

  function beginEdit(entry: VaultEntry) {
    setEditingId(entry.id);
    setEditValue(entry.value);
    setEditCategory(entry.category || 'preference');
    setError('');
    setNotice('');
  }

  async function saveEdit(entry: VaultEntry) {
    const value = editValue.trim();
    if (!value || busyId) return;
    setBusyId(entry.id);
    setError('');
    setNotice('');
    try {
      const response = await authenticatedFetch('/api/user/memory/' + encodeURIComponent(entry.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, category: editCategory }),
      });
      const payload = await response.json().catch(() => ({})) as { entry?: VaultEntry; error?: string };
      if (!response.ok || !payload.entry) throw new Error(payload.error || 'Could not update this memory.');
      setEditingId(null);
      setNotice('Memory updated.');
      // Editing can change whether an entry matches the active query and its page position.
      await refresh(undefined, false, activeSearch);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update this memory.');
    } finally {
      setBusyId(null);
    }
  }

  async function deleteMemory(entry: VaultEntry) {
    if (busyId) return;
    setBusyId(entry.id);
    setError('');
    setNotice('');
    try {
      const response = await authenticatedFetch('/api/user/memory/' + encodeURIComponent(entry.id), {
        method: 'DELETE',
      });
      const payload = await response.json().catch(() => ({})) as { deleted?: boolean; error?: string };
      if (!response.ok || payload.deleted !== true) throw new Error(payload.error || 'Could not delete this memory.');
      if (editingId === entry.id) setEditingId(null);
      setNotice('Memory deleted from your account.');
      // Rebuild the first page so deleting a cursor row cannot strand later pages.
      await refresh(undefined, false, activeSearch);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete this memory.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Memory Vault" icon={<Brain size={20} />}>
      <div className="space-y-4">
        <div className="rounded-xl border border-cyan-400/15 bg-cyan-400/5 p-3">
          <p className="text-xs leading-5 text-slate-300">
            Memories are saved to your account in PostgreSQL. RyanAI uses this same store when it loads saved context for reasoning.
          </p>
        </div>

        {error && <p role="alert" className="rounded-lg border border-rose-400/20 bg-rose-400/5 p-3 text-sm text-rose-200">{error}</p>}
        {notice && <p role="status" className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3 text-sm text-emerald-200">{notice}</p>}

        <form onSubmit={addMemory} className="space-y-2 rounded-xl border border-white/10 bg-slate-900/60 p-3">
          <label htmlFor="memory-new-content" className="block text-xs font-semibold text-slate-200">New memory</label>
          <textarea id="memory-new-content" value={input} onChange={(event) => setInput(event.target.value)}
            required minLength={1} maxLength={2000} rows={3}
            placeholder="Save a preference, project fact, decision or useful context…"
            className="w-full resize-y rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-cyan-300 focus:outline-none" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs text-slate-400">
              Category
              <select value={category} onChange={(event) => setCategory(event.target.value)}
                className="rounded-lg border border-white/10 bg-slate-950 px-2 py-1.5 text-xs text-slate-200">
                {CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <button type="submit" disabled={saving || !input.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-50">
              <Plus className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save memory'}
            </button>
          </div>
          <p className="text-[11px] text-slate-500">{input.length.toLocaleString()} / 2,000 characters</p>
        </form>

        <form onSubmit={(event) => { event.preventDefault(); setActiveSearch(search.trim()); }} className="flex gap-2">
          <label htmlFor="memory-search" className="sr-only">Search memories</label>
          <input id="memory-search" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={100}
            placeholder="Search memory text or category…" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white placeholder:text-slate-600" />
          <button type="submit" disabled={loading} className="rounded-lg border border-cyan-400/20 px-3 py-2 text-xs text-cyan-200 disabled:opacity-50">Search</button>
          {activeSearch && <button type="button" onClick={() => { setSearch(''); setActiveSearch(''); }} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300">Clear</button>}
        </form>

        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Saved memories</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">{entries.length} loaded{activeSearch ? ' · filtered' : ''}{hasMore ? ' · more available' : ''}</p>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50">
            <RefreshCw className={'h-3.5 w-3.5 ' + (loading ? 'animate-spin' : '')} /> Refresh
          </button>
        </div>

        {loading && entries.length === 0 && <p role="status" className="rounded-lg border border-white/10 p-4 text-sm text-slate-400">Loading account memories…</p>}
        {!loading && !error && entries.length === 0 && <p className="rounded-lg border border-dashed border-white/15 p-4 text-sm text-slate-400">No memories saved yet. Add one above to make it available to RyanAI reasoning.</p>}

        <div className="max-h-72 space-y-2 overflow-y-auto">
          {entries.map((entry) => {
            const editing = editingId === entry.id;
            const busy = busyId === entry.id;
            return (
              <article key={entry.id} className="rounded-lg border border-white/10 bg-slate-950/70 p-3">
                {editing ? (
                  <div className="space-y-2">
                    <textarea value={editValue} onChange={(event) => setEditValue(event.target.value)}
                      maxLength={2000} rows={3} aria-label="Edit memory content"
                      className="w-full resize-y rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white focus:border-cyan-300 focus:outline-none" />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <select value={editCategory} onChange={(event) => setEditCategory(event.target.value)}
                        aria-label="Edit memory category"
                        className="rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-200">
                        {CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setEditingId(null)} disabled={busy}
                          className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 disabled:opacity-50">
                          <X className="h-3.5 w-3.5" /> Cancel
                        </button>
                        <button type="button" onClick={() => void saveEdit(entry)} disabled={busy || !editValue.trim()}
                          className="inline-flex items-center gap-1 rounded-lg bg-cyan-400 px-2.5 py-1.5 text-xs font-semibold text-slate-950 disabled:opacity-50">
                          <Save className="h-3.5 w-3.5" /> {busy ? 'Saving…' : 'Save changes'}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">{entry.value}</p>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[10px] text-slate-500">{entry.category} · {dateLabel(entry.createdAt)}</p>
                      <div className="flex gap-1.5">
                        <button type="button" onClick={() => beginEdit(entry)} disabled={busyId !== null}
                          aria-label="Edit memory" className="rounded-md p-1.5 text-slate-400 hover:bg-cyan-400/10 hover:text-cyan-200 disabled:opacity-40">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => void deleteMemory(entry)} disabled={busyId !== null}
                          aria-label="Delete memory" className="rounded-md p-1.5 text-slate-400 hover:bg-rose-400/10 hover:text-rose-200 disabled:opacity-40">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </div>
        {hasMore && nextCursor && <button type="button" onClick={() => void refresh(undefined, true, activeSearch, nextCursor)} disabled={loading}
          className="w-full rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50">
          {loading ? 'Loading…' : 'Load more memories'}
        </button>}
      </div>
    </Modal>
  );
}
