import { useState, type FormEvent } from 'react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { API_BASE_URL } from '@/lib/apiBaseUrl';
import { FileCode2, ShieldCheck, Upload } from 'lucide-react';

interface PatchResponse {
  success?: boolean;
  result?: {
    status?: 'success' | 'rejected' | 'conflict' | 'failed';
    message?: string;
    error?: string;
    warnings?: string[];
  };
  error?: string;
}

/** Administrator console for validate-before-promote self-patching. */
export default function SelfPatchPanel() {
  const [filePath, setFilePath] = useState('');
  const [patchContent, setPatchContent] = useState('');
  const [testScript, setTestScript] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PatchResponse['result'] | null>(null);

  async function submitPatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !filePath.trim() || !patchContent.trim()) return;
    setSubmitting(true);
    setError('');
    setResult(null);
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/api/patches/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: filePath.trim(),
          patchContent,
          ...(testScript.trim() ? { testScript } : {}),
        }),
      });
      const data = await response.json().catch(() => ({})) as PatchResponse;
      if (!response.ok) {
        setResult(data.result ?? null);
        throw new Error(data.error || data.result?.error || `Patch request failed (${response.status})`);
      }
      setResult(data.result ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Self-patch request failed.');
    } finally {
      setSubmitting(false);
    }
  }

  const status = result?.status;
  const statusTone = status === 'success'
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
    : status === 'conflict' || status === 'rejected'
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
      : 'border-rose-500/30 bg-rose-500/10 text-rose-200';

  return (
    <section aria-labelledby="self-patch-heading" className="mx-auto my-6 max-w-6xl rounded-2xl border border-cyan-400/20 bg-slate-950 p-5 text-slate-100 shadow-xl">
      <header className="mb-4 flex items-center gap-3">
        <FileCode2 className="h-6 w-6 text-cyan-300" />
        <div>
          <h2 id="self-patch-heading" className="font-semibold text-cyan-100">Self-Patch Control</h2>
          <p className="text-xs text-slate-400">Administrator-only · isolated verification · atomic promotion</p>
        </div>
      </header>

      <div className="mb-4 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-amber-100">
          <ShieldCheck className="h-4 w-4" /> Production safety gate
        </div>
        <p className="mt-1 text-xs leading-relaxed text-slate-300">
          Only existing Git-tracked workspace files can be changed. The patch is staged and checked in a digest-pinned, network-disabled verifier before atomic promotion. Missing verifier configuration, failed checks, path violations or concurrent changes stop the patch. Never submit secrets, environment files, credentials or personal data.
        </p>
      </div>

      <form onSubmit={submitPatch} className="grid gap-3">
        <label className="space-y-1 text-xs text-slate-300">
          Workspace-relative file path
          <input
            value={filePath}
            onChange={(event) => setFilePath(event.target.value)}
            required
            maxLength={500}
            placeholder="src/agent/example.ts"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-mono"
          />
        </label>
        <label className="space-y-1 text-xs text-slate-300">
          Complete candidate file content
          <textarea
            value={patchContent}
            onChange={(event) => setPatchContent(event.target.value)}
            required
            maxLength={200_000}
            rows={9}
            placeholder="Paste the complete proposed file content…"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-mono"
          />
        </label>
        <label className="space-y-1 text-xs text-slate-300">
          Optional additional verification script
          <textarea
            value={testScript}
            onChange={(event) => setTestScript(event.target.value)}
            maxLength={200_000}
            rows={3}
            placeholder="Optional JavaScript verification script executed only inside the isolated verifier…"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-mono"
          />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">A successful response means verification passed and the candidate was promoted.</p>
          <button
            type="submit"
            disabled={submitting || !filePath.trim() || !patchContent.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Upload className="h-4 w-4" /> {submitting ? 'Verifying patch…' : 'Validate & apply patch'}
          </button>
        </div>
      </form>

      {error && <p role="alert" className="mt-4 text-sm text-rose-300">{error}</p>}
      {result && (
        <div role="status" className={`mt-4 rounded-xl border p-3 text-sm ${statusTone}`}>
          <p className="font-semibold">Patch status: {(status || 'unknown').toUpperCase()}</p>
          {result.message && <p className="mt-1">{result.message}</p>}
          {result.error && <p className="mt-1">{result.error}</p>}
          {result.warnings?.map((warning) => <p key={warning} className="mt-1 text-xs">{warning}</p>)}
          {status === 'conflict' && <p className="mt-1 text-xs">The workspace changed during verification. Refresh the source file and prepare a new candidate.</p>}
        </div>
      )}
    </section>
  );
}
