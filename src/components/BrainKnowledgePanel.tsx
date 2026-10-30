import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { API_BASE_URL } from '@/lib/apiBaseUrl';
import { BrainCircuit, RefreshCw, Send } from 'lucide-react';

interface KnowledgeRecord {
  id: string;
  title: string;
  source: string | null;
  category: string;
  tags: string[];
  confidence: number;
  priority: number;
  active: boolean;
  updatedAt: string;
}

/** Admin console for publishing trusted reference material to all three brains. */
export default function BrainKnowledgePanel() {
  const [items, setItems] = useState<KnowledgeRecord[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [source, setSource] = useState('');
  const [category, setCategory] = useState('general');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/api/agent/ops/knowledge`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Knowledge request failed (${response.status})`);
      setItems(Array.isArray(data.knowledge) ? data.knowledge : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load shared knowledge.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || title.trim().length < 3 || content.trim().length < 20) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/api/agent/ops/knowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, source: source || undefined, category }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Knowledge publish failed (${response.status})`);
      setTitle('');
      setContent('');
      setSource('');
      setNotice('Knowledge published. All three brains will receive it on their next reasoning run.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish knowledge.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="brain-knowledge-heading" className="mx-auto my-6 max-w-6xl rounded-2xl border border-cyan-400/20 bg-slate-950 p-5 text-slate-100 shadow-xl">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BrainCircuit className="h-6 w-6 text-cyan-300" />
          <div>
            <h2 id="brain-knowledge-heading" className="font-semibold text-cyan-100">AI Brain Knowledge Relay</h2>
            <p className="text-xs text-slate-400">Curated shared intelligence for NVIDIA, Qwen and Logic</p>
          </div>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="rounded-lg border border-slate-700 p-2 text-slate-300 disabled:opacity-50" aria-label="Refresh knowledge">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>
      <form onSubmit={publish} className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-xs text-slate-300">Knowledge title
          <input value={title} onChange={(event) => setTitle(event.target.value)} minLength={3} maxLength={200} required className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm" placeholder="Security advisory, architecture decision…" />
        </label>
        <label className="space-y-1 text-xs text-slate-300">Category
          <select value={category} onChange={(event) => setCategory(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm">
            <option value="general">General</option><option value="security">Security</option><option value="engineering">Engineering</option><option value="operations">Operations</option><option value="research">Research</option>
          </select>
        </label>
        <label className="space-y-1 text-xs text-slate-300 md:col-span-2">Source reference
          <input value={source} onChange={(event) => setSource(event.target.value)} maxLength={500} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm" placeholder="URL, document reference or internal source" />
        </label>
        <label className="space-y-1 text-xs text-slate-300 md:col-span-2">Knowledge content
          <textarea value={content} onChange={(event) => setContent(event.target.value)} minLength={20} maxLength={12000} required rows={4} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm" placeholder="Add verified facts, technical decisions, security advisories or reference material…" />
        </label>
        <div className="flex items-center justify-between gap-3 md:col-span-2">
          <p className="text-xs text-slate-500">Items are treated as reference data, never executable instructions.</p>
          <button type="submit" disabled={loading || title.trim().length < 3 || content.trim().length < 20} className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            <Send className="h-4 w-4" /> Publish to brains
          </button>
        </div>
      </form>
      {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
      {notice && <p role="status" className="mt-3 text-sm text-emerald-300">{notice}</p>}
      <div className="mt-5 space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-400"><span>Shared knowledge records</span><span>{items.length} / 100</span></div>
        {items.length === 0 && <p className="rounded-lg border border-dashed border-slate-800 p-4 text-sm text-slate-500">{loading ? 'Loading knowledge…' : 'No shared knowledge has been published yet.'}</p>}
        {items.map((item) => (
          <article key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
            <div className="min-w-0"><h3 className="truncate text-sm text-slate-100">{item.title}</h3><p className="text-xs text-slate-500">{item.category} · confidence {Math.round(item.confidence * 100)}%{item.source ? ` · ${item.source}` : ''}</p></div>
            <span className={`rounded-full px-2 py-1 text-[10px] ${item.active ? 'bg-emerald-400/10 text-emerald-300' : 'bg-slate-700 text-slate-400'}`}>{item.active ? 'ACTIVE' : 'INACTIVE'}</span>
          </article>
        ))}
      </div>
    </section>
  );
}
