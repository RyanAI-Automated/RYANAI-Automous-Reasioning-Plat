// src/components/AgentControlPanel.tsx
import React, { useState } from "react";
import { TauriBridge } from "../services/tauriBridge";

/** Render an objective input with execution progress, output, and caught errors. */
export function AgentControlPanel() {
  const [objective, setObjective] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRunObjective = async () => {
    if (!objective.trim()) return;
    setLoading(true);
    setOutput("Executing autonomous reasoning workflow...");

    try {
      const res = await TauriBridge.executeObjective(objective);
      setOutput(res.result);
    } catch (err: unknown) {
      setOutput(`Error: ${(err instanceof Error ? err.message : String(err))}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 bg-slate-900 text-slate-100 rounded-xl shadow-2xl border border-slate-800 max-w-2xl mx-auto mt-10">
      <h2 className="text-xl font-bold mb-4">RyanAI Agent Evolution Console</h2>
      
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          placeholder="Enter task or self-dev objective (e.g., 'Refactor database module')..."
          className="flex-1 px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:border-indigo-500"
        />
        <button
          onClick={handleRunObjective}
          disabled={loading}
          className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg font-semibold transition"
        >
          {loading ? "Reasoning..." : "Execute"}
        </button>
      </div>

      <div className="p-4 bg-black/50 border border-slate-800 rounded-lg min-h-[150px] font-mono text-sm whitespace-pre-wrap overflow-y-auto">
        {output || "Awaiting instructions..."}
      </div>
    </div>
  );
}