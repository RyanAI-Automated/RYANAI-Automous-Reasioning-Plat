import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { FormEvent, useState } from 'react';
import { Activity, AlertCircle, Cpu, LoaderCircle, Send } from 'lucide-react';
import { usePlatformHealth } from '@/hooks/usePlatformHealth';
import { API_BASE_URL } from '@/lib/apiBaseUrl';
import { API_ROUTES } from '@/config/core';
import { DEFAULT_MODEL } from '@/lib/models';

interface ReasoningResult {
  success?: boolean;
  output?: string;
  response?: string;
  error?: string;
}

/** Display platform health and an authenticated reasoning form with request feedback. */
export default function RyanAICockpit() {
  const { health, error: healthError, checking, refresh } = usePlatformHealth();
  const [prompt, setPrompt] = useState('');
  const [answer, setAnswer] = useState('');
  const [requestError, setRequestError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  /** Submit a nonblank objective once and display the reasoning output or request error. */
  async function runReasoning(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const objective = prompt.trim();
    if (!objective || sending) return;

    setSending(true);
    setRequestError(null);
    setAnswer('');
    try {
      const response = await authenticatedFetch(
        `${API_BASE_URL}${API_ROUTES.reasonPath}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ prompt: objective, model: DEFAULT_MODEL }),
        },
      );
      const result = (await response.json()) as ReasoningResult;
      if (!response.ok || !result.success) {
        throw new Error(
          result.error || `Reasoning request failed (HTTP ${response.status}).`,
        );
      }
      const output = result.output || result.response;
      if (!output)
        throw new Error('RyanAI returned an empty reasoning response.');
      setAnswer(output);
    } catch (cause) {
      setRequestError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="mx-auto max-w-6xl px-5 py-8 sm:px-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
            Operator console
          </p>
          <h1 className="mt-2 text-3xl font-bold text-white">RyanAI Cockpit</h1>
          <p className="mt-2 text-sm text-slate-400">
            Live service state and a real request path to the reasoning API.
          </p>
        </div>
        <div
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm ${health?.status === 'online' ? 'border-emerald-300/20 text-emerald-200' : 'border-rose-300/20 text-rose-200'}`}
        >
          <Activity className="h-4 w-4" />
          {health?.status === 'online'
            ? 'API online'
            : checking
              ? 'Checking API'
              : 'API offline'}
        </div>
      </div>

      {healthError && (
        <div
          role="alert"
          className="mt-6 flex gap-2 rounded-xl border border-rose-400/20 bg-rose-400/5 p-4 text-sm text-rose-200"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          {healthError}
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <ServiceValue
          label="Database"
          value={reported(health?.services?.database)}
        />
        <ServiceValue label="Cache" value={reported(health?.services?.redis)} />
        <ServiceValue
          label="Reasoning graph"
          value={health?.activeGraph || 'Not reported'}
        />
      </div>

      <form
        onSubmit={runReasoning}
        className="mt-8 rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-7"
      >
        <label
          htmlFor="cockpit-prompt"
          className="flex items-center gap-2 font-semibold text-white"
        >
          <Cpu className="h-4 w-4 text-cyan-300" />
          Run a reasoning request
        </label>
        <textarea
          id="cockpit-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          maxLength={20_000}
          rows={4}
          placeholder="Describe the question or task for RyanAI..."
          className="mt-4 w-full resize-y rounded-xl border border-white/10 bg-slate-950 p-4 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-300/50"
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-slate-500">
            {prompt.length.toLocaleString()} / 20,000 characters
          </span>
          <button
            type="submit"
            disabled={sending || !prompt.trim() || !health}
            className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {sending ? 'Reasoning…' : 'Run request'}
          </button>
        </div>
      </form>

      {requestError && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/5 p-4 text-sm text-rose-200"
        >
          {requestError}
        </div>
      )}
      {answer && (
        <article className="mt-4 rounded-2xl border border-cyan-300/20 bg-slate-900/70 p-5 sm:p-7">
          <h2 className="font-semibold text-cyan-100">RyanAI response</h2>
          <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-200">
            {answer}
          </p>
        </article>
      )}
      <button
        onClick={() => void refresh()}
        className="mt-5 text-xs text-slate-500 hover:text-cyan-200"
      >
        Refresh service status
      </button>
    </section>
  );
}

/** Format a service health flag, distinguishing unavailable from unreported state. */
function reported(value: boolean | undefined) {
  return value === true
    ? 'Healthy'
    : value === false
      ? 'Unavailable'
      : 'Not reported';
}

/** Render a labeled service status value in the cockpit. */
function ServiceValue({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-semibold text-slate-100">{value}</div>
    </article>
  );
}
