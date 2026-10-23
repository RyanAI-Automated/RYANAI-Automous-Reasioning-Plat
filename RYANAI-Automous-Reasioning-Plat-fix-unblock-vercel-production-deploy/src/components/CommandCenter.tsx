import React from 'react';

interface CommandCenterProps {
  activeEngineState: string;
}

export const CommandCenter: React.FC<CommandCenterProps> = ({ activeEngineState }) => {
  return (
    <div className="command-center p-6 bg-slate-950 text-slate-100 min-h-screen">
      <header className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight">RyanAI Command Center</h1>
        <span className="px-3 py-1 text-xs font-mono bg-emerald-900 text-emerald-300 rounded-full">
          Status: {activeEngineState}
        </span>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg">
          <h3 className="font-semibold mb-2">Active ReAct Pipeline</h3>
          <p className="text-sm text-slate-400">Monitoring execution streams and memory vectors.</p>
        </div>
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg">
          <h3 className="font-semibold mb-2">CUDA Inference Module</h3>
          <p className="text-sm text-slate-400">Hardware acceleration active.</p>
        </div>
      </div>
    </div>
  );
};