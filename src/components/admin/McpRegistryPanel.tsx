import { useCallback, useEffect, useState } from 'react';
import { Network, RefreshCw, ShieldCheck, Wrench } from 'lucide-react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { API_BASE_URL } from '@/lib/apiBaseUrl';

type McpTool = { name: string; description: string; inputSchema: unknown };
type RegistryPayload = { available?: boolean; discoveredAt?: string; transport?: string; tools?: McpTool[]; error?: string; note?: string };

export default function McpRegistryPanel() {
  const [tools, setTools] = useState<McpTool[]>([]);
  const [discoveredAt, setDiscoveredAt] = useState('');
  const [transport, setTransport] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await authenticatedFetch(API_BASE_URL + '/api/admin/mcp/registry', {
        headers: { Accept: 'application/json' },
      });
      const data = await response.json().catch(() => ({})) as RegistryPayload;
      if (!response.ok || data.available !== true) {
        throw new Error(data.error || 'Live MCP registry is unavailable.');
      }
      setTools(Array.isArray(data.tools) ? data.tools : []);
      setDiscoveredAt(data.discoveredAt || '');
      setTransport(data.transport || 'unknown');
    } catch (cause) {
      setTools([]);
      setDiscoveredAt('');
      setTransport('');
      setError(cause instanceof Error ? cause.message : 'Could not discover MCP tools.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [refresh]);

  return (
    <section className="space-y-4 rounded-2xl border border-white/10 bg-slate-950/70 p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-white"><Network className="h-5 w-5 text-cyan-300" /> Governed MCP registry</h2>
          <p className="mt-1 text-xs text-slate-400">Live server discovery · read-only inspection · no tool is enabled or invoked here.</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 disabled:opacity-50">
          <RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} /> Discover
        </button>
      </header>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      {loading && <p role="status" className="text-sm text-slate-400">Discovering tools from the configured MCP runtime…</p>}
      {!loading && !error && discoveredAt && <p className="text-xs text-slate-500">Transport: {transport} · Discovered: {new Date(discoveredAt).toLocaleString()}</p>}
      {!loading && !error && tools.length === 0 && <p className="text-sm text-slate-400">No tools were returned by the configured MCP server.</p>}
      {!loading && tools.length > 0 && <div className="grid gap-3 md:grid-cols-2">
        {tools.map((tool) => <article key={tool.name} className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
          <div className="flex items-center gap-2 text-cyan-200"><Wrench className="h-4 w-4" /><h3 className="break-all text-sm font-semibold text-white">{tool.name}</h3></div>
          <p className="mt-2 text-xs leading-5 text-slate-400">{tool.description || 'No description supplied by the MCP server.'}</p>
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-cyan-200">View input schema</summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/30 p-3 text-[10px] text-slate-300">{JSON.stringify(tool.inputSchema ?? {}, null, 2)}</pre>
          </details>
        </article>)}
      </div>}
      <p className="flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs leading-5 text-amber-100/80">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        Registry inspection does not grant execution permission. Tool allowlist changes and privileged invocations remain separate, audited and approval-gated operations.
      </p>
    </section>
  );
}
