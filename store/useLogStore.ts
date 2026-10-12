import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface LogEntry {
  id: string;
  timestamp: string;
  source: 'SYSTEM' | 'AGENT' | 'eBPF' | 'USER';
  message: string;
}

interface LogState {
  logs: LogEntry[];
  appendLog: (source: LogEntry['source'], message: string) => void;
  clearLogs: () => void;
}

export const useLogStore = create<LogState>()(
  persist(
    (set) => ({
      logs: [],
      
      appendLog: (source, message) => set((state) => {
        // Keep only the last 500 logs to prevent localStorage overflow (5MB limit)
        const updatedLogs = [...state.logs, {
          id: crypto.randomUUID(),
          timestamp: new Date().toLocaleTimeString('en-ZA', { hour12: false }),
          source,
          message
        }];
        return { logs: updatedLogs.slice(-500) };
      }),
      
      clearLogs: () => set({ logs: [] }),
    }),
    {
      name: 'ryanai-telemetry-logs', // The key used in localStorage
    }
  )
);
