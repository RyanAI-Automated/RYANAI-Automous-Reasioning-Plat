import React, { useState } from 'react';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
}

interface LogConsoleProps {
  logs: LogEntry[];
  isSweeping: boolean;
  onSweep: () => void;
  onExecuteCommand: (cmd: string) => void;
}

export const LogConsole: React.FC<LogConsoleProps> = ({
  logs,
  isSweeping,
  onSweep,
  onExecuteCommand,
}) => {
  const [commandInput, setCommandInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commandInput.trim()) return;
    onExecuteCommand(commandInput);
    setCommandInput('');
  };

  return (
    <div className="lg:col-span-2 card flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <span className="card-header">Kernel Stream</span>
          <h3 className="text-cyan-300 font-mono">Realtime Security Feed</h3>
        </div>
        <button onClick={onSweep} disabled={isSweeping} className="btn-secondary">
          {isSweeping ? 'Sweeping...' : 'Run Diagnostics'}
        </button>
      </div>

      <div className="bg-slate-950/90 hud-border rounded-lg p-4 font-mono text-xs flex-1 min-h-[220px] max-h-[300px] overflow-y-auto space-y-2">
        {logs.map((log) => (
          <div key={log.id} className="flex items-start space-x-2">
            <span className="text-slate-500">[{log.timestamp}]</span>
            <span
              className={
                log.level === 'WARN'
                  ? 'text-amber-400 font-bold'
                  : log.level === 'ERROR'
                  ? 'text-rose-400 font-bold'
                  : 'text-cyan-400'
              }
            >
              [{log.level}]
            </span>
            <span className="text-slate-200">{log.message}</span>
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
        <input
          type="text"
          placeholder="Enter system command (e.g., ping 127.0.0.1)..."
          value={commandInput}
          onChange={(e) => setCommandInput(e.target.value)}
          className="input-primary flex-1"
        />
        <button type="submit" className="btn-primary">
          Execute
        </button>
      </form>
    </div>
  );
};