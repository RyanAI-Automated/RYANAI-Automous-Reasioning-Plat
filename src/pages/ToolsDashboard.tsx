import { useState } from 'react';
import { BookOpen, CheckCircle2, Code2, Database, Network, PlayCircle, Search, ShieldAlert, Wrench } from 'lucide-react';

const tools = [
  { name: 'tool_registry', owner: 'platform', risk: 'read-only', detail: 'Inspect the MCP tool catalogue, ownership, risk and allowlist state.', mode: 'Always-on read-only', icon: BookOpen },
  { name: 'run_project_checks', owner: 'platform', risk: 'code-execution', detail: 'Run the repository validation suite and Docker Compose configuration checks.', mode: 'Explicit operator allowlist', icon: PlayCircle },
  { name: 'repository_status', owner: 'platform', risk: 'read-only', detail: 'Read Git status and whitespace diagnostics without modifying files.', mode: 'Explicit operator allowlist', icon: Code2 },
  { name: 'ryanai_stack_manifest', owner: 'platform', risk: 'read-only', detail: 'Read the non-secret service and deployment stack manifest.', mode: 'Explicit operator allowlist', icon: Database },
  { name: 'platform_health', owner: 'platform', risk: 'network-read', detail: 'Check the configured RyanAI API health endpoint.', mode: 'Explicit operator allowlist', icon: Network },
  { name: 'reasoning_route', owner: 'reasoning', risk: 'external-model-request', detail: 'Send a prompt to an explicitly configured reasoning provider.', mode: 'Explicit operator allowlist', icon: Wrench },
];

export default function ToolsDashboard() {
  const [query, setQuery] = useState('');
  const filtered = tools.filter((tool) => (tool.name + ' ' + tool.detail + ' ' + tool.risk).toLowerCase().includes(query.toLowerCase()));
  return (
    <section className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-8">
      <header><p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">MCP governance</p><h1 className="mt-2 text-3xl font-bold text-white">RyanAI Tools Registry</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Catalogue of the MCP server's declared tools and their policy classifications. Runtime availability and enablement must be read from the live MCP registry, not inferred from this source catalogue.</p></header>
      <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-900/70 px-4"><Search className="h-4 w-4 text-slate-400" /><input aria-label="Search MCP tools" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tools, risks or descriptions…" className="w-full bg-transparent py-3 text-sm text-white outline-none placeholder:text-slate-500" /></div>
      <div className="grid gap-3 lg:grid-cols-2">
        {filtered.map(({ name, owner, risk, detail, mode, icon: Icon }) => <article key={name} className="rounded-xl border border-white/10 bg-slate-900/70 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2 text-cyan-200"><Icon className="h-5 w-5" /><h2 className="font-mono text-sm font-semibold text-white">{name}</h2></div><span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-wide text-slate-300">{risk}</span></div><p className="mt-3 text-sm leading-6 text-slate-400">{detail}</p><div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-3 text-xs"><span className="text-slate-500">Owner: <strong className="text-slate-300">{owner}</strong></span><span className="text-cyan-200">{mode}</span></div></article>)}
      </div>
      {filtered.length === 0 && <p className="rounded-xl border border-dashed border-white/10 p-6 text-sm text-slate-400">No tools match that search.</p>}
      <div className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-4"><div className="flex items-center gap-2 text-sm font-semibold text-amber-100"><ShieldAlert className="h-4 w-4" /> Operator-controlled enablement</div><p className="mt-2 text-xs leading-5 text-slate-300">Action tools remain disabled unless their exact names are present in RYANAI_MCP_ENABLED_TOOLS. This interface is intentionally read-only; enablement changes belong in reviewed server configuration. Use the MCP tool_registry operation to inspect the actual runtime state.</p><p className="mt-2 flex items-center gap-2 text-xs text-slate-400"><CheckCircle2 className="h-3.5 w-3.5 text-cyan-300" /> No credentials or environment values are displayed here.</p></div>
    </section>
  );
}
