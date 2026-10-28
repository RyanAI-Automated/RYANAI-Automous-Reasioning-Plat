import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Activity, Cpu, Send, Trash2 } from 'lucide-react';
import { executeAgentReasoning } from '../src/services/api';
import { useLogStore } from '../store/useLogStore';

/** Dashboard-side operator workspace for API requests and live telemetry. */
export default function RyanAIWorkspace() {
  const { logs, appendLog, clearLogs } = useLogStore();
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [socketStatus, setSocketStatus] = useState<'CONNECTING' | 'CONNECTED' | 'OFFLINE'>('CONNECTING');
  const consoleEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    const configuredUrl = import.meta.env.VITE_TELEMETRY_WSS?.trim() || import.meta.env.VITE_WS_URL?.trim();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(configuredUrl || `${protocol}//${window.location.host}/ws`);

    socket.onopen = () => {
      setSocketStatus('CONNECTED');
      appendLog('SYSTEM', 'Telemetry connection established.');
    };
    socket.onmessage = (event) => appendLog('AGENT', String(event.data));
    socket.onerror = () => setSocketStatus('OFFLINE');
    socket.onclose = () => setSocketStatus('OFFLINE');

    return () => socket.close();
  }, [appendLog]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const command = input.trim();
    if (!command || isProcessing) return;

    setInput('');
    appendLog('USER', command);
    setIsProcessing(true);
    try {
      const result = await executeAgentReasoning(command);
      appendLog('AGENT', result.output || JSON.stringify(result));
    } catch (error) {
      appendLog('SYSTEM', `[ERR] ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <section className="min-h-[28rem] bg-slate-950 text-slate-300 font-mono p-4 md:p-8 flex flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-900/50 pb-4 mb-6">
        <div className="flex items-center gap-3">
          <Cpu className="text-cyan-400" />
          <div>
            <h2 className="text-xl font-bold text-cyan-50">RyanAI Integrated Workspace</h2>
            <p className="text-xs text-cyan-500/70">Reasoning API and live telemetry</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <button onClick={clearLogs} className="text-slate-500 hover:text-red-400">
            <Trash2 className="inline h-4 w-4" /> Clear logs
          </button>
          <span aria-live="polite">
            <Activity className="inline h-4 w-4" /> {socketStatus}
          </span>
        </div>
      </header>

      <main className="flex min-h-64 flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-900/50">
        <div className="min-h-48 flex-1 space-y-2 overflow-y-auto p-4">
          {logs.length === 0 && <p className="text-sm text-slate-500">No telemetry messages yet.</p>}
          {logs.map((log) => (
            <div key={log.id} className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span className="text-slate-500">{log.timestamp}</span>
              <span className="text-cyan-400">[{log.source}]</span>
              <span className="min-w-0 whitespace-pre-wrap break-words">{log.message}</span>
            </div>
          ))}
          <div ref={consoleEndRef} />
        </div>
        <form onSubmit={submit} className="flex gap-3 border-t border-slate-800 p-4">
          <label className="sr-only" htmlFor="ryanai-workspace-command">Reasoning command</label>
          <input
            id="ryanai-workspace-command"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={isProcessing}
            maxLength={20000}
            placeholder="Enter a reasoning objective…"
            className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-2"
          />
          <button
            type="submit"
            disabled={isProcessing || !input.trim()}
            className="rounded bg-cyan-600 px-4 py-2 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </main>
    </section>
  );
}
