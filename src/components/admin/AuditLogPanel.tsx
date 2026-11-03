import { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw, ShieldAlert } from 'lucide-react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { API_BASE_URL } from '@/lib/apiBaseUrl';

interface AuditEvent {
  id: string;
  actorId: string;
  eventType: string;
  resourceId: string | null;
  createdAt: string;
}

interface AuditResponse {
  events?: AuditEvent[];
  error?: string;
}

/**
 * Read-only viewer for the existing internal Jarvis audit stream.
 * This is intentionally not presented as a complete platform security log:
 * authentication, session and provider events are not yet unified here.
 */
export default function AuditLogPanel() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/api/jarvis/internal/audit`);
      const data = await response.json().catch(() => ({})) as AuditResponse;
      if (!response.ok) {
        throw new Error(data.error || `Audit request failed (${response.status})`);
      }
      setEvents(Array.isArray(data.events) ? data.events : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load audit events.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-labelledby="audit-log-heading" className="rounded-2xl border border-white/10 bg-slate-950/80 p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5 text-cyan-300" />
          <div>
            <h2 id="audit-log-heading" className="font-semibold text-white">Internal Jarvis audit events</h2>
            <p className="text-xs text-slate-400">Latest 100 recorded events · read-only</p>
          </div>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </header>

      <p className="mb-4 flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs leading-5 text-amber-100/80">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        This is the existing Jarvis audit stream, not a complete security audit log. Authentication events, administrative session changes and provider configuration changes are not yet unified in this feed.
      </p>

      {error && <p role="alert" className="mb-3 text-sm text-rose-300">{error}</p>}
      {loading && <p role="status" className="text-sm text-slate-400">Loading audit events…</p>}
      {!loading && !error && events.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-800 p-4 text-sm text-slate-400">No Jarvis audit events have been recorded.</p>
      )}
      {!loading && events.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-xs">
            <thead className="text-slate-500">
              <tr className="border-b border-slate-800">
                <th scope="col" className="py-2 pr-3 font-medium">Time</th>
                <th scope="col" className="py-2 pr-3 font-medium">Event</th>
                <th scope="col" className="py-2 pr-3 font-medium">Actor ID</th>
                <th scope="col" className="py-2 font-medium">Resource</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-b border-slate-900 align-top text-slate-300">
                  <td className="whitespace-nowrap py-3 pr-3 text-slate-400">{Number.isNaN(Date.parse(event.createdAt)) ? 'Unknown time' : new Date(event.createdAt).toLocaleString()}</td>
                  <td className="py-3 pr-3 font-medium text-cyan-100">{event.eventType}</td>
                  <td className="max-w-[180px] break-all py-3 pr-3">{event.actorId}</td>
                  <td className="max-w-[180px] break-all py-3">{event.resourceId || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
