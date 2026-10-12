'use client';

import { useState, useEffect, useRef } from 'react';
import { Terminal, Cpu, Activity, ShieldAlert, Send, Trash2 } from 'lucide-react';
import { useLogStore } from '../store/useLogStore'; // Ensure this path matches your folder structure

export default function RyanAIWorkspace() {
  // Zustand Global State (persisted to localStorage)
  const { logs, appendLog, clearLogs } = useLogStore();
  
  // Local UI State
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [socketStatus, setSocketStatus] = useState<'CONNECTING' | 'CONNECTED' | 'OFFLINE'>('CONNECTING');
  const [isHydrated, setIsHydrated] = useState(false); 
  
  const consoleEndRef = useRef<HTMLDivElement>(null);

  // 1. Hydration Guard: Wait for client-side mounting before rendering logs
  useEffect(() => {
    setIsHydrated(true);
  }, []);

  // 2. Auto-scroll to the latest log
  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, isHydrated]);

  // 3. WebSocket Connection to Fastify Gateway
  useEffect(() => {
    const wssUrl = process.env.NEXT_PUBLIC_TELEMETRY_WSS || 'ws://localhost:8080/api/telemetry/stream';
    const ws = new WebSocket(wssUrl);

    ws.onopen = () => {
      setSocketStatus('CONNECTED');
      appendLog('SYSTEM', 'Secure tunnel established. Awaiting telemetry...');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const source = data.type === 'eBPF_alert' ? 'eBPF' : 'AGENT';
        appendLog(source, JSON.stringify(data.payload || data));
      } catch (e) {
        appendLog('SYSTEM', event.data);
      }
    };

    ws.onclose = () => setSocketStatus('OFFLINE');
    ws.onerror = () => setSocketStatus('OFFLINE');

    return () => ws.close(); // Cleanup on unmount
  }, [appendLog]);

  const handleCommandSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const command = input.trim();
    setInput('');
    appendLog('USER', command);
    setIsProcessing(true);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_INFERENCE_URL || 'http://localhost:8080/api/inference/execute';
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: command, agentId: 'supervisor-01' })
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Gateway timeout');
    } catch (error: any) {
      appendLog('SYSTEM', `[ERR] Command failed: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-300 font-mono p-4 md:p-8 flex flex-col">
      <header className="flex items-center justify-between border-b border-cyan-900/50 pb-4 mb-6">
        <div className="flex items-center gap-3">
          <Cpu className="text-cyan-400 w-8 h-8" />
          <div>
            <h1 className="text-xl font-bold text-cyan-50 tracking-wider uppercase">RyanAI Core</h1>
            <p className="text-xs text-cyan-500/70">Autonomous Reasoning Platform</p>
          </div>
        </div>
        
        <div className="flex items-center gap-6 text-sm">
          <button 
            onClick={clearLogs}
            className="flex items-center gap-2 text-slate-500 hover:text-red-400 transition-colors"
            title="Clear Console Memory"
          >
            <Trash2 className="w-4 h-4" />
            <span className="hidden md:inline">Clear</span>
          </button>
          
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-slate-500" />
            <span className="text-slate-400">Gateway:</span>
            <span className={socketStatus === 'CONNECTED' ? 'text-cyan-400 shadow-cyan-400/50 drop-shadow-md' : 'text-red-500'}>
              {socketStatus}
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col bg-slate-900/50 border border-slate-800 rounded-lg overflow-hidden shadow-[0_0_15px_rgba(34,211,238,0.05)] relative">
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {/* Render logs only after hydration is complete */}
          {isHydrated && logs.map((log) => (
            <div key={log.id} className="flex gap-4 text-sm leading-relaxed">
              <span className="text-slate-500 shrink-0
