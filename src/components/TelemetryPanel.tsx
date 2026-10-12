import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Clock, Zap } from 'lucide-react';

import type { SystemStatus, ToolStep } from '@/lib/types';

interface TelemetryPanelProps {
  status: SystemStatus;
  steps: ToolStep[];
  sending: boolean;
}

/**
 * Render supplied telemetry and tool steps, distinguishing missing metrics from zero.
 * CPU and memory are percentages; latency is in milliseconds.
 */
export default function TelemetryPanel({
  status,
  steps,
  sending,
}: TelemetryPanelProps) {
  const [displaySteps, setDisplaySteps] = useState<ToolStep[]>([]);

  useEffect(() => {
    setDisplaySteps(steps);
  }, [steps]);

  const getStateColor = () => {
    switch (status.state) {
      case 'thinking':
        return 'from-amber-500 to-orange-500';
      case 'error':
        return 'from-rose-500 to-pink-500';
      default:
        return 'from-green-500 to-emerald-500';
    }
  };

  const getStateLabel = () => {
    switch (status.state) {
      case 'thinking':
        return 'Thinking...';
      case 'error':
        return 'Error';
      default:
        return 'Ready';
    }
  };

  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden">
      {/* Status Card */}
      <motion.div
        className="glass rounded-lg border border-cyan-500/20 p-4 flex-shrink-0"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-ink-500">Status</span>
            <motion.div
              className={`px-2 py-1 rounded-md text-xs font-bold bg-gradient-to-r ${getStateColor()} text-ink-950`}
              animate={{
                scale: status.state === 'thinking' ? [1, 1.05, 1] : 1,
              }}
              transition={{
                duration: 0.8,
                repeat: status.state === 'thinking' ? Infinity : 0,
              }}
            >
              {getStateLabel()}
            </motion.div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-ink-500">CPU</span>
              <span className="text-cyan-300 font-mono">
                {status.cpu === null
                  ? 'Not reported'
                  : `${status.cpu.toFixed(1)}%`}
              </span>
            </div>
            <div className="w-full bg-ink-800/50 rounded-full h-1.5 overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400"
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(status.cpu ?? 0, 100)}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-ink-500">Memory</span>
              <span className="text-cyan-300 font-mono">
                {status.memory === null
                  ? 'Not reported'
                  : `${status.memory.toFixed(1)}%`}
              </span>
            </div>
            <div className="w-full bg-ink-800/50 rounded-full h-1.5 overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-purple-500 to-purple-400"
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(status.memory ?? 0, 100)}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-cyan-500/10">
            <div>
              <div className="text-[10px] text-ink-600 font-mono">Latency</div>
              <div className="text-sm font-mono text-cyan-300">
                {status.latency === null
                  ? '—'
                  : `${Math.round(status.latency)}ms`}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-ink-600 font-mono">Session</div>
              <div className="text-sm font-mono text-cyan-300">
                {status.uptime}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-cyan-500/10">
            <div>
              <div className="text-[10px] text-ink-600 font-mono">
                In (est.)
              </div>
              <div className="text-sm font-mono text-purple-300">
                {status.tokensIn.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-ink-600 font-mono">
                Out (est.)
              </div>
              <div className="text-sm font-mono text-emerald-300">
                {status.tokensOut.toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Tool Trace */}
      <motion.div
        className="glass rounded-lg border border-cyan-500/20 p-4 flex-1 flex flex-col overflow-hidden"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <h3 className="text-xs font-mono text-ink-400 uppercase tracking-wider mb-3 flex-shrink-0">
          <Zap size={12} className="inline mr-1.5" />
          Tool Trace {displaySteps.length > 0 && `(${displaySteps.length})`}
        </h3>

        <div className="space-y-2 overflow-y-auto flex-1 pr-2">
          {displaySteps.length === 0 ? (
            <div className="text-xs text-ink-600 py-4 text-center">
              {sending ? 'Awaiting tool execution...' : 'No tool calls yet'}
            </div>
          ) : (
            displaySteps.map((step, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="text-xs bg-ink-800/30 rounded border border-cyan-500/10 p-2 font-mono"
              >
                <div className="flex items-start gap-2">
                  {step.result ? (
                    <CheckCircle2
                      size={12}
                      className="text-emerald-500 flex-shrink-0 mt-0.5"
                    />
                  ) : (
                    <Clock
                      size={12}
                      className="text-amber-500 flex-shrink-0 mt-0.5 animate-spin"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-cyan-300">
                      <span className="text-purple-300">{step.type}</span>{' '}
                      <span className="text-amber-300">{step.name}</span>
                    </div>
                    {step.result && (
                      <div className="text-emerald-400/80 truncate mt-1">
                        {step.result}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </motion.div>

      {/* Model Info */}
      <motion.div
        className="glass rounded-lg border border-cyan-500/20 p-3 flex-shrink-0"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="text-xs text-ink-600 font-mono mb-1">Active Model</div>
        <div className="text-sm font-mono text-cyan-300 truncate">
          {status.model}
        </div>
      </motion.div>
    </div>
  );
}
