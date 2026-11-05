import { useState, type FormEvent } from 'react';
import { AlertCircle, LoaderCircle, Send, Terminal } from 'lucide-react';
import { getAvailableModels, DEFAULT_MODEL } from '@/lib/models';
import type { ModelId } from '@/lib/types';
import { streamReasoning } from '@/lib/reasoning';

/** Authenticated interactive console backed by the same reasoning API as chat. */
export default function ChatInterface() {
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
  const [prompt, setPrompt] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [progress, setProgress] = useState('');

  async function runInference(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = prompt.trim();
    if (!request || running) return;
    setRunning(true);
    setError('');
    setOutput('');
    setLastRun(null);
    setProgress('Connecting to the reasoning API…');
    try {
      await streamReasoning(request, model, {
        onToken: (token) => setOutput((current) => current + token),
        onStep: (step) => setProgress(step.result || 'Reasoning in progress…'),
        onDone: () => {
          setProgress('Completed');
          setLastRun(new Date().toLocaleTimeString());
        },
        onError: (message) => setError(message),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The inference request failed.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="flex h-full min-h-[24rem] flex-col gap-3 rounded-lg border border-cyan-500/20 bg-ink-900/70 p-3 text-ink-200" aria-label="Inference console">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-500/10 pb-3">
        <div className="flex items-center gap-2">
          <Terminal size={17} className="text-cyan-300" />
          <div>
            <h3 className="text-sm font-semibold text-cyan-200">Inference Console</h3>
            <p className="text-[11px] text-ink-500">Authenticated RyanAI reasoning API</p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-400">
          Model
          <select value={model} onChange={(event) => setModel(event.target.value as ModelId)} disabled={running}
            className="max-w-[14rem] rounded-lg border border-cyan-500/20 bg-ink-950 px-2 py-1.5 text-xs text-cyan-100">
            {getAvailableModels().map((item) => <option key={item.id} value={item.id}>{item.label} · {item.provider}</option>)}
          </select>
        </label>
      </header>

      <form onSubmit={runInference} className="space-y-2">
        <label htmlFor="inference-prompt" className="block text-xs font-medium text-ink-300">Prompt</label>
        <textarea id="inference-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)}
          maxLength={20000} rows={4} required disabled={running}
          placeholder="Enter a task for the selected RyanAI reasoning model…"
          className="w-full resize-y rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white placeholder:text-ink-600 focus:border-cyan-400 focus:outline-none disabled:opacity-60" />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-ink-500">{prompt.length.toLocaleString()} / 20,000</span>
          <button type="submit" disabled={running || !prompt.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-3 py-2 text-xs font-semibold text-ink-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50">
            {running ? <LoaderCircle size={14} className="animate-spin" /> : <Send size={14} />}
            {running ? 'Running inference…' : 'Run inference'}
          </button>
        </div>
      </form>

      {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-400/20 bg-rose-400/5 p-3 text-xs text-rose-200"><AlertCircle size={15} className="mt-0.5 shrink-0" />{error}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-white/10 bg-ink-950/80 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">Model output</span>
          {lastRun && <span className="text-[10px] text-ink-500">Completed {lastRun}</span>}
        </div>
        {running && <p role="status" className="mb-2 text-xs text-cyan-200">{progress || 'Streaming reasoning output…'}</p>}
        {!running && !output && !error && <p className="text-xs text-ink-600">Output will appear here after a successful authenticated inference request.</p>}
        {output && <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-ink-200">{output}</pre>}
      </div>
      <p className="text-[10px] text-ink-600">Output is streamed from the authenticated reasoning endpoint. Provider availability depends on server configuration; model catalog entries do not prove provider health.</p>
    </section>
  );
}
