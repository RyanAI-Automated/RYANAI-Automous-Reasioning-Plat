import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, BookOpen, RefreshCw, Search, ShieldAlert, Wrench } from 'lucide-react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { API_BASE_URL } from '@/lib/apiBaseUrl';

type McpTool = { name: string; description?: string; inputSchema?: unknown };
type RegistryResponse = { available?: boolean; discoveredAt?: string; tools?: McpTool[]; error?: string; note?: string };

export default function ToolsDashboard() {
  const [tools, setTools] = useState<McpTool[]>([]);
  const [query, setQuery] = useState('');
  const [discoveredAt, setDiscoveredAt] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await authenticatedFetch(API_BASE_URL + '/api/admin/mcp/registry', { headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(() => ({})) as RegistryResponse;
      if (!response.ok || !payload.available || !Array.isArray(payload.tools)) {
        throw new Error(payload.error || 'The live MCP registry is unavailable.');
      }
      setTools(payload.tools);
      setDiscoveredAt(payload.discoveredAt || new Date().toISOString());
    } catch (cause) {
      setTools([]);
      setDiscoveredAt('');
      setError(cause instanceof Error ? cause.message : 'Live MCP discovery failed.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [refresh]);

  const filtered = useMemo(() => tools.filter((tool) => (tool.name + ' ' + (tool.description || '')).toLowerCase().includes(query.toLowerCase())), [tools, query]);

  return (
    <section className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">MCP governance</p><h1 className="mt-2 text-3xl font-bold text-white">RyanAI Live Tools Registry</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Discovered from the configured MCP runtime through the authenticated RyanAI API. Tool visibility does not grant permission to invoke tools.</p></div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh registry</button>
      </header>
      <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-900/70 px-4"><Search className="h-4 w-4 text-slate-400" /><input aria-label="Search MCP tools" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search discovered tools…" className="w-full bg-transparent py-3 text-sm text-white outline-none placeholder:text-slate-500" /></div>
      {loading && <p role="status" className="text-sm text-slate-400">Discovering tools from the live MCP server…</p>}
      {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-100/90"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="font-semibold">Live registry unavailable</p><p className="mt-1 text-xs leading-5">{error}</p><p className="mt-1 text-xs text-slate-400">Check MCP_SERVER_URL, the server host allowlist, and the server-only MCP_AUTH_TOKEN configuration.</p></div></div>}
      {!loading && !error && <><div className="flex flex-wrap items-center gap-2 text-xs text-slate-400"><BookOpen className="h-4 w-4 text-cyan-300" /> {tools.length} tools discovered · {discoveredAt ? new Date(discoveredAt).toLocaleString() : 'timestamp unavailable'}</div><div className="grid gap-3 lg:grid-cols-2">
        {filtered.map((tool) => <article key={tool.name} className="rounded-xl border border-white/10 bg-slate-900/70 p-5"><div className="flex items-center gap-2 text-cyan-200"><Wrench className="h-4 w-4" /><h2 className="font-mono text-sm font-semibold text-white">{tool.name}</h2></div><p className="mt-3 text-sm leading-6 text-slate-400">{tool.description || 'No description supplied by the MCP server.'}</p></article>)}
      </div>{filtered.length === 0 && <p className="rounded-xl border border-dashed border-white/10 p-6 text-sm text-slate-400">No discovered tools match that search.</p>}</>}
      <div className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-4"><div className="flex items-center gap-2 text-sm font-semibold text-amber-100"><ShieldAlert className="h-4 w-4" /> Discovery is not execution authority</div><p className="mt-2 text-xs leading-5 text-slate-300">This dashboard is read-only. Tool execution remains governed by the MCP server's explicit operator allowlist and its own security policy. No enable/disable controls are exposed here.</p><p className="mt-2 text-xs text-slate-400">Credentials and authorization headers are never returned to the browser.</p></div>
    </section>
  );
}
