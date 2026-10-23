import React from 'react';

export const SecurityControls: React.FC = () => (
  <div className="card flex flex-col justify-between">
    <div>
      <span className="card-header">Security Protocols</span>
      <h3 className="text-cyan-300 font-mono mb-4">Quick Controls</h3>

      <div className="space-y-3">
        <div className="flex items-center justify-between p-3 glass rounded-lg border border-cyan-500/10">
          <span className="text-sm font-mono text-slate-300">Packet Inspection</span>
          <span className="badge badge-success">ACTIVE</span>
        </div>
        <div className="flex items-center justify-between p-3 glass rounded-lg border border-cyan-500/10">
          <span className="text-sm font-mono text-slate-300">eBPF Ring Buffer</span>
          <span className="badge badge-success">READY</span>
        </div>
        <div className="flex items-center justify-between p-3 glass rounded-lg border border-cyan-500/10">
          <span className="text-sm font-mono text-slate-300">DNS Over TLS</span>
          <span className="badge badge-warning">ENFORCED</span>
        </div>
      </div>
    </div>

    <div className="mt-6 pt-4 border-t border-cyan-500/20 flex justify-between items-center text-xs font-mono text-slate-400">
      <span>STATUS: OPERATIONAL</span>
      <span className="text-cyan-400 animate-pulse">● LIVE CONNECTION</span>
    </div>
  </div>
);