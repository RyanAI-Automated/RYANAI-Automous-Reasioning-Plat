// src/components/AgentControlPanel.tsx
import React, { useState } from "react";
import { TauriBridge } from "../services/tauriBridge";

/** Render an authenticated native reasoning console with progress and error states. */
export function AgentControlPanel() {
  const [objective, setObjective] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRunObjective = async () => {
    const normalizedObjective = objective.trim();
    if (!normalizedObjective || loading) return;
    setLoading(true);
    setOutput("Submitting an authenticated reasoning request…");

    try {
      const res = await TauriBridge.executeObjective(normalizedObjective);
      setOutput(res.result);
    } catch (err: unknown) {
      setOutput(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      className="mx-auto mt-10 max-w-2xl rounded-xl border border-slate-800 bg-slate-900 p-6 text-slate-100 shadow-2xl"
      aria-labelledby="native-reasoning-title"
    >
      <h2 id="native-reasoning-title" className="mb-2 text-xl font-bold">
        RyanAI Native Reasoning Console
      </h2>
      <p className="mb-4 text-sm text-slate-400">
        Send a reasoning objective through your signed-in RyanAI account. Administrative and engineering actions remain subject to their separate permissions and approvals.
      </p>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
          maxLength={20000}
          aria-label="Reasoning objective"
          placeholder="Describe a question or reasoning task…"
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 focus:border-cyan-400 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void handleRunObjective()}
          disabled={loading || !objective.trim()}
          className="rounded-lg bg-cyan-500 px-6 py-2 font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Reasoning…" : "Run request"}
        </button>
      </div>

      <div
        role="status"
        aria-live="polite"
        className="min-h-[150px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-black/50 p-4 font-mono text-sm"
      >
        {output || "Waiting for a signed-in reasoning request…"}
      </div>
    </section>
  );
}
