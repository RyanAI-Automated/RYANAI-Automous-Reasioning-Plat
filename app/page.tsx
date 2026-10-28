import { useEffect, useRef, useState } from 'react';
import { Activity, Cpu, Send, Trash2 } from 'lucide-react';
import { useLogStore } from '../store/useLogStore';

export default function RyanAIWorkspace() {
  const { logs, appendLog, clearLogs } = useLogStore();
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [socketStatus, setSocketStatus] = useState<'CONNECTING' | 'CONNECTED' | 'OFFLINE'>('CONNECTING');
  const consoleEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);
  useEffect(() => {
    const url = import.meta.env.VITE_TELEMETRY_WSS || 'ws://localhost:3000/ws';
    const socket = new WebSocket(url);
    socket.onopen = () => { setSocketStatus('CONNECTED'); appendLog('SYSTEM', 'Telemetry connection established.'); };
    socket.onmessage = (event) => appendLog('AGENT', String(event.data));
    socket.onerror = () => setSocketStatus('OFFLINE');
    socket.onclose = () => setSocketStatus('OFFLINE');
    return () => socket.close();
  }, [appendLog]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const command = input.trim();
    if (!command) return;
    setInput('');
    appendLog('USER', command);
    setIsProcessing(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || ''}/api/reason`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: command }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      appendLog('AGENT', JSON.stringify(await response.json()));
    } catch (error) { appendLog('SYSTEM', `[ERR] ${error instanceof Error ? error.message : String(error)}`); }
    finally { setIsProcessing(false); }
  }

  return <div className="min-h-screen bg-slate-950 text-slate-300 font-mono p-4 md:p-8 flex flex-col">
    <header className="flex items-center justify-between border-b border-cyan-900/50 pb-4 mb-6">
      <div className="flex items-center gap-3"><Cpu className="text-cyan-400" /><div><h1 className="text-xl font-bold text-cyan-50">RyanAI Core</h1><p className="text-xs text-cyan-500/70">Autonomous Reasoning Platform</p></div></div>
      <div className="flex items-center gap-4 text-sm"><button onClick={clearLogs} className="text-slate-500 hover:text-red-400"><Trash2 className="inline h-4 w-4" /> Clear</button><span><Activity className="inline h-4 w-4" /> {socketStatus}</span></div>
    </header>
    <main className="flex-1 flex flex-col bg-slate-900/50 border border-slate-800 rounded-lg overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 space-y-2">{isHydrated && logs.map((log) => <div key={log.id} className="flex gap-4 text-sm"><span className="text-slate-500">{log.timestamp}</span><span className="text-cyan-400">[{log.level}]</span><span>{log.message}</span></div>)}<div ref={consoleEndRef} /></div>
      <form onSubmit={submit} className="border-t border-slate-800 p-4 flex gap-3"><input value={input} onChange={(event) => setInput(event.target.value)} disabled={isProcessing} placeholder="Enter command..." className="flex-1 rounded bg-slate-950 border border-slate-700 px-3 py-2" /><button type="submit" disabled={isProcessing} className="rounded bg-cyan-600 px-4 py-2 disabled:opacity-50"><Send className="h-4 w-4" /></button></form>
    </main>
  </div>;
}
