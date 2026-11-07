import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type PluginCategory = 'Workflows' | 'PA Agent' | 'Communications' | 'Knowledge & files' | 'Engineering' | 'Research';
type PluginPreference = { enabled: boolean; scopes: string[] };
type Preferences = Record<string, PluginPreference>;

const CATALOG: Array<{ id: string; name: string; category: PluginCategory; description: string; scopes: string[]; access?: 'admin' | 'owner'; availability: 'adapter-required' | 'native-planned' }> = [
  { id: 'github', name: 'GitHub', category: 'Engineering', description: 'Repository context, issues, pull requests and CI evidence.', scopes: ['PA Agent', 'Engineering workers'], availability: 'adapter-required' },
  { id: 'google-calendar', name: 'Google Calendar', category: 'PA Agent', description: 'Calendar context, availability and scheduling workflows.', scopes: ['PA Agent', 'Scheduling workers'], availability: 'adapter-required' },
  { id: 'microsoft-calendar', name: 'Microsoft 365 Calendar', category: 'PA Agent', description: 'Outlook calendar context and scheduling workflows.', scopes: ['PA Agent', 'Scheduling workers'], availability: 'adapter-required' },
  { id: 'gmail', name: 'Gmail', category: 'Communications', description: 'Email search, drafting and explicitly approved dispatch.', scopes: ['PA Agent', 'Comms workers'], availability: 'adapter-required' },
  { id: 'outlook-mail', name: 'Outlook Mail', category: 'Communications', description: 'Mailbox context, drafting and explicitly approved dispatch.', scopes: ['PA Agent', 'Comms workers'], availability: 'adapter-required' },
  { id: 'slack', name: 'Slack', category: 'Communications', description: 'Team messages, channels and human-reviewed workflows.', scopes: ['Comms workers', 'Workforce'], availability: 'adapter-required' },
  { id: 'microsoft-teams', name: 'Microsoft Teams', category: 'Communications', description: 'Team collaboration and approved message workflows.', scopes: ['Comms workers', 'Workforce'], availability: 'adapter-required' },
  { id: 'whatsapp-business', name: 'WhatsApp Business', category: 'Communications', description: 'Business messaging through an approved provider adapter.', scopes: ['Comms workers'], access: 'owner', availability: 'adapter-required' },
  { id: 'twilio', name: 'Twilio', category: 'Communications', description: 'SMS and voice provider connectivity; outbound actions require human approval.', scopes: ['Comms workers'], access: 'owner', availability: 'adapter-required' },
  { id: 'notion', name: 'Notion', category: 'Knowledge & files', description: 'Workspace pages, knowledge retrieval and approved updates.', scopes: ['PA Agent', 'Knowledge workers'], availability: 'adapter-required' },
  { id: 'dropbox', name: 'Dropbox', category: 'Knowledge & files', description: 'Authorised file discovery and document retrieval.', scopes: ['PA Agent', 'Knowledge workers'], availability: 'adapter-required' },
  { id: 'sharepoint', name: 'SharePoint', category: 'Knowledge & files', description: 'Enterprise document and knowledge access.', scopes: ['Knowledge workers', 'Workforce'], availability: 'adapter-required' },
  { id: 'asana', name: 'Asana', category: 'Workflows', description: 'Project tasks, assignments and status synchronisation.', scopes: ['Workforce', 'PA Agent'], availability: 'adapter-required' },
  { id: 'linear', name: 'Linear', category: 'Workflows', description: 'Engineering issue tracking and workflow handoffs.', scopes: ['Engineering workers', 'Workforce'], availability: 'adapter-required' },
  { id: 'trello', name: 'Trello', category: 'Workflows', description: 'Boards, cards and lightweight task automation.', scopes: ['Workforce', 'PA Agent'], availability: 'adapter-required' },
  { id: 'zapier', name: 'Zapier', category: 'Workflows', description: 'External workflow triggers and action orchestration.', scopes: ['Workflow engine'], availability: 'adapter-required' },
  { id: 'firecrawl', name: 'Firecrawl', category: 'Research', description: 'Structured web research and page extraction.', scopes: ['PA Agent', 'Research workers'], availability: 'adapter-required' },
  { id: 'browser-automation', name: 'Browser automation / MCP', category: 'Research', description: 'Controlled browser tools exposed through reviewed MCP adapters.', scopes: ['PA Agent', 'Research workers'], availability: 'adapter-required' },
];

const CATEGORIES: Array<'All' | PluginCategory> = ['All', 'Workflows', 'PA Agent', 'Communications', 'Knowledge & files', 'Engineering', 'Research'];

function normalizePreferences(value: unknown): Preferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Preferences = {};
  for (const [id, item] of Object.entries(value)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const candidate = item as { enabled?: unknown; scopes?: unknown };
    result[id] = {
      enabled: candidate.enabled === true,
      scopes: Array.isArray(candidate.scopes) ? candidate.scopes.filter((scope): scope is string => typeof scope === 'string' && scope.length <= 80).slice(0, 12) : [],
    };
  }
  return result;
}

interface Props { userId: string; initialPreferences?: unknown; isAdmin?: boolean; isOwner?: boolean; }
export default function PluginIntegrationsSettings({ userId, initialPreferences, isAdmin = false, isOwner = false }: Props) {
  const [preferences, setPreferences] = useState<Preferences>(() => normalizePreferences(initialPreferences));
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('All');
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const visible = useMemo(() => CATALOG.filter(plugin => (category === 'All' || plugin.category === category)
    && (plugin.name.toLowerCase().includes(query.toLowerCase()) || plugin.description.toLowerCase().includes(query.toLowerCase()))), [category, query]);

  function canRequest(plugin: typeof CATALOG[number]) {
    return !plugin.access || (plugin.access === 'admin' ? isAdmin : isOwner);
  }
  function toggle(pluginId: string, enabled: boolean) {
    setPreferences(current => ({ ...current, [pluginId]: { enabled, scopes: enabled ? (current[pluginId]?.scopes ?? CATALOG.find(item => item.id === pluginId)?.scopes ?? []) : [] } }));
  }

  async function savePreferences() {
    if (saving) return;
    if (!supabase) { setError('Plugin preferences cannot be saved because RyanAI authentication is not configured.'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      const { data: identity, error: identityError } = await supabase.auth.getUser();
      if (identityError || !identity.user || identity.user.id !== userId) throw new Error('Your RyanAI session could not be verified. Sign in again before saving plugin preferences.');
      const safePreferences: Preferences = {};
      for (const plugin of CATALOG) {
        if (!canRequest(plugin)) continue;
        const preference = preferences[plugin.id];
        if (preference?.enabled) safePreferences[plugin.id] = { enabled: true, scopes: plugin.scopes };
      }
      const { data, error: updateError } = await supabase.auth.updateUser({ data: { ryanai_plugin_preferences: safePreferences } });
      if (updateError) throw updateError;
      if (!data.user || data.user.id !== userId) throw new Error('The identity provider did not confirm these plugin preferences.');
      setPreferences(safePreferences);
      setNotice('Plugin preferences saved. No provider has been connected and no worker permissions or credentials were granted.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save plugin preferences. Please retry.');
    } finally { setSaving(false); }
  }

  return <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="plugin-integrations-title">
    <div className="mb-4"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">RyanAI ecosystem</p><h2 id="plugin-integrations-title" className="mt-1 text-xl font-semibold text-white">Plugin & integrations centre</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Discover the integrations RyanAI workers may need. These are access preferences only: each provider still requires a reviewed adapter, secure connection, scoped authorisation and independent runtime tests.</p></div>
    <div className="grid gap-3 sm:grid-cols-[1fr_auto]"><label className="text-xs text-slate-400">Search integrations<input aria-label="Search integrations" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search tools, providers or capabilities" className="mt-1 block w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white" /></label><label className="text-xs text-slate-400">Category<select aria-label="Plugin category" value={category} onChange={event => setCategory(event.target.value as typeof category)} className="mt-1 block w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white">{CATEGORIES.map(item => <option key={item}>{item}</option>)}</select></label></div>
    <div className="mt-4 grid gap-3 md:grid-cols-2">{visible.map(plugin => { const allowed = canRequest(plugin); const enabled = preferences[plugin.id]?.enabled === true; return <article key={plugin.id} data-plugin-id={plugin.id} className="rounded-xl border border-white/10 bg-slate-950/60 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-white">{plugin.name}</h3><p className="mt-1 text-xs text-cyan-200">{plugin.category}</p></div><span className="rounded-full border border-amber-300/20 px-2 py-1 text-[10px] text-amber-200">Adapter required</span></div><p className="mt-2 text-xs leading-5 text-slate-400">{plugin.description}</p><p className="mt-2 text-[11px] text-slate-500">Intended scopes: {plugin.scopes.join(' · ')}</p><label className={`mt-3 flex items-center gap-2 text-xs ${allowed ? 'text-slate-200' : 'text-slate-500'}`}><input type="checkbox" aria-label={`Request ${plugin.name} for eligible workers`} checked={enabled} disabled={!allowed || saving} onChange={event => toggle(plugin.id, event.target.checked)} className="h-4 w-4 accent-cyan-400" />Request availability for eligible workers{!allowed && <span className="text-amber-300">(Owner/admin controlled)</span>}</label></article>; })}</div>
    {visible.length === 0 && <p className="mt-4 rounded-xl border border-white/10 p-4 text-sm text-slate-400">No integrations match this search.</p>}
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4"><p className="max-w-2xl text-xs leading-5 text-slate-500">Saving records user preferences only. It does not install plugins, connect accounts, expose secrets, authorise outbound communications or grant model/worker execution rights.</p><button type="button" onClick={() => void savePreferences()} disabled={saving} className="rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-50">{saving ? 'Saving…' : 'Save plugin preferences'}</button></div>
    {error && <p role="alert" className="mt-3 text-sm text-rose-200">{error}</p>}{notice && <p role="status" className="mt-3 text-sm text-emerald-200">{notice}</p>}
  </section>;
}

export { CATALOG as RYANAI_PLUGIN_CATALOG, normalizePreferences as normalizePluginPreferences };
